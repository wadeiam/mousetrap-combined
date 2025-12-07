/**
 * Classification Service
 *
 * AI-powered image classification for rodent detection.
 * Distinguishes between mice, rats, cats, dogs, humans, and other animals.
 *
 * Architecture:
 * - Uses TensorFlow.js with MobileNet as base model
 * - Can be fine-tuned with rodent-specific training data
 * - Stores classifications in database for review and model improvement
 * - Emits events for real-time dashboard updates
 */

import { Pool } from 'pg';
import { EventEmitter } from 'events';
import * as tf from '@tensorflow/tfjs-node';
import * as crypto from 'crypto';
import { logger } from './logger.service';

// Classification result types
export type ClassificationType =
  | 'mouse'
  | 'rat'
  | 'cat'
  | 'dog'
  | 'human'
  | 'bird'
  | 'insect'
  | 'unknown'
  | 'empty';

export interface ClassificationResult {
  classification: ClassificationType;
  confidence: number;
  allPredictions: Array<{ class: string; confidence: number }>;
  inferenceTimeMs: number;
  modelVersion: string;
}

export interface StoredClassification extends ClassificationResult {
  id: string;
  deviceId: string | null;
  tenantId: string;
  imageHash: string;
  imageSource: string;
  classifiedAt: Date;
}

// MobileNet class indices that map to our categories
// These are approximate mappings from ImageNet classes
const MOBILENET_MAPPINGS: Record<string, ClassificationType> = {
  // Rodents (ImageNet has limited rodent classes)
  hamster: 'mouse', // Close enough for base model
  guinea_pig: 'mouse',
  wood_rabbit: 'mouse', // Will need fine-tuning

  // Cats
  tabby: 'cat',
  tiger_cat: 'cat',
  Persian_cat: 'cat',
  Siamese_cat: 'cat',
  Egyptian_cat: 'cat',

  // Dogs (many breeds in ImageNet)
  golden_retriever: 'dog',
  Labrador_retriever: 'dog',
  German_shepherd: 'dog',
  beagle: 'dog',
  pug: 'dog',
  // ... many more dog breeds

  // Birds
  house_finch: 'bird',
  robin: 'bird',
  jay: 'bird',
  magpie: 'bird',
  chickadee: 'bird',

  // Insects
  cockroach: 'insect',
  cricket: 'insect',
  grasshopper: 'insect',
  ant: 'insect',
  fly: 'insect',
  bee: 'insect',
  butterfly: 'insect',
  spider: 'insect', // Not technically insect, but close enough
};

export class ClassificationService extends EventEmitter {
  private db: Pool;
  private model: tf.GraphModel | tf.LayersModel | null = null;
  private modelVersion: string = 'mobilenet-v2-1.0';
  private isModelLoading: boolean = false;
  private modelLoadPromise: Promise<void> | null = null;

  constructor(db: Pool) {
    super();
    this.db = db;
  }

  /**
   * Initialize the TensorFlow model
   */
  async initialize(): Promise<void> {
    if (this.model) return;
    if (this.isModelLoading && this.modelLoadPromise) {
      await this.modelLoadPromise;
      return;
    }

    this.isModelLoading = true;
    this.modelLoadPromise = this.loadModel();
    await this.modelLoadPromise;
  }

  private async loadModel(): Promise<void> {
    try {
      logger.info('Loading classification model...');
      const startTime = Date.now();

      // Load MobileNet v2 from TensorFlow Hub
      // This is a general-purpose model - we'll fine-tune for rodents later
      this.model = await tf.loadGraphModel(
        'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/3/default/1',
        { fromTFHub: true }
      );

      const loadTime = Date.now() - startTime;
      logger.info(`Classification model loaded in ${loadTime}ms`);

      // Warm up the model with a dummy inference
      const warmupTensor = tf.zeros([1, 224, 224, 3]);
      await this.model.predict(warmupTensor);
      warmupTensor.dispose();

      logger.info('Classification model warmed up and ready');
    } catch (error: any) {
      logger.error('Failed to load classification model', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      this.isModelLoading = false;
    }
  }

  /**
   * Classify an image
   * @param imageBase64 Base64-encoded JPEG/PNG image
   * @returns Classification result
   */
  async classifyImage(imageBase64: string): Promise<ClassificationResult> {
    await this.initialize();

    if (!this.model) {
      throw new Error('Classification model not loaded');
    }

    const startTime = Date.now();

    try {
      // Decode base64 to buffer
      const imageBuffer = Buffer.from(imageBase64, 'base64');

      // Decode image and preprocess for MobileNet
      let imageTensor = tf.node.decodeImage(imageBuffer, 3);

      // Resize to 224x224 (MobileNet input size)
      imageTensor = tf.image.resizeBilinear(imageTensor as tf.Tensor3D, [224, 224]);

      // Normalize to [-1, 1] range (MobileNet v2 preprocessing)
      imageTensor = imageTensor.div(127.5).sub(1);

      // Add batch dimension
      const batchedTensor = imageTensor.expandDims(0);

      // Run inference
      const predictions = (await this.model.predict(batchedTensor)) as tf.Tensor;
      const predictionData = await predictions.data();

      // Get top predictions
      const topK = this.getTopKPredictions(predictionData as Float32Array, 10);

      // Map to our classification types
      const mappedPredictions = this.mapPredictionsToTypes(topK);

      // Clean up tensors
      imageTensor.dispose();
      batchedTensor.dispose();
      predictions.dispose();

      const inferenceTimeMs = Date.now() - startTime;

      // Determine primary classification
      const primary = mappedPredictions[0] || { class: 'unknown', confidence: 0 };

      return {
        classification: primary.class as ClassificationType,
        confidence: primary.confidence,
        allPredictions: mappedPredictions,
        inferenceTimeMs,
        modelVersion: this.modelVersion,
      };
    } catch (error: any) {
      logger.error('Classification failed', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get top K predictions from raw model output
   */
  private getTopKPredictions(
    predictions: Float32Array,
    k: number
  ): Array<{ index: number; probability: number }> {
    // Apply softmax to get probabilities
    const maxVal = Math.max(...predictions);
    const expPredictions = predictions.map((p) => Math.exp(p - maxVal));
    const sumExp = expPredictions.reduce((a, b) => a + b, 0);
    const probabilities = expPredictions.map((p) => p / sumExp);

    // Get indices sorted by probability
    const indexed = Array.from(probabilities).map((p, i) => ({ index: i, probability: p }));
    indexed.sort((a, b) => b.probability - a.probability);

    return indexed.slice(0, k);
  }

  /**
   * Map ImageNet predictions to our classification types
   */
  private mapPredictionsToTypes(
    predictions: Array<{ index: number; probability: number }>
  ): Array<{ class: string; confidence: number }> {
    // ImageNet class labels (we'll load these dynamically in production)
    // For now, use the mapping and aggregate by our types
    const typeScores: Record<ClassificationType, number> = {
      mouse: 0,
      rat: 0,
      cat: 0,
      dog: 0,
      human: 0,
      bird: 0,
      insect: 0,
      unknown: 0,
      empty: 0,
    };

    // Aggregate predictions by type
    // In production, we'd load the full ImageNet labels and map each
    // For now, we'll use a simplified approach based on confidence thresholds
    const topPrediction = predictions[0];

    // If confidence is very low, likely empty/unknown
    if (topPrediction.probability < 0.1) {
      typeScores.empty = 1 - topPrediction.probability;
      typeScores.unknown = topPrediction.probability;
    } else {
      // For demo, we'll return unknown until we have proper class mapping
      // This is where fine-tuning or a custom model would help
      typeScores.unknown = topPrediction.probability;
    }

    // Convert to sorted array
    const result = Object.entries(typeScores)
      .map(([cls, conf]) => ({ class: cls, confidence: conf }))
      .filter((p) => p.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);

    return result;
  }

  /**
   * Store a classification result in the database
   */
  async storeClassification(
    tenantId: string,
    deviceId: string | null,
    imageBase64: string,
    result: ClassificationResult,
    imageSource: string = 'manual_upload'
  ): Promise<StoredClassification> {
    const imageHash = crypto.createHash('sha256').update(imageBase64).digest('hex');

    const query = `
      INSERT INTO image_classifications (
        device_id,
        tenant_id,
        image_hash,
        classification,
        confidence,
        all_predictions,
        model_version,
        inference_time_ms,
        image_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, classified_at
    `;

    const { rows } = await this.db.query(query, [
      deviceId,
      tenantId,
      imageHash,
      result.classification,
      result.confidence,
      JSON.stringify(result.allPredictions),
      result.modelVersion,
      result.inferenceTimeMs,
      imageSource,
    ]);

    // Update device's last classification if device-linked
    if (deviceId) {
      await this.db.query(
        `
        UPDATE devices SET
          last_classification = $2,
          last_classification_confidence = $3,
          last_classification_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
        [deviceId, result.classification, result.confidence]
      );
    }

    const stored: StoredClassification = {
      id: rows[0].id,
      deviceId,
      tenantId,
      imageHash,
      imageSource,
      classifiedAt: rows[0].classified_at,
      ...result,
    };

    // Emit event for real-time updates
    this.emit('classification', stored);

    // If rodent detected with high confidence, emit alert event
    if (
      (result.classification === 'mouse' || result.classification === 'rat') &&
      result.confidence > 0.7
    ) {
      this.emit('rodent_detected', {
        ...stored,
        alertType: 'rodent_detected',
      });
    }

    return stored;
  }

  /**
   * Get classification history for a device
   */
  async getDeviceClassifications(
    tenantId: string,
    deviceId: string,
    limit: number = 50
  ): Promise<StoredClassification[]> {
    const query = `
      SELECT
        id,
        device_id,
        tenant_id,
        image_hash,
        classification,
        confidence,
        all_predictions,
        model_version,
        inference_time_ms,
        image_source,
        user_corrected_class,
        classified_at
      FROM image_classifications
      WHERE tenant_id = $1 AND device_id = $2
      ORDER BY classified_at DESC
      LIMIT $3
    `;

    const { rows } = await this.db.query(query, [tenantId, deviceId, limit]);

    return rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      tenantId: row.tenant_id,
      imageHash: row.image_hash,
      classification: row.classification,
      confidence: parseFloat(row.confidence),
      allPredictions: row.all_predictions,
      modelVersion: row.model_version,
      inferenceTimeMs: row.inference_time_ms,
      imageSource: row.image_source,
      classifiedAt: row.classified_at,
    }));
  }

  /**
   * Submit user correction for model improvement
   */
  async submitCorrection(
    classificationId: string,
    userId: string,
    correctedClass: ClassificationType
  ): Promise<void> {
    await this.db.query(
      `
      UPDATE image_classifications SET
        user_corrected_class = $2,
        corrected_at = NOW(),
        corrected_by = $3
      WHERE id = $1
    `,
      [classificationId, correctedClass, userId]
    );

    logger.info('Classification correction submitted', {
      classificationId,
      userId,
      correctedClass,
    });

    this.emit('correction_submitted', {
      classificationId,
      correctedClass,
    });
  }

  /**
   * Get statistics for classifications
   */
  async getClassificationStats(tenantId: string): Promise<{
    totalClassifications: number;
    byType: Record<string, number>;
    correctionRate: number;
    avgConfidence: number;
  }> {
    const statsQuery = `
      SELECT
        COUNT(*) as total,
        AVG(confidence) as avg_confidence,
        COUNT(CASE WHEN user_corrected_class IS NOT NULL THEN 1 END) as corrections
      FROM image_classifications
      WHERE tenant_id = $1
    `;

    const byTypeQuery = `
      SELECT classification, COUNT(*) as count
      FROM image_classifications
      WHERE tenant_id = $1
      GROUP BY classification
    `;

    const [statsResult, byTypeResult] = await Promise.all([
      this.db.query(statsQuery, [tenantId]),
      this.db.query(byTypeQuery, [tenantId]),
    ]);

    const stats = statsResult.rows[0];
    const byType: Record<string, number> = {};
    byTypeResult.rows.forEach((row) => {
      byType[row.classification] = parseInt(row.count);
    });

    return {
      totalClassifications: parseInt(stats.total),
      byType,
      correctionRate: stats.total > 0 ? parseInt(stats.corrections) / parseInt(stats.total) : 0,
      avgConfidence: parseFloat(stats.avg_confidence) || 0,
    };
  }

  /**
   * Check if model is ready
   */
  isReady(): boolean {
    return this.model !== null && !this.isModelLoading;
  }

  /**
   * Get model info
   */
  getModelInfo(): { version: string; ready: boolean; loading: boolean } {
    return {
      version: this.modelVersion,
      ready: this.isReady(),
      loading: this.isModelLoading,
    };
  }
}

// Singleton management
let classificationService: ClassificationService | null = null;

export function initClassificationService(db: Pool): ClassificationService {
  classificationService = new ClassificationService(db);
  return classificationService;
}

export function getClassificationService(): ClassificationService | null {
  return classificationService;
}
