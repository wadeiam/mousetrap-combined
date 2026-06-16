/**
 * Active-Learning Service (Layer 2 of the test/reinforce pipeline)
 *
 * Turns the stream of stored classifications into a growing labeled dataset with
 * minimal human effort, using three signals:
 *
 *  1. Teacher pseudo-labels — the server YOLO is the teacher. Detections at
 *     >= acceptThreshold confidence are auto-accepted as positives; clearly
 *     empty / <= rejectThreshold are auto-labeled background. Only the uncertain
 *     middle band is routed to a human (one-tap review).
 *  2. Hard-negative mining — frames where the EDGE said `worth_sending` but the
 *     server found nothing are edge false positives: the single most valuable
 *     signal for improving the edge model. Auto-labeled 'empty'.
 *  3. Human corrections — user_corrected_class always wins over auto_label.
 *
 * Confirmation-bias guard: auto-accept only at HIGH confidence and always keep
 * the uncertain band human-reviewed; hard negatives counter the teacher's own
 * false positives. The effective training label is
 * COALESCE(user_corrected_class, auto_label).
 */

import { Pool } from 'pg';
import { logger } from './logger.service';

export interface AutoLabelOptions {
  tenantId?: string;          // limit to one tenant; omit = all tenants
  acceptThreshold?: number;   // >= this server confidence -> auto positive
  rejectThreshold?: number;   // <= this -> background
}

export interface AutoLabelResult {
  teacherHigh: number;
  teacherBackground: number;
  hardNegatives: number;
  leftForReview: number;
}

export interface ActiveLearningStats {
  labeledTotal: number;       // corrected OR auto-labeled, with an image
  humanCorrected: number;
  autoLabeled: number;
  hardNegatives: number;
  pendingReview: number;      // have an image, no label, uncertain band
  byLabel: Record<string, number>;
  newSinceLastBatch: number;  // labeled rows not yet in a training batch
}

const RODENT_CLASSES = ['mouse', 'rat', 'rodent'];

export class ActiveLearningService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Run one auto-labeling pass over rows that aren't human-corrected and
   * aren't already auto-labeled. Idempotent: safe to run on a schedule.
   */
  async runAutoLabelPass(opts: AutoLabelOptions = {}): Promise<AutoLabelResult> {
    const accept = opts.acceptThreshold ?? 0.8;
    const reject = opts.rejectThreshold ?? 0.3;
    const tenantFilter = opts.tenantId ? 'AND tenant_id = $3' : '';
    const params: any[] = [accept, reject];
    if (opts.tenantId) params.push(opts.tenantId);

    // 1) Hard negatives: edge wanted to send, server found nothing. Highest value.
    const hardNeg = await this.db.query(
      `UPDATE image_classifications
         SET auto_label = 'empty',
             auto_label_source = 'hard_negative',
             auto_label_confidence = confidence,
             auto_labeled_at = NOW()
       WHERE user_corrected_class IS NULL
         AND auto_label IS NULL
         AND image_path IS NOT NULL
         AND edge_verdict = 'worth_sending'
         AND classification = 'empty'
         ${opts.tenantId ? 'AND tenant_id = $1' : ''}`,
      opts.tenantId ? [opts.tenantId] : []
    );

    // 2) Teacher high-confidence positives -> accept the server class.
    const high = await this.db.query(
      `UPDATE image_classifications
         SET auto_label = classification,
             auto_label_source = 'teacher_high',
             auto_label_confidence = confidence,
             auto_labeled_at = NOW()
       WHERE user_corrected_class IS NULL
         AND auto_label IS NULL
         AND image_path IS NOT NULL
         AND classification IS NOT NULL
         AND classification <> 'empty'
         AND confidence >= $1
         ${tenantFilter}`,
      params
    );

    // 3) Teacher background: empty or very-low-confidence -> background.
    const bg = await this.db.query(
      `UPDATE image_classifications
         SET auto_label = 'empty',
             auto_label_source = 'teacher_bg',
             auto_label_confidence = confidence,
             auto_labeled_at = NOW()
       WHERE user_corrected_class IS NULL
         AND auto_label IS NULL
         AND image_path IS NOT NULL
         AND (classification = 'empty' OR confidence <= $2)
         ${tenantFilter}`,
      params
    );

    // What's left in the uncertain band = needs a human.
    const review = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM image_classifications
       WHERE user_corrected_class IS NULL
         AND auto_label IS NULL
         AND image_path IS NOT NULL
         ${opts.tenantId ? 'AND tenant_id = $1' : ''}`,
      opts.tenantId ? [opts.tenantId] : []
    );

    const result: AutoLabelResult = {
      teacherHigh: high.rowCount ?? 0,
      teacherBackground: bg.rowCount ?? 0,
      hardNegatives: hardNeg.rowCount ?? 0,
      leftForReview: review.rows[0]?.n ?? 0,
    };
    logger.info('[ACTIVE-LEARNING] auto-label pass complete', result as any);
    return result;
  }

  /**
   * Uncertain-band frames a human should label (one-tap). Excludes anything
   * already labeled (auto or corrected). Rodent-leaning first — those are the
   * costly ones to get wrong.
   */
  async getReviewQueue(tenantId: string, limit = 50): Promise<any[]> {
    const { rows } = await this.db.query(
      `SELECT id, device_id, classification, confidence, image_path,
              edge_verdict, edge_confidence, detections, classified_at
         FROM image_classifications
        WHERE tenant_id = $1
          AND user_corrected_class IS NULL
          AND auto_label IS NULL
          AND image_path IS NOT NULL
        ORDER BY (classification = ANY($2::text[])) DESC, confidence ASC, classified_at DESC
        LIMIT $3`,
      [tenantId, RODENT_CLASSES, limit]
    );
    return rows;
  }

  /** Dataset readiness — how much labeled data we have and how fresh. */
  async getStats(tenantId?: string): Promise<ActiveLearningStats> {
    const where = tenantId ? 'WHERE tenant_id = $1' : '';
    const p = tenantId ? [tenantId] : [];
    const { rows } = await this.db.query(
      `SELECT
         COUNT(*) FILTER (WHERE (user_corrected_class IS NOT NULL OR auto_label IS NOT NULL)
                            AND image_path IS NOT NULL)::int AS labeled_total,
         COUNT(*) FILTER (WHERE user_corrected_class IS NOT NULL)::int AS human_corrected,
         COUNT(*) FILTER (WHERE auto_label IS NOT NULL)::int AS auto_labeled,
         COUNT(*) FILTER (WHERE auto_label_source = 'hard_negative')::int AS hard_negatives,
         COUNT(*) FILTER (WHERE user_corrected_class IS NULL AND auto_label IS NULL
                            AND image_path IS NOT NULL)::int AS pending_review,
         COUNT(*) FILTER (WHERE (user_corrected_class IS NOT NULL OR auto_label IS NOT NULL)
                            AND image_path IS NOT NULL AND in_training_set = FALSE)::int AS new_since_batch
       FROM image_classifications ${where}`,
      p
    );
    const labelCounts = await this.db.query(
      `SELECT COALESCE(user_corrected_class, auto_label) AS label, COUNT(*)::int AS n
         FROM image_classifications
        WHERE (user_corrected_class IS NOT NULL OR auto_label IS NOT NULL)
          AND image_path IS NOT NULL ${tenantId ? 'AND tenant_id = $1' : ''}
        GROUP BY 1`,
      p
    );
    const byLabel: Record<string, number> = {};
    for (const r of labelCounts.rows) byLabel[r.label] = r.n;
    const s = rows[0];
    return {
      labeledTotal: s.labeled_total,
      humanCorrected: s.human_corrected,
      autoLabeled: s.auto_labeled,
      hardNegatives: s.hard_negatives,
      pendingReview: s.pending_review,
      byLabel,
      newSinceLastBatch: s.new_since_batch,
    };
  }

  /**
   * Tag all currently-labeled, not-yet-exported rows as belonging to a training
   * batch (called by the export step so the next "newSinceLastBatch" is correct).
   * Returns the number of rows tagged.
   */
  async markTrainingBatch(batchId: string, tenantId?: string): Promise<number> {
    const res = await this.db.query(
      `UPDATE image_classifications
          SET in_training_set = TRUE, training_batch = $1
        WHERE (user_corrected_class IS NOT NULL OR auto_label IS NOT NULL)
          AND image_path IS NOT NULL
          AND in_training_set = FALSE
          ${tenantId ? 'AND tenant_id = $2' : ''}`,
      tenantId ? [batchId, tenantId] : [batchId]
    );
    return res.rowCount ?? 0;
  }
}

let activeLearningService: ActiveLearningService | null = null;

export function initActiveLearningService(db: Pool): ActiveLearningService {
  activeLearningService = new ActiveLearningService(db);
  return activeLearningService;
}

export function getActiveLearningService(): ActiveLearningService | null {
  return activeLearningService;
}
