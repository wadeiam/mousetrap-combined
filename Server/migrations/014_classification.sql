-- Migration: 014_classification.sql
-- Description: Add image classification support for rodent detection
-- Date: 2025-12-01

-- Table to store classification results
CREATE TABLE IF NOT EXISTS image_classifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Image data (optional - can reference device snapshot instead)
    image_hash VARCHAR(64),  -- SHA256 of image for deduplication

    -- Classification results
    classification VARCHAR(50) NOT NULL,  -- 'mouse', 'rat', 'cat', 'dog', 'human', 'bird', 'insect', 'unknown', 'empty'
    confidence FLOAT NOT NULL,  -- 0.0 to 1.0
    all_predictions JSONB,  -- Full prediction array: [{class: 'mouse', confidence: 0.92}, ...]

    -- Metadata
    model_version VARCHAR(50),  -- Track which model made the prediction
    inference_time_ms INTEGER,  -- Performance tracking
    image_source VARCHAR(50),  -- 'scout', 'trap', 'manual_upload'

    -- User feedback for model improvement
    user_corrected_class VARCHAR(50),  -- If user corrects the classification
    corrected_at TIMESTAMP WITH TIME ZONE,
    corrected_by UUID REFERENCES users(id),

    -- Timestamps
    classified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_classifications_device ON image_classifications(device_id);
CREATE INDEX idx_classifications_tenant ON image_classifications(tenant_id);
CREATE INDEX idx_classifications_class ON image_classifications(classification);
CREATE INDEX idx_classifications_created ON image_classifications(created_at DESC);
CREATE INDEX idx_classifications_confidence ON image_classifications(confidence);

-- Index for finding corrections (training data)
CREATE INDEX idx_classifications_corrected ON image_classifications(user_corrected_class)
    WHERE user_corrected_class IS NOT NULL;

-- Add classification tracking to devices table
ALTER TABLE devices
ADD COLUMN IF NOT EXISTS last_classification VARCHAR(50),
ADD COLUMN IF NOT EXISTS last_classification_confidence FLOAT,
ADD COLUMN IF NOT EXISTS last_classification_at TIMESTAMP WITH TIME ZONE;

-- Scout device type support (for entry point monitors)
-- Reuse devices table with a device_type discriminator
ALTER TABLE devices
ADD COLUMN IF NOT EXISTS device_type VARCHAR(20) DEFAULT 'trap';

COMMENT ON COLUMN devices.device_type IS 'Device type: trap, scout, bait_monitor';

-- Notification preferences for classification alerts
ALTER TABLE notification_preferences
ADD COLUMN IF NOT EXISTS rodent_detection_alerts BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS alert_on_confidence_above FLOAT DEFAULT 0.7;

COMMENT ON TABLE image_classifications IS 'Stores AI classification results for images from devices';
COMMENT ON COLUMN image_classifications.classification IS 'Primary classification: mouse, rat, cat, dog, human, bird, insect, unknown, empty';
COMMENT ON COLUMN image_classifications.user_corrected_class IS 'Human-corrected classification for model training feedback';
