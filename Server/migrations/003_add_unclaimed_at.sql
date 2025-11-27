-- Migration: Add unclaimed_at column for soft-delete functionality
-- Date: 2025-11-07
-- Description: Supports device-initiated unclaim with 6-month retention

-- Add unclaimed_at timestamp column to devices table
ALTER TABLE devices
ADD COLUMN unclaimed_at TIMESTAMP DEFAULT NULL;

-- Add index for cleanup queries
CREATE INDEX idx_devices_unclaimed_at ON devices(unclaimed_at)
WHERE unclaimed_at IS NOT NULL;

-- Add comment to column
COMMENT ON COLUMN devices.unclaimed_at IS 'Timestamp when device was unclaimed. NULL = claimed, NOT NULL = unclaimed. Devices with unclaimed_at older than 6 months will be deleted by cleanup job.';
