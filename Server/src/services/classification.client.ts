/**
 * Classification Client
 *
 * HTTP client to call the external classification Docker service.
 * This keeps TensorFlow/ML dependencies isolated in a separate container.
 */

import { logger } from './logger.service';

export interface ClassificationResponse {
  success: boolean;
  classification: 'rodent' | 'pet' | 'person' | 'other' | 'unknown';
  confidence: number;
  topMatch: string;
  predictions: Array<{ className: string; probability: number }>;
  processingTimeMs?: number;
  error?: string;
}

export interface ClassificationClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: ClassificationClientConfig = {
  baseUrl: process.env.CLASSIFICATION_SERVICE_URL || 'http://localhost:3100',
  timeoutMs: 30000, // 30 seconds for cold starts
};

/**
 * Classify an image using the external classification service
 */
export async function classifyImage(
  imageBase64: string,
  config: Partial<ClassificationClientConfig> = {}
): Promise<ClassificationResponse> {
  const { baseUrl, timeoutMs } = { ...DEFAULT_CONFIG, ...config };

  const startTime = Date.now();

  try {
    // Ensure image has proper data URL prefix for the service
    const imageData = imageBase64.startsWith('data:image/')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}/classify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: imageData }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Classification service error', {
        status: response.status,
        error: errorText,
      });
      return {
        success: false,
        classification: 'unknown',
        confidence: 0,
        topMatch: 'error',
        predictions: [],
        error: `Service returned ${response.status}: ${errorText}`,
      };
    }

    const result = await response.json() as {
      success?: boolean;
      classification?: string;
      confidence?: number;
      topMatch?: string;
      predictions?: Array<{ className: string; probability: number }>;
    };

    return {
      success: result.success ?? true,
      classification: (result.classification as ClassificationResponse['classification']) || 'unknown',
      confidence: result.confidence || 0,
      topMatch: result.topMatch || result.classification || 'unknown',
      predictions: result.predictions || [],
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.error('Classification service timeout', { timeoutMs });
      return {
        success: false,
        classification: 'unknown',
        confidence: 0,
        topMatch: 'timeout',
        predictions: [],
        error: `Request timed out after ${timeoutMs}ms`,
      };
    }

    logger.error('Classification service connection error', {
      error: error.message,
    });

    return {
      success: false,
      classification: 'unknown',
      confidence: 0,
      topMatch: 'error',
      predictions: [],
      error: error.message,
    };
  }
}

/**
 * Check if the classification service is healthy
 */
export async function checkHealth(
  config: Partial<ClassificationClientConfig> = {}
): Promise<{ healthy: boolean; modelLoaded: boolean; error?: string }> {
  const { baseUrl, timeoutMs } = { ...DEFAULT_CONFIG, ...config };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second health check timeout

    const response = await fetch(`${baseUrl}/status`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { healthy: false, modelLoaded: false, error: `Status ${response.status}` };
    }

    const status = await response.json() as { modelLoaded?: boolean };
    return {
      healthy: true,
      modelLoaded: status.modelLoaded ?? false,
    };
  } catch (error: any) {
    return {
      healthy: false,
      modelLoaded: false,
      error: error.message,
    };
  }
}

/**
 * Preload the model on the classification service
 */
export async function preloadModel(
  config: Partial<ClassificationClientConfig> = {}
): Promise<boolean> {
  const { baseUrl, timeoutMs } = { ...DEFAULT_CONFIG, ...config };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60 second timeout for model loading

    const response = await fetch(`${baseUrl}/load-model`, {
      method: 'POST',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.error('Failed to preload classification model', {
        status: response.status,
      });
      return false;
    }

    const result = await response.json() as { loadTimeMs?: number };
    logger.info('Classification model preloaded', {
      loadTimeMs: result.loadTimeMs,
    });
    return true;
  } catch (error: any) {
    logger.error('Error preloading classification model', {
      error: error.message,
    });
    return false;
  }
}
