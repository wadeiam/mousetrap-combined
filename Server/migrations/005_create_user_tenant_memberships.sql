-- ============================================================================
-- Multi-Tenant User Memberships
-- Migration: 005_create_user_tenant_memberships.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- User Role Enum
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('viewer', 'operator', 'admin', 'superadmin');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- User Tenant Memberships Table
-- Allows users to belong to multiple tenants with different roles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id VARCHAR(50) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Role in this specific tenant
  role user_role NOT NULL DEFAULT 'viewer',

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  UNIQUE(user_id, tenant_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_user_tenant_memberships_user_id ON user_tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_memberships_tenant_id ON user_tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_memberships_role ON user_tenant_memberships(role);

-- ----------------------------------------------------------------------------
-- Update Users Table - Make tenant_id and role optional
-- (Since users can now belong to multiple tenants via memberships)
-- ----------------------------------------------------------------------------

-- Drop the old FK constraint if it exists (allows null tenant_id)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE table_name='users' AND constraint_name='users_tenant_id_fkey') THEN
    ALTER TABLE users DROP CONSTRAINT users_tenant_id_fkey;
  END IF;
END $$;

-- Make tenant_id nullable (users are now managed via user_tenant_memberships)
ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;

-- Add updated_at trigger for user_tenant_memberships
DROP TRIGGER IF EXISTS update_user_tenant_memberships_updated_at ON user_tenant_memberships;
CREATE TRIGGER update_user_tenant_memberships_updated_at
  BEFORE UPDATE ON user_tenant_memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- Migrate existing user tenant relationships
-- ----------------------------------------------------------------------------

-- Migrate existing users to user_tenant_memberships
INSERT INTO user_tenant_memberships (user_id, tenant_id, role)
SELECT
  id,
  COALESCE(tenant_id, '00000000-0000-0000-0000-000000000001') as tenant_id,
  CASE
    WHEN role = 'superadmin' THEN 'superadmin'::user_role
    WHEN role = 'admin' THEN 'admin'::user_role
    WHEN role = 'operator' THEN 'operator'::user_role
    ELSE 'viewer'::user_role
  END as role
FROM users
WHERE id NOT IN (SELECT user_id FROM user_tenant_memberships)
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------
COMMENT ON TABLE user_tenant_memberships IS 'Maps users to tenants with specific roles (many-to-many)';
COMMENT ON COLUMN user_tenant_memberships.role IS 'User role within this specific tenant: viewer < operator < admin < superadmin';
COMMENT ON TYPE user_role IS 'User permission levels in order: viewer(1) < operator(2) < admin(3) < superadmin(4)';
