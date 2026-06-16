-- Migration 022: Active-learning columns on image_classifications
--
-- Adds automatic-labeling + training-batch tracking so the reinforce loop can
-- accumulate a labeled dataset with minimal human effort. Human corrections
-- (user_corrected_class) always take precedence over auto_label.

ALTER TABLE image_classifications
  -- Auto-assigned training label (teacher pseudo-label or hard negative).
  -- NULL = not auto-labeled yet (candidate for human review).
  ADD COLUMN IF NOT EXISTS auto_label VARCHAR(50),
  -- How the auto label was decided:
  --   'teacher_high'  server YOLO confidence >= accept threshold
  --   'teacher_bg'    classified empty / confidence <= reject threshold
  --   'hard_negative' edge said worth_sending but server found nothing (edge FP)
  ADD COLUMN IF NOT EXISTS auto_label_source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS auto_label_confidence FLOAT,
  ADD COLUMN IF NOT EXISTS auto_labeled_at TIMESTAMP WITH TIME ZONE,
  -- Training-batch bookkeeping: which export/retrain run consumed this row.
  ADD COLUMN IF NOT EXISTS in_training_set BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS training_batch VARCHAR(64);

-- The effective training label = COALESCE(user_corrected_class, auto_label).
-- Index rows that have one and aren't yet exported, for fast batch selection.
CREATE INDEX IF NOT EXISTS idx_classifications_trainable
  ON image_classifications (tenant_id, in_training_set)
  WHERE (user_corrected_class IS NOT NULL OR auto_label IS NOT NULL)
    AND image_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_classifications_batch
  ON image_classifications (training_batch)
  WHERE training_batch IS NOT NULL;

-- Fast lookup of edge/server disagreements (hard-negative mining).
CREATE INDEX IF NOT EXISTS idx_classifications_edge_disagree
  ON image_classifications (tenant_id, edge_verdict, classification);
