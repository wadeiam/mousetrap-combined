const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function testLoginFlow() {
  const dbPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'mousetrap_monitor',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    const email = 'admin@mastertenant.com';
    const password = 'Admin123!';

    console.log('Simulating login flow for:', email);
    console.log('-----------------------------------\n');

    // Step 1: Query user from database (exact same query as in auth.routes.ts line 31-37)
    console.log('Step 1: Querying user from database...');
    const userResult = await dbPool.query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.totp_enabled,
              u.tenant_id, t.name as tenant_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );

    console.log('Query returned:', userResult.rows.length, 'rows');

    if (userResult.rows.length === 0) {
      console.log('✗ No user found!');
      await dbPool.end();
      return;
    }

    const user = userResult.rows[0];
    console.log('✓ User found:', {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      tenant_name: user.tenant_name,
    });

    // Step 2: Verify password
    console.log('\nStep 2: Verifying password...');
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    console.log('✓ Password valid:', isValidPassword);

    if (!isValidPassword) {
      console.log('✗ Invalid password!');
      await dbPool.end();
      return;
    }

    // Step 3: Generate JWT tokens
    console.log('\nStep 3: Generating JWT tokens...');
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    console.log('JWT Secret:', jwtSecret.substring(0, 10) + '...');

    try {
      const accessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
          tenantId: user.tenant_id,
        },
        jwtSecret,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      const refreshToken = jwt.sign(
        {
          userId: user.id,
          type: 'refresh',
        },
        jwtSecret,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
      );

      console.log('✓ Access token generated:', accessToken.substring(0, 50) + '...');
      console.log('✓ Refresh token generated:', refreshToken.substring(0, 50) + '...');

      // Step 4: Construct response
      console.log('\nStep 4: Constructing response...');
      const response = {
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            tenantId: user.tenant_id,
            tenantName: user.tenant_name,
            twoFactorEnabled: user.totp_enabled,
          },
        },
      };

      console.log('✓ Response constructed successfully');
      console.log('\n✓ LOGIN FLOW COMPLETED SUCCESSFULLY!\n');

    } catch (jwtError) {
      console.log('✗ JWT generation failed:', jwtError.message);
      console.log('Full error:', jwtError);
    }

    await dbPool.end();
  } catch (error) {
    console.error('\n✗ Login flow error:', error.message);
    console.error('Error stack:', error.stack);
    await dbPool.end();
    process.exit(1);
  }
}

testLoginFlow();
