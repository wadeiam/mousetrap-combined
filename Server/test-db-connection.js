const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function testDatabaseConnection() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'mousetrap_monitor',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    console.log('Testing database connection...');
    console.log('DB Config:', {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
    });

    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✓ Database connection successful\n');

    // Check if users table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'users'
      );
    `);
    console.log('✓ Users table exists:', tableCheck.rows[0].exists);

    // Check if tenants table exists
    const tenantsCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'tenants'
      );
    `);
    console.log('✓ Tenants table exists:', tenantsCheck.rows[0].exists);

    // Check admin user
    console.log('\nQuerying admin user...');
    const userResult = await pool.query(`
      SELECT u.id, u.email, u.password_hash, u.role, u.totp_enabled,
             u.tenant_id, t.name as tenant_name, u.is_active
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE u.email = $1 AND u.is_active = true
    `, ['admin@mastertenant.com']);

    if (userResult.rows.length === 0) {
      console.log('✗ User not found!');

      // Check if user exists but is inactive
      const inactiveCheck = await pool.query(
        'SELECT email, is_active FROM users WHERE email = $1',
        ['admin@mastertenant.com']
      );

      if (inactiveCheck.rows.length > 0) {
        console.log('User exists but is_active =', inactiveCheck.rows[0].is_active);
      } else {
        console.log('User does not exist in database at all');

        // List all users
        const allUsers = await pool.query('SELECT email, is_active, role FROM users LIMIT 10');
        console.log('\nAll users in database:');
        console.table(allUsers.rows);
      }
    } else {
      const user = userResult.rows[0];
      console.log('✓ User found:', {
        id: user.id,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        tenant_name: user.tenant_name,
        totp_enabled: user.totp_enabled,
        is_active: user.is_active,
      });

      // Test password verification
      console.log('\nTesting password verification...');
      const testPassword = 'Admin123!';
      const isValidPassword = await bcrypt.compare(testPassword, user.password_hash);
      console.log('Password "Admin123!" is valid:', isValidPassword);

      if (!isValidPassword) {
        console.log('\nPassword hash in DB:', user.password_hash);
        console.log('\nTesting if hash is correct format...');

        // Generate a new hash to compare
        const newHash = await bcrypt.hash(testPassword, 10);
        console.log('New hash generated:', newHash);
        const newHashWorks = await bcrypt.compare(testPassword, newHash);
        console.log('New hash works:', newHashWorks);
      }
    }

    await pool.end();
  } catch (error) {
    console.error('✗ Database error:', error.message);
    console.error('Full error:', error);
    await pool.end();
    process.exit(1);
  }
}

testDatabaseConnection();
