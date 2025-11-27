const { Pool } = require('pg');
require('dotenv').config();

const dbPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function checkTenants() {
  try {
    console.log('=== CHECKING TENANTS IN DATABASE ===\n');

    // Check all tenants
    console.log('All tenants in database:');
    const tenants = await dbPool.query(
      'SELECT id, name, created_at FROM tenants ORDER BY created_at DESC'
    );
    console.log('Count:', tenants.rows.length);
    tenants.rows.forEach(t => {
      console.log(`  - ${t.name} (${t.id}) - Created: ${t.created_at}`);
    });

    // Check user_tenant_memberships
    console.log('\n\nUser-Tenant Memberships:');
    const memberships = await dbPool.query(
      `SELECT utm.user_id, u.email, utm.tenant_id, t.name as tenant_name, utm.role
       FROM user_tenant_memberships utm
       JOIN users u ON u.id = utm.user_id
       JOIN tenants t ON t.id = utm.tenant_id
       ORDER BY utm.created_at DESC`
    );
    console.log('Count:', memberships.rows.length);
    memberships.rows.forEach(m => {
      console.log(`  - ${m.email} -> ${m.tenant_name} (${m.role})`);
    });

    // Check if admin is superadmin
    console.log('\n\nChecking superadmin status for admin@mastertenant.com:');
    const adminCheck = await dbPool.query(
      `SELECT user_is_superadmin($1) as is_superadmin`,
      ['10000000-0000-0000-0000-000000000001']
    );
    console.log('Is superadmin:', adminCheck.rows[0].is_superadmin);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await dbPool.end();
  }
}

checkTenants();
