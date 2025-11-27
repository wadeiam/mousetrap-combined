-- ============================================================================
-- Device Claim/Provisioning System
-- Migration: 002_create_claim_system.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Claim Codes Table
-- Used for device provisioning - one-time codes to claim devices
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Code
  claim_code VARCHAR(8) UNIQUE NOT NULL,

  -- Tenant association
  tenant_id VARCHAR(50) NOT NULL DEFAULT 'dev',

  -- Device metadata
  device_name VARCHAR(100) NOT NULL,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'claimed', 'expired'
  claimed_at TIMESTAMP,
  claimed_by_device_id UUID,

  -- Expiration
  expires_at TIMESTAMP NOT NULL,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_claim_codes_status ON claim_codes(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_claim_codes_tenant ON claim_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_claim_codes_code ON claim_codes(claim_code);

-- ----------------------------------------------------------------------------
-- Update Devices Table - Add claim/MQTT fields
-- ----------------------------------------------------------------------------

-- Add UUID id column if not exists (keep serial id for backwards compatibility)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='uuid') THEN
    ALTER TABLE devices ADD COLUMN uuid UUID DEFAULT gen_random_uuid();
  END IF;
END $$;

-- Add device_name if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='device_name') THEN
    ALTER TABLE devices ADD COLUMN device_name VARCHAR(100);
  END IF;
END $$;

-- Add MQTT credentials columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='mqtt_client_id') THEN
    ALTER TABLE devices ADD COLUMN mqtt_client_id VARCHAR(100) UNIQUE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='mqtt_username') THEN
    ALTER TABLE devices ADD COLUMN mqtt_username VARCHAR(100) UNIQUE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='mqtt_password') THEN
    ALTER TABLE devices ADD COLUMN mqtt_password VARCHAR(100);
  END IF;
END $$;

-- Add hardware_version if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='hardware_version') THEN
    ALTER TABLE devices ADD COLUMN hardware_version VARCHAR(50);
  END IF;
END $$;

-- Add claimed_at timestamp
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='claimed_at') THEN
    ALTER TABLE devices ADD COLUMN claimed_at TIMESTAMP;
  END IF;
END $$;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_devices_uuid ON devices(uuid);
CREATE INDEX IF NOT EXISTS idx_devices_mqtt_client ON devices(mqtt_client_id);
CREATE INDEX IF NOT EXISTS idx_devices_mqtt_username ON devices(mqtt_username);

-- ----------------------------------------------------------------------------
-- Tenants Table (if doesn't exist)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default 'dev' tenant if not exists
INSERT INTO tenants (id, name)
VALUES ('dev', 'Development')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Users Table (if doesn't exist - for auth system)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  tenant_id VARCHAR(50) REFERENCES tenants(id),
  totp_secret VARCHAR(255),
  totp_enabled BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create default admin user if not exists (password: 'admin123' - CHANGE THIS!)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@dev.local') THEN
    INSERT INTO users (email, password_hash, role, tenant_id)
    VALUES (
      'admin@dev.local',
      '$2b$10$rRq3MqCqE.Wn0FLhRx8eJOXKZ8mF5tYvXxqX8p5uN5kJxqN5vN5vN', -- bcrypt hash of 'admin123'
      'admin',
      'dev'
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------
COMMENT ON TABLE claim_codes IS 'One-time codes for device provisioning/claiming';
COMMENT ON TABLE tenants IS 'Multi-tenant organizations';
COMMENT ON TABLE users IS 'User accounts for dashboard access';

COMMENT ON COLUMN devices.uuid IS 'UUID for device (for claim system compatibility)';
COMMENT ON COLUMN devices.device_name IS 'Human-readable device name';
COMMENT ON COLUMN devices.mqtt_client_id IS 'MQTT client ID (tenant_MAC format)';
COMMENT ON COLUMN devices.mqtt_username IS 'MQTT username for authentication';
COMMENT ON COLUMN devices.mqtt_password IS 'Bcrypt hashed MQTT password';
COMMENT ON COLUMN devices.claimed_at IS 'When device was claimed/provisioned';
