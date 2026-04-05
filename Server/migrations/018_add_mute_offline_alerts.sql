-- Migration 018: Add mute offline alerts feature
-- Allows users to suppress offline notifications for specific devices
-- Useful for devices that are intentionally offline (e.g., seasonal, maintenance)

-- Add column to mute offline alerts (NULL = not muted, timestamp = muted until that time)
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS mute_offline_until TIMESTAMP WITH TIME ZONE;

-- Add column for permanent mute (ignores mute_offline_until if true)
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS mute_offline_permanently BOOLEAN DEFAULT false;

-- Index for efficient lookup of muted devices
CREATE INDEX IF NOT EXISTS idx_devices_mute_offline
  ON devices (mute_offline_until)
  WHERE mute_offline_until IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN devices.mute_offline_until IS 'If set, offline alerts are muted until this timestamp';
COMMENT ON COLUMN devices.mute_offline_permanently IS 'If true, offline alerts are permanently muted for this device';
