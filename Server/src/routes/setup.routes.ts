import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { syncMqttDevice } from '../utils/mqtt-auth';
import { logger } from '../services/logger.service';

const router = Router();

// Get database pool from parent app
let dbPool: Pool;
router.use((req: Request, _res: Response, next) => {
  if (!dbPool && (req.app as any).locals.dbPool) {
    dbPool = (req.app as any).locals.dbPool;
  }
  next();
});

// Constants for HMAC token verification
const DEVICE_CLAIM_SECRET = process.env.DEVICE_CLAIM_SECRET || 'mousetrap-device-secret-change-in-production';
const TOKEN_VALIDITY_SECONDS = 300; // 5 minutes

/**
 * Verify HMAC claim token from device
 * This proves the device is authentic and generated the token recently
 */
function verifyClaimToken(mac: string, timestamp: string, token: string): boolean {
  // Check timestamp freshness
  const tokenTime = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tokenTime) > TOKEN_VALIDITY_SECONDS) {
    console.log('[SETUP] Token expired:', { tokenTime, now, diff: Math.abs(now - tokenTime) });
    return false;
  }

  // Verify HMAC
  const data = `${mac}:${timestamp}`;
  const expected = crypto
    .createHmac('sha256', DEVICE_CLAIM_SECRET)
    .update(data)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(token.toLowerCase()),
      Buffer.from(expected.toLowerCase())
    );
  } catch (error) {
    console.log('[SETUP] Token verification failed:', error);
    return false;
  }
}

// ============================================================================
// POST /register-and-claim - Combined user registration and device claiming
// ============================================================================
router.post('/register-and-claim', async (req: Request, res: Response) => {
  try {
    const { email, password, deviceName, mac, claimToken, timestamp, isNewAccount = true } = req.body;

    console.log('========================================');
    console.log('[SETUP] Register and claim request');
    console.log('[SETUP] Email:', email);
    console.log('[SETUP] Device name:', deviceName);
    console.log('[SETUP] MAC:', mac);
    console.log('[SETUP] Is New Account:', isNewAccount);
    console.log('========================================');

    // ========================================================================
    // 1. Validate required fields
    // ========================================================================
    if (!email || !password || !deviceName || !mac || !claimToken || !timestamp) {
      console.log('[SETUP] Missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email, password, deviceName, mac, claimToken, timestamp',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
    }

    // Validate password strength (minimum 8 characters)
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long',
      });
    }

    // Validate MAC address format
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macRegex.test(mac)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid MAC address format (expected AA:BB:CC:DD:EE:FF)',
      });
    }

    // ========================================================================
    // 2. Verify HMAC claim token (proves device authenticity)
    // ========================================================================
    if (!verifyClaimToken(mac, timestamp, claimToken)) {
      console.log('[SETUP] Invalid or expired claim token');
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired claim token',
      });
    }
    console.log('[SETUP] Claim token verified successfully');
    logger.info('[SETUP] Step 2 PASSED: Claim token verified', { mac, email });

    // ========================================================================
    // 3. Check if user already exists and handle sign-in vs create
    // ========================================================================
    console.log('[SETUP] Step 3: Checking if user exists...');
    const existingUser = await dbPool.query(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email]
    );
    console.log('[SETUP] User query result:', { found: existingUser.rows.length > 0, isNewAccount });
    logger.info('[SETUP] Step 3: User check', { email, userExists: existingUser.rows.length > 0, isNewAccount });

    let userId: string = '';
    let tenantId: string = '';
    let userCreated = false;

    if (existingUser.rows.length > 0) {
      // User exists
      if (isNewAccount) {
        // Trying to create account but user exists
        console.log('[SETUP] User already exists, but isNewAccount=true:', email);
        return res.status(409).json({
          success: false,
          error: 'User with this email already exists. Please sign in instead.',
        });
      }

      // Sign in - verify password
      const user = existingUser.rows[0];
      const passwordValid = await bcrypt.compare(password, user.password_hash);
      if (!passwordValid) {
        console.log('[SETUP] Invalid password for existing user:', email);
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password',
        });
      }

      // Get user's tenant
      const tenantResult = await dbPool.query(
        `SELECT tenant_id FROM user_tenant_memberships WHERE user_id = $1 LIMIT 1`,
        [user.id]
      );
      if (tenantResult.rows.length === 0) {
        console.log('[SETUP] User has no tenant:', email);
        return res.status(500).json({
          success: false,
          error: 'User account is incomplete (no tenant). Contact support.',
        });
      }

      userId = user.id;
      tenantId = tenantResult.rows[0].tenant_id;
      console.log('[SETUP] Existing user signed in:', { userId, tenantId });
    } else {
      // User doesn't exist
      if (!isNewAccount) {
        // Trying to sign in but user doesn't exist
        console.log('[SETUP] User not found for sign-in:', email);
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password',
        });
      }
      // Will create new user in transaction below
      userCreated = true;
      console.log('[SETUP] Step 3 RESULT: Will create new user');
      logger.info('[SETUP] Step 3 PASSED: New user will be created', { email });
    }

    // ========================================================================
    // 4. Check if device is already claimed
    // ========================================================================
    const mqttClientId = mac.replace(/:/g, '');
    console.log('[SETUP] Step 4: Checking if device is claimed...', { mqttClientId });
    const existingDevice = await dbPool.query(
      'SELECT id, unclaimed_at FROM devices WHERE mqtt_client_id = $1',
      [mqttClientId]
    );
    console.log('[SETUP] Device query result:', {
      found: existingDevice.rows.length > 0,
      unclaimed_at: existingDevice.rows[0]?.unclaimed_at
    });
    logger.info('[SETUP] Step 4: Device check', {
      mqttClientId,
      deviceExists: existingDevice.rows.length > 0,
      unclaimed_at: existingDevice.rows[0]?.unclaimed_at
    });

    if (existingDevice.rows.length > 0) {
      const device = existingDevice.rows[0];

      // If device is currently claimed (not soft-deleted), reject
      if (device.unclaimed_at === null) {
        console.log('[SETUP] REJECTED: Device already claimed:', mac);
        logger.warn('[SETUP] Step 4 FAILED: Device already claimed', { mac, mqttClientId, deviceId: device.id });
        return res.status(409).json({
          success: false,
          error: 'Device already claimed',
        });
      }

      // Device was unclaimed - delete the old record to allow fresh claim
      console.log('[SETUP] Removing old unclaimed device record:', device.id);
      logger.info('[SETUP] Step 4: Deleting old unclaimed device', { deviceId: device.id, mqttClientId });
      await dbPool.query('DELETE FROM devices WHERE id = $1', [device.id]);
    }
    console.log('[SETUP] Step 4 PASSED: Device check complete');
    logger.info('[SETUP] Step 4 PASSED: Device can be claimed', { mqttClientId });

    // ========================================================================
    // 5. Start atomic transaction for user creation and device claiming
    // ========================================================================
    console.log('[SETUP] Step 5: Starting transaction...');
    logger.info('[SETUP] Step 5: BEGIN transaction', { email, mqttClientId, userCreated });
    await dbPool.query('BEGIN');

    try {
      // Only create user/tenant if this is a new account
      if (userCreated) {
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create tenant (using device name or email prefix as tenant name)
        const tenantName = `${email.split('@')[0]}'s Home`;
        const tenantResult = await dbPool.query(
          `INSERT INTO tenants (name, created_at, updated_at)
           VALUES ($1, NOW(), NOW())
           RETURNING id, name, created_at`,
          [tenantName.trim()]
        );

        const tenant = tenantResult.rows[0];
        tenantId = tenant.id;
        console.log('[SETUP] Tenant created:', { tenantId: tenant.id, tenantName: tenant.name });
        logger.info('New tenant created during setup', { tenantId: tenant.id, tenantName: tenant.name });

        // Create user (with tenant_id since users table requires it)
        const userResult = await dbPool.query(
          `INSERT INTO users (email, password_hash, tenant_id, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, true, NOW(), NOW())
           RETURNING id, email, created_at`,
          [email, passwordHash, tenantId]
        );

        const user = userResult.rows[0];
        userId = user.id;
        console.log('[SETUP] User created:', { userId: user.id, email: user.email });
        logger.info('New user created during setup', { userId: user.id, email: user.email });

        // Associate user with tenant as admin
        await dbPool.query(
          `INSERT INTO user_tenant_memberships (user_id, tenant_id, role, created_at)
           VALUES ($1, $2, 'admin', NOW())`,
          [user.id, tenant.id]
        );
        console.log('[SETUP] User associated with tenant as admin');
        logger.info('User associated with tenant', { userId: user.id, tenantId: tenant.id, role: 'admin' });
      } else {
        console.log('[SETUP] Using existing user/tenant:', { userId, tenantId });
      }

      // ======================================================================
      // 6. Generate MQTT credentials and create device
      // ======================================================================
      console.log('[SETUP] Step 6: Creating device...', { tenantId, deviceName });
      logger.info('[SETUP] Step 6: Creating device', { tenantId, deviceName, mqttClientId });

      const deviceId = crypto.randomUUID();
      const mqttUsername = mqttClientId; // Use MAC address without colons
      const mqttPassword = crypto.randomBytes(16).toString('hex');
      const mqttPasswordHash = await bcrypt.hash(mqttPassword, 10);

      console.log('[SETUP] Generated MQTT credentials:', {
        deviceId,
        mqttClientId,
        mqttUsername,
        tenantId,
      });

      // Insert device
      const deviceResult = await dbPool.query(
        `INSERT INTO devices (
          id, tenant_id, mqtt_client_id, name, device_name,
          mqtt_username, mqtt_password, mqtt_password_plain,
          hardware_version, firmware_version, filesystem_version,
          status, claimed_at, last_seen, online
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), true)
        RETURNING id, mqtt_client_id, mqtt_username, name`,
        [
          deviceId,
          tenantId,
          mqttClientId,
          deviceName,
          deviceName,
          mqttUsername,
          mqttPasswordHash,
          mqttPassword, // Store plaintext for Mosquitto sync
          'ESP32',
          '1.0.0',
          '1.0.0',
          'offline',
        ]
      );

      console.log('[SETUP] Step 6 PASSED: Device inserted:', deviceResult.rows[0]);
      logger.info('[SETUP] Step 6 PASSED: Device created', { deviceId, tenantId, name: deviceName });

      // ======================================================================
      // 7. Sync MQTT credentials to Mosquitto
      // ======================================================================
      try {
        console.log('[SETUP] Step 7: Syncing MQTT credentials to Mosquitto...');
        logger.info('[SETUP] Step 7: Syncing MQTT credentials', { mqttUsername, deviceId });
        await syncMqttDevice(mqttUsername, mqttPassword, true);
        console.log('[SETUP] Step 7 PASSED: MQTT credentials synced');
        logger.info('[SETUP] Step 7 PASSED: MQTT sync complete', { mqttUsername });
      } catch (mqttError: any) {
        console.error('[SETUP] Step 7 FAILED: MQTT sync error:', mqttError.message);
        logger.error('[SETUP] Step 7 FAILED: MQTT sync error', { error: mqttError.message, mqttUsername });
        // Rollback the transaction
        await dbPool.query('ROLLBACK');
        logger.error('[SETUP] Transaction ROLLED BACK due to MQTT error');
        return res.status(500).json({
          success: false,
          error: 'Failed to sync MQTT credentials. Please try again.',
          details: mqttError.message,
        });
      }

      // ======================================================================
      // 8. Commit transaction
      // ======================================================================
      await dbPool.query('COMMIT');
      console.log('[SETUP] Step 8 PASSED: Transaction committed successfully');
      logger.info('[SETUP] Step 8 PASSED: Transaction committed', { userId, tenantId, deviceId });

      // ======================================================================
      // 9. Generate JWT tokens
      // ======================================================================
      const jwtSecret = process.env.JWT_SECRET || 'default-secret';
      const accessToken = jwt.sign(
        {
          userId,
          email,
          tenantId,
          role: 'admin',
        },
        jwtSecret,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
      );

      const refreshToken = jwt.sign(
        {
          userId,
          type: 'refresh',
        },
        jwtSecret,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' } as SignOptions
      );

      // ======================================================================
      // 10. Return success response with all credentials
      // ======================================================================
      console.log('========================================');
      console.log('[SETUP] Setup completed successfully');
      console.log('[SETUP] User ID:', userId);
      console.log('[SETUP] Tenant ID:', tenantId);
      console.log('[SETUP] Device ID:', deviceId);
      console.log('[SETUP] New account:', userCreated);
      console.log('========================================');

      logger.info('Setup completed successfully', {
        userId,
        tenantId,
        deviceId,
        email,
        newAccount: userCreated,
      });

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: userId,
            email,
            tenantId,
          },
          device: {
            id: deviceId,
            name: deviceName,
            mqttClientId,
            mqttUsername,
            mqttPassword, // Plain text password for device to store
            mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://192.168.133.110:1883',
          },
          jwt: accessToken,
          refreshToken,
        },
        // Also return at top level for firmware compatibility
        deviceId,
        tenantId,
        mqttClientId,
        mqttBroker: process.env.MQTT_BROKER_URL || 'mqtt://192.168.133.110:1883',
        mqttCredentials: {
          username: mqttUsername,
          password: mqttPassword,
        },
      });
    } catch (txError: any) {
      // Rollback transaction on any error
      await dbPool.query('ROLLBACK');
      console.error('[SETUP] TRANSACTION ERROR - Rolling back:', txError.message);
      logger.error('[SETUP] Transaction failed and rolled back', {
        error: txError.message,
        code: txError.code,
        stack: txError.stack
      });
      throw txError;
    }
  } catch (error: any) {
    console.error('========================================');
    console.error('[SETUP] FATAL ERROR during register-and-claim');
    console.error('[SETUP] Error:', error.message);
    console.error('[SETUP] Code:', error.code);
    console.error('[SETUP] Stack:', error.stack);
    console.error('========================================');

    logger.error('[SETUP] FATAL ERROR', {
      error: error.message,
      code: error.code,
      stack: error.stack,
    });

    // Handle duplicate tenant name (unique constraint violation)
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A user or tenant with this information already exists.',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error during setup',
      details: error.message,
    });
  }
});

export default router;
