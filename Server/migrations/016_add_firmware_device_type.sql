-- ============================================================================
-- Add device_type to firmware_versions
-- Migration: 016_add_firmware_device_type.sql
-- ============================================================================

-- Add device_type column to firmware_versions table
-- This allows firmware to be targeted at specific device types (scout, trap, etc.)
-- NULL means the firmware applies to all device types (legacy behavior)
ALTER TABLE firmware_versions
ADD COLUMN IF NOT EXISTS device_type VARCHAR(20) DEFAULT NULL;

-- Add index for efficient querying by device_type
CREATE INDEX IF NOT EXISTS idx_firmware_device_type ON firmware_versions(device_type);

-- Update unique constraint to include device_type
-- (allows same version for different device types)
ALTER TABLE firmware_versions DROP CONSTRAINT IF EXISTS firmware_versions_tenant_id_version_type_key;
ALTER TABLE firmware_versions ADD CONSTRAINT firmware_versions_tenant_version_type_device_key
  UNIQUE(tenant_id, version, type, device_type);

-- Comment for documentation
COMMENT ON COLUMN firmware_versions.device_type IS 'Target device type (scout, trap, null=all)';
