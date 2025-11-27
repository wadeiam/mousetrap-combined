import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { MqttService } from './services/mqtt.service';
import { logger } from './services/logger.service';

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

mqttService.on('device:online', ({ tenantId, macAddress }) => {
  io.to(`tenant:${tenantId}`).emit('device:online', {
    macAddress,
    timestamp: Date.now(),
  });
});

mqttService.on('device:offline', ({ tenantId, macAddress }) => {
  io.to(`tenant:${tenantId}`).emit('device:offline', {
    macAddress,
    timestamp: Date.now(),
  });
});

mqttService.on('alert:resolved', (data: any) => {
  console.log('[WS] Forwarding alert resolved:', data);
  io.to(`tenant:${data.tenantId}`).emit('alert:resolved', {
    ...data,
    timestamp: Date.now(),
  });
});

mqttService.on('snapshot', (data: any) => {
  console.log('[WS] Forwarding snapshot:', { tenantId: data.tenantId, macAddress: data.macAddress, timestamp: data.timestamp });
  io.to(`tenant:${data.tenantId}`).emit('snapshot', {
    macAddress: data.macAddress,
    imageData: data.imageData,
    timestamp: data.timestamp,
  });
});

// CORS Configuration - Parse allowed origins from environment
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

console.log('CORS allowed origins:', allowedOrigins);

// Initialize Socket.io with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  },
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

    if (allowedOrigins.indexOf(origin) !== -1) {
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
    console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await dbPool.query('SELECT 1');
    res.json({
      status: 'healthy',
      database: 'connected',
      mqtt: mqttService.isConnected() ? 'connected' : 'disconnected',
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
  mqttService.disconnect();
  dbPool.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  logger.info('SIGINT received, shutting down gracefully');
  mqttService.disconnect();
  dbPool.end();
  process.exit(0);
});

// Export for testing
export { app, dbPool, mqttService };
