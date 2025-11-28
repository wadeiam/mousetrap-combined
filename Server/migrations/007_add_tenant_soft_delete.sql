-- Migration 007: Add soft-delete support for tenants and system settings
-- This enables:
-- 1. Soft-delete of tenants (deleted_at timestamp)
-- 2. System settings for configurable purge retention
-- 3. Cascade soft-delete of devices when tenant is soft-deleted

-- Add deleted_at column to tenants table for soft-delete
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;

-- Add index for efficient filtering of active tenants
CREATE INDEX IF NOT EXISTS idx_tenants_deleted_at
ON tenants(deleted_at)
WHERE deleted_at IS NULL;

-- Create system_settings table for global configuration
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
  ('tenant_purge_retention_days', '90', 'Number of days to retain soft-deleted tenants before permanent deletion'),
  ('device_purge_retention_days', '180', 'Number of days to retain unclaimed devices before permanent deletion')
ON CONFLICT (key) DO NOTHING;

-- Add comment explaining soft-delete behavior
COMMENT ON COLUMN tenants.deleted_at IS 'Timestamp when tenant was soft-deleted. NULL = active, NOT NULL = deleted. Deleted tenants and their data will be purged after the configured retention period.';
