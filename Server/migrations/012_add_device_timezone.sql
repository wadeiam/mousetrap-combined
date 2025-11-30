-- ============================================================================
-- Add timezone column to devices table
-- Migration: 012_add_device_timezone.sql
-- ============================================================================

-- Add timezone column to devices table
-- Stores IANA timezone string (e.g., "America/Los_Angeles", "Europe/London")
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='timezone') THEN
    ALTER TABLE devices ADD COLUMN timezone VARCHAR(64) DEFAULT 'UTC';
  END IF;
END $$;

COMMENT ON COLUMN devices.timezone IS 'IANA timezone string for device (e.g., America/Los_Angeles)';
