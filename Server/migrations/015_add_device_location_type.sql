-- Migration 015: Add location_type to devices for scout activity recommendations
-- Used to determine whether to recommend sealing (entry_point) or trap placement (interior)

-- Add location_type column to devices
ALTER TABLE devices
ADD COLUMN IF NOT EXISTS location_type VARCHAR(20) DEFAULT 'interior'
CHECK (location_type IN ('entry_point', 'interior', 'both'));

-- Add comment for documentation
COMMENT ON COLUMN devices.location_type IS 'Scout location type: entry_point (recommend sealing), interior (recommend trapping), both';

-- Create index for filtering by location type
CREATE INDEX IF NOT EXISTS idx_devices_location_type ON devices(location_type);
