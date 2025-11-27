import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import dotenv from 'dotenv';
import setupRoutes from './routes/setup.routes';

// Load environment variables
dotenv.config();

const app = express();
const CLAIM_PORT = 4000;
const HOST = process.env.HOST || '0.0.0.0';

// Database connection
const dbPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test database connection
dbPool.query('SELECT NOW()')
  .then(() => console.log('[CLAIM] ✓ Database connected'))
  .catch((err: Error) => {
    console.error('[CLAIM] ✗ Database connection failed:', err.message);
    console.warn('[CLAIM]   Server will continue without database connection');
  });

// Middleware
app.use(cors({
  origin: '*', // Devices need to access this from any IP
  credentials: false,
}));
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[CLAIM] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Make database pool available to routes
(app as any).locals.dbPool = dbPool;

// Mount setup routes (register-and-claim for captive portal flow)
app.use('/api/setup', setupRoutes);

// Helper function to generate claim code
function generateClaimCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omit ambiguous chars (0, O, 1, I)
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ============================================================================
// POST /api/devices/claim - Device Claim Endpoint
// ============================================================================
app.post('/api/devices/claim', async (req: Request, res: Response) => {
  try {
    const { claimCode, deviceInfo } = req.body;

    console.log('[CLAIM] Device claim request:', { claimCode, deviceInfo });

    if (!claimCode || !deviceInfo) {
      return res.status(400).json({
        success: false,
        error: 'Missing claimCode or deviceInfo',
      });
    }

    // 1. Validate claim code
    const codeResult = await dbPool.query(
      `SELECT * FROM claim_codes
       WHERE claim_code = $1 AND status = $2 AND expires_at > NOW()`,
      [claimCode, 'active']
    );

    if (codeResult.rows.length === 0) {
      console.log('[CLAIM] Invalid or expired claim code:', claimCode);
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired claim code',
      });
    }

    const code = codeResult.rows[0];
    console.log('[CLAIM] Valid claim code found:', code);

    // 2. Check if device already exists
    const existingDevice = await dbPool.query(
      'SELECT id FROM devices WHERE mqtt_client_id = $1',
      [deviceInfo.macAddress?.replace(/:/g, '')]
    );

    if (existingDevice.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Device already claimed',
      });
    }

    // 3. Generate MQTT credentials
    const deviceId = crypto.randomUUID();
    const mqttClientId = `${deviceInfo.macAddress.replace(/:/g, '')}`;
    const mqttUsername = mqttClientId; // Use MAC address as username
    const mqttPassword = crypto.randomBytes(16).toString('hex');
    const mqttPasswordHash = await bcrypt.hash(mqttPassword, 10);

    console.log('[CLAIM] Generated credentials:', {
      deviceId,
      mqttClientId,
      mqttUsername,
    });

    // 4. Insert device
    const insertResult = await dbPool.query(
      `INSERT INTO devices (
        id, tenant_id, mqtt_client_id, name, device_name,
        mqtt_username, mqtt_password,
        hardware_version, firmware_version, filesystem_version,
        status, claimed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING id, mqtt_client_id, mqtt_username, name`,
      [
        deviceId,
        code.tenant_id,
        mqttClientId,
        code.device_name,
        code.device_name,
        mqttUsername,
        mqttPasswordHash,
        deviceInfo.hardwareVersion || 'ESP32',
        deviceInfo.firmwareVersion || '1.0.0',
        deviceInfo.filesystemVersion || '1.0.0',
        'offline', // Initial status
      ]
    );

    console.log('[CLAIM] Device inserted:', insertResult.rows[0]);

    // 5. Mark claim code as used
    await dbPool.query(
      `UPDATE claim_codes
       SET status = $1, claimed_at = NOW(), claimed_by_device_id = $2
       WHERE id = $3`,
      ['claimed', deviceId, code.id]
    );

    // 6. Return credentials to device (IMPORTANT: password is plain text, one-time visible)
    const response = {
      success: true,
      data: {
        deviceId,
        tenantId: code.tenant_id,
        mqttClientId,
        mqttUsername,
        mqttPassword, // Plain text password for device to store
        mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        deviceName: code.device_name,
      },
    };

    console.log('[CLAIM] ✓ Device claimed successfully:', deviceId);

    res.json(response);
  } catch (error: any) {
    console.error('[CLAIM] Error during device claim:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during device claim',
      details: error.message,
    });
  }
});

// ============================================================================
// POST /api/admin/claim-codes - Generate new claim code
// ============================================================================
app.post('/api/admin/claim-codes', async (req: Request, res: Response) => {
  try {
    const { deviceName, tenantId } = req.body;

    if (!deviceName) {
      return res.status(400).json({
        success: false,
        error: 'deviceName is required',
      });
    }

    // Use Master Tenant as default
    const finalTenantId = tenantId || '00000000-0000-0000-0000-000000000001';

    // Generate unique claim code
    let claimCode: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      claimCode = generateClaimCode();
      const existing = await dbPool.query(
        'SELECT id FROM claim_codes WHERE claim_code = $1',
        [claimCode]
      );

      if (existing.rows.length === 0) {
        break;
      }

      attempts++;
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate unique claim code',
      });
    }

    // Set expiration to 7 days from now
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await dbPool.query(
      `INSERT INTO claim_codes (claim_code, tenant_id, device_name, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, claim_code, tenant_id, device_name, expires_at, created_at`,
      [claimCode, finalTenantId, deviceName, expiresAt]
    );

    console.log('[CLAIM] ✓ New claim code generated:', claimCode);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('[CLAIM] Error generating claim code:', error);
    res.status(500).json({
      success: false,
      error: 'Server error generating claim code',
      details: error.message,
    });
  }
});

// ============================================================================
// GET /api/admin/claim-codes - List all claim codes
// ============================================================================
app.get('/api/admin/claim-codes', async (req: Request, res: Response) => {
  try {
    const result = await dbPool.query(
      `SELECT
        cc.id, cc.claim_code, cc.tenant_id, cc.device_name, cc.status,
        cc.claimed_at, cc.claimed_by_device_id, cc.expires_at, cc.created_at,
        t.name as tenant_name
       FROM claim_codes cc
       LEFT JOIN tenants t ON cc.tenant_id = t.id
       ORDER BY cc.created_at DESC
       LIMIT 100`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('[CLAIM] Error listing claim codes:', error);
    res.status(500).json({
      success: false,
      error: 'Server error listing claim codes',
      details: error.message,
    });
  }
});

// ============================================================================
// GET /api/admin/devices - List all devices
// ============================================================================
app.get('/api/admin/devices', async (req: Request, res: Response) => {
  try {
    const result = await dbPool.query(
      `SELECT
        d.id, d.tenant_id, d.mqtt_client_id, d.name, d.device_name,
        d.mqtt_username, d.status, d.firmware_version, d.filesystem_version,
        d.last_seen, d.claimed_at, d.created_at,
        t.name as tenant_name
       FROM devices d
       LEFT JOIN tenants t ON d.tenant_id = t.id
       ORDER BY d.claimed_at DESC NULLS LAST
       LIMIT 100`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('[CLAIM] Error listing devices:', error);
    res.status(500).json({
      success: false,
      error: 'Server error listing devices',
      details: error.message,
    });
  }
});

// ============================================================================
// Health check endpoint
// ============================================================================
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await dbPool.query('SELECT 1');
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response) => {
  console.error('[CLAIM] Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(CLAIM_PORT, HOST, () => {
  console.log(`[CLAIM] ✓ Server running on ${HOST}:${CLAIM_PORT}`);
  console.log(`[CLAIM]   Health check: http://localhost:${CLAIM_PORT}/health`);
  console.log(`[CLAIM]   Claim endpoint: http://localhost:${CLAIM_PORT}/api/devices/claim`);
  console.log(`[CLAIM]   Setup endpoint: http://localhost:${CLAIM_PORT}/api/setup/register-and-claim`);
  console.log(`[CLAIM]   Admin endpoint: http://localhost:${CLAIM_PORT}/api/admin/claim-codes`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[CLAIM] SIGTERM received, shutting down gracefully...');
  dbPool.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[CLAIM] SIGINT received, shutting down gracefully...');
  dbPool.end();
  process.exit(0);
});

export { app, dbPool };
