-- Migration: Add snapshot storage to devices table
-- Stores the last captured snapshot for each device

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS last_snapshot TEXT,
ADD COLUMN IF NOT EXISTS last_snapshot_at TIMESTAMP;

-- Index for querying devices with recent snapshots
CREATE INDEX IF NOT EXISTS idx_devices_last_snapshot_at ON devices(last_snapshot_at);

COMMENT ON COLUMN devices.last_snapshot IS 'Base64-encoded JPEG image data of the last camera snapshot';
COMMENT ON COLUMN devices.last_snapshot_at IS 'Timestamp when the last snapshot was captured';
