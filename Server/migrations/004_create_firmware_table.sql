-- ============================================================================
-- Firmware Management Database Schema
-- Migration: 004_create_firmware_table.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Firmware Versions Table
-- Stores firmware and filesystem releases for OTA updates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS firmware_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant association
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Version information
  version VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('firmware', 'filesystem')),

  -- File information
  url TEXT NOT NULL,                -- Download URL for devices
  size BIGINT NOT NULL,             -- File size in bytes
  sha256 VARCHAR(64) NOT NULL,      -- SHA256 checksum for integrity verification

  -- Metadata
  changelog TEXT,                   -- Release notes
  required BOOLEAN DEFAULT false,   -- If true, devices must update
  is_global BOOLEAN DEFAULT false,  -- If true, available to all tenants

  -- Lifecycle
  published_at TIMESTAMP DEFAULT NOW(),
  deprecated_at TIMESTAMP,          -- When this version was superseded
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  UNIQUE(tenant_id, version, type)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_firmware_tenant_id ON firmware_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_firmware_type ON firmware_versions(type);
CREATE INDEX IF NOT EXISTS idx_firmware_published ON firmware_versions(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_firmware_global ON firmware_versions(is_global) WHERE is_global = true;
CREATE INDEX IF NOT EXISTS idx_firmware_required ON firmware_versions(required) WHERE required = true;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_firmware_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_firmware_updated_at
BEFORE UPDATE ON firmware_versions
FOR EACH ROW
EXECUTE FUNCTION update_firmware_updated_at();
