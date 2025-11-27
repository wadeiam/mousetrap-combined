#!/usr/bin/env tsx

/**
 * Script to add a user to user_tenant_memberships table as superadmin
 * Usage: tsx scripts/make-superadmin.ts <email> [tenant_id]
 */

import { Pool } from 'pg';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres123',
};

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function makeSuperadmin(email: string, tenantId: string = MASTER_TENANT_ID) {
  const pool = new Pool(DB_CONFIG);

  try {
    console.log(`\n🔍 Finding user: ${email}`);

    // Find user by email
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    const user = userResult.rows[0];
    console.log(`✅ Found user: ${user.email} (${user.id})`);

    // Check if membership already exists
    const existingMembership = await pool.query(
      'SELECT * FROM user_tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
      [user.id, tenantId]
    );

    if (existingMembership.rows.length > 0) {
      const currentRole = existingMembership.rows[0].role;
      if (currentRole === 'superadmin') {
        console.log(`ℹ️  User is already a superadmin in tenant ${tenantId}`);
      } else {
        // Update existing membership to superadmin
        await pool.query(
          'UPDATE user_tenant_memberships SET role = $1, updated_at = NOW() WHERE user_id = $2 AND tenant_id = $3',
          ['superadmin', user.id, tenantId]
        );
        console.log(`✅ Updated user role from '${currentRole}' to 'superadmin'`);
      }
    } else {
      // Insert new membership
      await pool.query(
        `INSERT INTO user_tenant_memberships (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [user.id, tenantId, 'superadmin']
      );
      console.log(`✅ Added user as superadmin to tenant ${tenantId}`);
    }

    // Verify the membership
    const verifyResult = await pool.query(
      `SELECT u.email, utm.tenant_id, t.name as tenant_name, utm.role
       FROM user_tenant_memberships utm
       JOIN users u ON utm.user_id = u.id
       JOIN tenants t ON utm.tenant_id = t.id
       WHERE u.email = $1`,
      [email]
    );

    console.log('\n📋 Current user memberships:');
    verifyResult.rows.forEach(row => {
      console.log(`   - ${row.tenant_name}: ${row.role}`);
    });

    console.log('\n✅ Success! User can now log in as superadmin.\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Main execution
const email = process.argv[2] || 'admin@mastertenant.com';
const tenantId = process.argv[3] || MASTER_TENANT_ID;

console.log('🚀 Make Superadmin Script');
console.log('========================');

makeSuperadmin(email, tenantId);
