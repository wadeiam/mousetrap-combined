-- Migration: 020_image_storage.sql
-- Description: Store image bytes on disk for training data + diagnostics.
--              Images were previously discarded after classification.
-- Date: 2026-04-11

-- Add storage-related columns to image_classifications
ALTER TABLE image_classifications
  ADD COLUMN IF NOT EXISTS image_path TEXT,
  ADD COLUMN IF NOT EXISTS image_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS image_width INTEGER,
  ADD COLUMN IF NOT EXISTS image_height INTEGER;

COMMENT ON COLUMN image_classifications.image_path IS
  'Relative path (from IMAGE_STORAGE_ROOT) to stored JPEG. NULL for legacy rows.';
COMMENT ON COLUMN image_classifications.image_size_bytes IS
  'Size of stored JPEG file in bytes.';

-- Index for efficient training-set exports (filter by class + confidence)
CREATE INDEX IF NOT EXISTS idx_classifications_training_export
  ON image_classifications(classification, confidence, classified_at)
  WHERE image_path IS NOT NULL;

-- Edge-verdict tracking for on-device CNN (Phase 3 groundwork - optional now)
ALTER TABLE image_classifications
  ADD COLUMN IF NOT EXISTS edge_verdict VARCHAR(50),
  ADD COLUMN IF NOT EXISTS edge_confidence FLOAT;

COMMENT ON COLUMN image_classifications.edge_verdict IS
  'On-device CNN classification if scout ran local inference. NULL if server-only.';
