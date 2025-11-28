-- Migration 008: Add device claim audit table
-- This enables:
-- 1. Complete audit trail of all claim/unclaim operations
-- 2. Tracking who initiated the action and from where
-- 3. Historical record for debugging and security analysis

-- Create audit table for device claim operations
CREATE TABLE IF NOT EXISTS device_claim_audit (
  id SERIAL PRIMARY KEY,
  device_id UUID,                           -- May be NULL if device was deleted
  device_mac VARCHAR(20) NOT NULL,          -- MAC address (always stored)
  device_name VARCHAR(100),                 -- Device name at time of action
  tenant_id UUID,                           -- Tenant ID at time of action

  -- Action details
  action VARCHAR(20) NOT NULL,              -- 'unclaim', 'claim', 'move', 'reclaim'
  trigger_source VARCHAR(30) NOT NULL,      -- 'admin_dashboard', 'device_factory_reset',
                                            -- 'device_local_ui', 'tenant_delete', 'mqtt_revoke'

  -- Actor info
  actor_user_id UUID,                       -- User ID if admin action (NULL for device-initiated)
  actor_ip VARCHAR(45),                     -- IP address of actor

  -- Context
  reason TEXT,                              -- Human-readable reason
  metadata JSONB DEFAULT '{}',              -- Additional context (e.g., old tenant for moves)

  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_claim_audit_device_id ON device_claim_audit(device_id);
CREATE INDEX IF NOT EXISTS idx_claim_audit_device_mac ON device_claim_audit(device_mac);
CREATE INDEX IF NOT EXISTS idx_claim_audit_tenant_id ON device_claim_audit(tenant_id);
CREATE INDEX IF NOT EXISTS idx_claim_audit_created_at ON device_claim_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_claim_audit_action ON device_claim_audit(action);

-- Add comments explaining the table
COMMENT ON TABLE device_claim_audit IS 'Audit log of all device claim/unclaim operations for security and debugging';
COMMENT ON COLUMN device_claim_audit.trigger_source IS 'Source of the action: admin_dashboard, device_factory_reset, device_local_ui, tenant_delete, mqtt_revoke';
COMMENT ON COLUMN device_claim_audit.action IS 'Type of action: unclaim, claim, move, reclaim';
