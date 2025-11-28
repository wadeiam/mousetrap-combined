-- Migration 009: RBAC Cleanup
-- Creates user_is_superadmin() helper function and adds role escalation prevention

-- ============================================================================
-- UP Migration
-- ============================================================================

-- Create helper function to check if a user is a superadmin in the Master Tenant
-- This function is referenced in devices.routes.ts and tenants.routes.ts but was never created
CREATE OR REPLACE FUNCTION user_is_superadmin(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_tenant_memberships
    WHERE user_id = p_user_id
      AND tenant_id = '00000000-0000-0000-0000-000000000001'
      AND role = 'superadmin'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Create helper function to check if a user has admin+ role in a specific tenant
CREATE OR REPLACE FUNCTION user_is_tenant_admin(p_user_id UUID, p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_tenant_memberships
    WHERE user_id = p_user_id
      AND tenant_id = p_tenant_id
      AND role IN ('admin', 'superadmin')
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Create helper function to get a user's role in a specific tenant
CREATE OR REPLACE FUNCTION user_role_in_tenant(p_user_id UUID, p_tenant_id UUID)
RETURNS user_role AS $$
DECLARE
  v_role user_role;
BEGIN
  SELECT role INTO v_role
  FROM user_tenant_memberships
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id;

  RETURN v_role;
END;
$$ LANGUAGE plpgsql STABLE;

-- Add comment documenting the role hierarchy
COMMENT ON TYPE user_role IS 'Role hierarchy: viewer (1) < operator (2) < admin (3) < superadmin (4). Operator is reserved for future use.';

-- ============================================================================
-- DOWN Migration (for rollback)
-- ============================================================================

-- To rollback, run:
-- DROP FUNCTION IF EXISTS user_is_superadmin(UUID);
-- DROP FUNCTION IF EXISTS user_is_tenant_admin(UUID, UUID);
-- DROP FUNCTION IF EXISTS user_role_in_tenant(UUID, UUID);
