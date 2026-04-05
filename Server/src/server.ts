import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { MqttService, setMqttService } from './services/mqtt.service';
import { logger } from './services/logger.service';
import { initPushService, getPushService } from './services/push.service';
import { initEscalationService, getEscalationService } from './services/escalation.service';
import { initSmsService } from './services/sms.service';
import { initEmailService } from './services/email.service';
import { initClassificationService, getClassificationService } from './services/classification.service';
import { initOfflineEscalationService, getOfflineEscalationService } from './services/offline-escalation.service';
import { initHealthcheckService, getHealthcheckService } from './services/healthcheck.service';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Database connection
const dbPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test database connection
dbPool.query('SELECT NOW()')
  .then(() => {
    console.log('✓ Database connected');
    logger.info('Database connected successfully');
  })
  .catch((err: Error) => {
    console.error('✗ Database connection failed:', err.message);
    console.warn('  Server will continue without database connection');
    logger.error('Database connection failed', {
      error: err.message,
      stack: err.stack,
    });
  });

// Initialize Push Notification service
const pushService = initPushService(dbPool);
console.log('✓ Push notification service initialized');

// Initialize SMS service (for emergency contact escalation)
const smsService = initSmsService();
if (smsService.isEnabled()) {
  console.log('✓ SMS service initialized (Twilio)');
} else {
  console.log('⚠ SMS service not configured - SMS alerts disabled');
}

// Initialize Email service (for emergency contact escalation)
const emailService = initEmailService();
if (emailService.isEnabled()) {
  console.log('✓ Email service initialized (SMTP)');
} else {
  console.log('⚠ Email service not configured - Email alerts disabled');
}

// Initialize Classification service (AI-powered rodent detection)
const classificationService = initClassificationService(dbPool);
console.log('✓ Classification service initialized (lazy model loading)');

// Initialize Offline Escalation service (critical for animal welfare)
const offlineEscalationService = initOfflineEscalationService(dbPool);
console.log('✓ Offline escalation service initialized (push + SMS alerts)');

// Initialize Healthcheck service (external dead man's switch monitoring)
const healthcheckService = initHealthcheckService(process.env.HEALTHCHECKS_URL);

// Initialize MQTT service
const mqttService = new MqttService(
  {
    broker: {
      url: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    },
    auth: process.env.MQTT_USERNAME && process.env.MQTT_PASSWORD ? {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
    } : undefined,
    client: {
      clientId: process.env.MQTT_CLIENT_ID || 'server_production',
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
      keepalive: 60,
    },
    qos: {
      default: 1,
      status: 1,
      commands: 1,
    },
  },
  dbPool
);

mqttService.connect().catch((err: Error) => {
  console.error('✗ MQTT connection failed:', err.message);
  logger.error('MQTT connection failed', {
    error: err.message,
    stack: err.stack,
  });
});

// Set MQTT service singleton for other services to access
setMqttService(mqttService);

// Initialize Escalation service
const escalationService = initEscalationService(dbPool);
console.log('✓ Escalation service initialized');

// Escalation cron job - runs every minute
let escalationInterval: NodeJS.Timeout;
const startEscalationCron = () => {
  escalationInterval = setInterval(async () => {
    try {
      await escalationService.processEscalations();
    } catch (error: any) {
      logger.error('Escalation cron job failed', { error: error.message });
    }
  }, 60 * 1000); // Every minute
  console.log('✓ Escalation cron job started (runs every minute)');
};

// Start cron after a short delay to let other services initialize
setTimeout(startEscalationCron, 5000);

// Handle MQTT errors to prevent process crash
// In Node.js EventEmitter, unhandled 'error' events crash the process
mqttService.on('error', (err: Error) => {
  console.error('[MQTT] Service error (handled):', err.message);
  logger.error('MQTT service error', {
    error: err.message,
    stack: err.stack,
  });
  // Don't crash - the service will attempt reconnection automatically

  // Signal failure to external monitoring
  const hc = getHealthcheckService();
  if (hc.isEnabled()) {
    hc.signalFail(`MQTT error: ${err.message}`);
  }
});

// Forward MQTT events to WebSocket clients
mqttService.on('device:alert', (data: any) => {
  console.log('[WS] Forwarding device alert:', data);
  // Emit to all clients watching this tenant
  io.to(`tenant:${data.tenantId}`).emit('device:alert', {
    ...data,
    timestamp: Date.now(),
  });
});

mqttService.on('device:status', ({ tenantId, macAddress, status }) => {
  io.to(`tenant:${tenantId}`).emit('device:status', {
    macAddress,
    status,
    timestamp: Date.now(),
  });
});

mqttService.on('device:online', async ({ tenantId, macAddress }) => {
  io.to(`tenant:${tenantId}`).emit('device:online', {
    macAddress,
    timestamp: Date.now(),
  });

  // Stop offline escalation tracking when device comes back online
  const escalation = getOfflineEscalationService();
  if (escalation) {
    try {
      const deviceResult = await dbPool.query(
        'SELECT id, name FROM devices WHERE tenant_id = $1 AND mqtt_client_id = $2',
        [tenantId, macAddress]
      );
      if (deviceResult.rows.length > 0) {
        const device = deviceResult.rows[0];
        escalation.deviceOnline(tenantId, device.id);
        console.log(`[OFFLINE-ESCALATION] Device back online: ${device.name}`);

        // Log connectivity event
        try {
          await dbPool.query(
            'INSERT INTO device_connectivity_log (device_id, tenant_id, event) VALUES ($1, $2, $3)',
            [device.id, tenantId, 'online']
          );
        } catch (logErr) {
          console.error('[CONNECTIVITY-LOG] Error logging online event:', logErr);
        }
      }
    } catch (error) {
      console.error('[OFFLINE-ESCALATION] Error stopping tracking:', error);
    }
  } else {
    // No escalation service, but still log connectivity
    try {
      const deviceResult = await dbPool.query(
        'SELECT id FROM devices WHERE tenant_id = $1 AND mqtt_client_id = $2',
        [tenantId, macAddress]
      );
      if (deviceResult.rows.length > 0) {
        await dbPool.query(
          'INSERT INTO device_connectivity_log (device_id, tenant_id, event) VALUES ($1, $2, $3)',
          [deviceResult.rows[0].id, tenantId, 'online']
        );
      }
    } catch (logErr) {
      console.error('[CONNECTIVITY-LOG] Error logging online event:', logErr);
    }
  }
});

mqttService.on('device:offline', async ({ tenantId, macAddress }) => {
  io.to(`tenant:${tenantId}`).emit('device:offline', {
    macAddress,
    timestamp: Date.now(),
  });

  // Start offline escalation tracking (immediate push, then SMS at 15/30/60 min)
  // This is critical for animal welfare - trapped mice must not be left unattended
  const escalation = getOfflineEscalationService();
  if (escalation) {
    try {
      // Get device info from database
      const deviceResult = await dbPool.query(
        'SELECT id, name FROM devices WHERE tenant_id = $1 AND mqtt_client_id = $2',
        [tenantId, macAddress]
      );
      if (deviceResult.rows.length > 0) {
        const device = deviceResult.rows[0];
        await escalation.deviceOffline(tenantId, device.id, device.name);
        console.log(`[OFFLINE-ESCALATION] Started tracking: ${device.name}`);

        // Log connectivity event
        try {
          await dbPool.query(
            'INSERT INTO device_connectivity_log (device_id, tenant_id, event) VALUES ($1, $2, $3)',
            [device.id, tenantId, 'offline']
          );
        } catch (logErr) {
          console.error('[CONNECTIVITY-LOG] Error logging offline event:', logErr);
        }
      }
    } catch (error) {
      console.error('[OFFLINE-ESCALATION] Error starting tracking:', error);
    }
  } else {
    // No escalation service, but still log connectivity
    try {
      const deviceResult = await dbPool.query(
        'SELECT id FROM devices WHERE tenant_id = $1 AND mqtt_client_id = $2',
        [tenantId, macAddress]
      );
      if (deviceResult.rows.length > 0) {
        await dbPool.query(
          'INSERT INTO device_connectivity_log (device_id, tenant_id, event) VALUES ($1, $2, $3)',
          [deviceResult.rows[0].id, tenantId, 'offline']
        );
      }
    } catch (logErr) {
      console.error('[CONNECTIVITY-LOG] Error logging offline event:', logErr);
    }
  }
});

mqttService.on('alert:resolved', (data: any) => {
  console.log('[WS] Forwarding alert resolved:', data);
  io.to(`tenant:${data.tenantId}`).emit('alert:resolved', {
    type: 'alert:resolved',
    payload: data,
    timestamp: new Date().toISOString(),
  });
});

mqttService.on('snapshot', (data: any) => {
  console.log('[WS] Forwarding snapshot:', { tenantId: data.tenantId, macAddress: data.macAddress, timestamp: data.timestamp });
  const snapshotData = {
    macAddress: data.macAddress,
    imageData: data.imageData,
    timestamp: data.timestamp,
  };
  // Send to the device's tenant room
  io.to(`tenant:${data.tenantId}`).emit('snapshot', snapshotData);
  // Also send to Master Tenant room for superadmins viewing cross-tenant devices
  const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
  if (data.tenantId !== MASTER_TENANT_ID) {
    io.to(`tenant:${MASTER_TENANT_ID}`).emit('snapshot', snapshotData);
  }
});

// CORS Configuration - Parse allowed origins from environment
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

// Allow any origin from a private/local IP (RFC 1918) so LAN access always works
// regardless of DHCP-assigned IP changes
function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.indexOf(origin) !== -1) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    // RFC 1918 private ranges: 10.x.x.x, 192.168.x.x, 172.16-31.x.x
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  } catch {}
  return false;
}

console.log('CORS allowed origins:', allowedOrigins, '+ all RFC 1918 private IPs');

// Initialize Socket.io with CORS and explicit timing settings
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
  },
  // More lenient timing for mobile clients
  pingTimeout: 60000,      // 60 seconds before considering connection dead
  pingInterval: 25000,     // Ping every 25 seconds
  connectTimeout: 45000,   // 45 seconds to establish connection
  transports: ['websocket', 'polling'], // Allow both transports
  maxHttpBufferSize: 5e6,  // 5MB max message size for large snapshots
  perMessageDeflate: false, // Disable compression to avoid issues with mobile clients
});

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);

  // Join tenant room
  socket.on('join:tenant', (tenantId: string) => {
    socket.join(`tenant:${tenantId}`);
    console.log(`[WS] Client ${socket.id} joined tenant room: ${tenantId}`);
  });

  // Leave tenant room
  socket.on('leave:tenant', (tenantId: string) => {
    socket.leave(`tenant:${tenantId}`);
    console.log(`[WS] Client ${socket.id} left tenant room: ${tenantId}`);
  });

  socket.on('disconnect', () => {
    console.log('[WS] Client disconnected:', socket.id);
  });
});

// Security & Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
}));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make database pool, MQTT service, and logger available to routes
app.locals.dbPool = dbPool;
app.locals.mqttService = mqttService;
app.locals.logger = logger;

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
  const mqttStatus = mqttService.getStatus();
  const mqttConnected = mqttStatus.connected;

  try {
    await dbPool.query('SELECT 1');
    const status = mqttConnected ? 'healthy' : 'degraded';
    const httpCode = mqttConnected ? 200 : 503;

    res.status(httpCode).json({
      status,
      database: 'connected',
      mqtt: mqttConnected ? 'connected' : 'disconnected',
      mqttReconnectAttempts: mqttStatus.reconnectAttempts,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      mqtt: mqttConnected ? 'connected' : 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Static file serving for firmware downloads
const firmwareStoragePath = process.env.FIRMWARE_STORAGE_PATH || path.join(__dirname, '../firmware');
app.use('/api/firmware-files', express.static(firmwareStoragePath));
console.log(`✓ Firmware file serving enabled at /api/firmware-files (${firmwareStoragePath})`);

// API Routes - Import synchronously
// NOTE: Claim routes must be loaded BEFORE devices routes to handle /api/devices/claim without auth
try {
  const claimRoutes = require('./routes/claim.routes');
  app.use('/api', claimRoutes.default || claimRoutes);
  console.log('✓ Claim routes loaded');
} catch (e) {
  console.warn('Claim routes not found - skipping');
}

try {
  const setupRoutes = require('./routes/setup.routes');
  app.use('/api/setup', setupRoutes.default || setupRoutes);
  console.log('✓ Setup routes loaded (captive portal flow)');
} catch (e) {
  console.warn('Setup routes not found - skipping');
}

try {
  const authRoutes = require('./routes/auth.routes');
  app.use('/api/auth', authRoutes.default || authRoutes);
  console.log('✓ Auth routes loaded');
} catch (e) {
  console.warn('Auth routes not found - skipping');
}

try {
  const devicesRoutes = require('./routes/devices.routes');
  app.use('/api/devices', devicesRoutes.default || devicesRoutes);
  console.log('✓ Devices routes loaded');
} catch (e) {
  console.warn('Devices routes not found - skipping');
}

try {
  const deviceControlsRoutes = require('./routes/device-controls.routes');
  app.use('/api/devices', deviceControlsRoutes.default || deviceControlsRoutes);
  console.log('✓ Device controls routes loaded');
} catch (e) {
  console.warn('Device controls routes not found - skipping');
}

try {
  const alertsRoutes = require('./routes/alerts.routes');
  app.use('/api/alerts', alertsRoutes.default || alertsRoutes);
  console.log('✓ Alerts routes loaded');
} catch (e) {
  console.warn('Alerts routes not found - skipping');
}

try {
  const firmwareRoutes = require('./routes/firmware.routes');
  app.use('/api/firmware', firmwareRoutes.default || firmwareRoutes);
  console.log('✓ Firmware routes loaded');
} catch (e) {
  console.warn('Firmware routes not found - skipping');
}

try {
  const usersRoutes = require('./routes/users.routes');
  app.use('/api/users', usersRoutes.default || usersRoutes);
  console.log('✓ Users routes loaded');
} catch (e) {
  console.warn('Users routes not found - skipping');
}

try {
  const tenantsRoutes = require('./routes/tenants.routes');
  app.use('/api/tenants', tenantsRoutes.default || tenantsRoutes);
  console.log('✓ Tenants routes loaded');
} catch (e) {
  console.warn('Tenants routes not found - skipping');
}

try {
  const dashboardRoutes = require('./routes/dashboard.routes');
  app.use('/api/dashboard', dashboardRoutes.default || dashboardRoutes);
  console.log('✓ Dashboard routes loaded');
} catch (e) {
  console.warn('Dashboard routes not found - skipping');
}

try {
  const logsRoutes = require('./routes/logs.routes');
  app.use('/api/logs', logsRoutes.default || logsRoutes);
  console.log('✓ Logs routes loaded');
  logger.info('Logs API routes initialized');
} catch (e) {
  console.warn('Logs routes not found - skipping');
}

try {
  const diagnosticsRoutes = require('./routes/diagnostics.routes');
  app.use('/api', diagnosticsRoutes.default || diagnosticsRoutes);
  console.log('✓ Diagnostics routes loaded');
} catch (e) {
  console.warn('Diagnostics routes not found - skipping');
}

try {
  const pushRoutes = require('./routes/push.routes');
  app.use('/api/push', pushRoutes.default || pushRoutes);
  console.log('✓ Push notification routes loaded');
  logger.info('Push notification API routes initialized');
} catch (e) {
  console.warn('Push notification routes not found - skipping');
}

try {
  const classificationRoutes = require('./routes/classification.routes');
  app.use('/api/classification', classificationRoutes.default || classificationRoutes);
  console.log('✓ Classification routes loaded (AI rodent detection)');
  logger.info('Classification API routes initialized');
} catch (e) {
  console.warn('Classification routes not found - skipping');
}

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  logger.error('Unhandled error in request', {
    error: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  MQTT broker: ${process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'}`);
  console.log(`  WebSocket: Enabled`);
  logger.info('Server started', {
    port: PORT,
    host: HOST,
    mqttBroker: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    websocket: 'enabled',
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  logger.info('SIGTERM received, shutting down gracefully');
  if (escalationInterval) clearInterval(escalationInterval);
  healthcheckService.stop();
  offlineEscalationService.stop();
  mqttService.disconnect();
  dbPool.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  logger.info('SIGINT received, shutting down gracefully');
  if (escalationInterval) clearInterval(escalationInterval);
  healthcheckService.stop();
  offlineEscalationService.stop();
  mqttService.disconnect();
  dbPool.end();
  process.exit(0);
});

// Export for testing
export { app, dbPool, mqttService };
