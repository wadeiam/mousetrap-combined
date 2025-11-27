/**
 * MQTT Service Integration Example
 *
 * This file demonstrates how to integrate the MQTT service with your Express server,
 * WebSocket server, and PostgreSQL database.
 */

import express, { Express } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'pg';
import { MqttService, createMqttService } from './mqtt.service';
import { MqttConfig } from '../types/mqtt.types';

/**
 * Initialize MQTT service and integrate with Express app
 */
export async function setupMqttService(
  app: Express,
  io: SocketIOServer,
  dbPool: Pool
): Promise<MqttService> {
  // Load configuration from environment variables
  const mqttConfig: MqttConfig = {
    broker: {
      url: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    },
    auth: process.env.MQTT_USERNAME ? {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD || '',
    } : undefined,
    client: {
      clientId: process.env.MQTT_CLIENT_ID,
      clean: process.env.MQTT_CLEAN_SESSION === 'true',
      reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_PERIOD || '5000'),
      connectTimeout: parseInt(process.env.MQTT_CONNECT_TIMEOUT || '30000'),
      keepalive: parseInt(process.env.MQTT_KEEPALIVE || '60'),
    },
    qos: {
      default: parseInt(process.env.MQTT_QOS_DEFAULT || '0') as 0 | 1 | 2,
      status: parseInt(process.env.MQTT_QOS_STATUS || '1') as 0 | 1 | 2,
      commands: parseInt(process.env.MQTT_QOS_COMMANDS || '1') as 0 | 1 | 2,
    },
  };

  // Create and connect MQTT service
  console.log('[MQTT] Initializing MQTT service...');
  const mqttService = await createMqttService(mqttConfig, dbPool);
  console.log('[MQTT] MQTT service connected and ready');

  // Setup event forwarding to WebSocket clients
  setupWebSocketForwarding(mqttService, io);

  // Setup REST API endpoints for MQTT operations
  setupMqttRoutes(app, mqttService);

  // Graceful shutdown
  setupGracefulShutdown(mqttService);

  return mqttService;
}

/**
 * Forward MQTT events to WebSocket clients
 */
function setupWebSocketForwarding(mqttService: MqttService, io: SocketIOServer): void {
  // Forward device status updates
  mqttService.on('device:status', ({ tenantId, macAddress, status }) => {
    // Emit to all clients watching this tenant
    io.to(`tenant:${tenantId}`).emit('device:status', {
      macAddress,
      status,
      timestamp: Date.now(),
    });

    // Also emit to clients watching this specific device
    io.to(`device:${tenantId}:${macAddress}`).emit('device:status', {
      macAddress,
      status,
      timestamp: Date.now(),
    });

    console.log(`[WS] Forwarded device status: ${macAddress} (tenant: ${tenantId})`);
  });

  // Forward OTA progress updates
  mqttService.on('device:ota_progress', ({ tenantId, macAddress, progress }) => {
    io.to(`tenant:${tenantId}`).emit('device:ota_progress', {
      macAddress,
      progress,
      timestamp: Date.now(),
    });

    io.to(`device:${tenantId}:${macAddress}`).emit('device:ota_progress', {
      macAddress,
      progress,
      timestamp: Date.now(),
    });

    console.log(`[WS] Forwarded OTA progress: ${macAddress} - ${progress.status} ${progress.progress}%`);
  });

  // Forward device online events
  mqttService.on('device:online', ({ tenantId, macAddress }) => {
    io.to(`tenant:${tenantId}`).emit('device:online', {
      macAddress,
      timestamp: Date.now(),
    });

    console.log(`[WS] Device online: ${macAddress} (tenant: ${tenantId})`);
  });

  // Forward device offline events
  mqttService.on('device:offline', ({ tenantId, macAddress }) => {
    io.to(`tenant:${tenantId}`).emit('device:offline', {
      macAddress,
      timestamp: Date.now(),
    });

    console.log(`[WS] Device offline: ${macAddress} (tenant: ${tenantId})`);
  });

  // Forward MQTT connection events
  mqttService.on('connected', () => {
    io.emit('mqtt:connected', { timestamp: Date.now() });
    console.log('[WS] MQTT connected - broadcasted to all clients');
  });

  mqttService.on('disconnected', (error) => {
    io.emit('mqtt:disconnected', {
      error: error?.message,
      timestamp: Date.now(),
    });
    console.log('[WS] MQTT disconnected - broadcasted to all clients');
  });

  mqttService.on('reconnecting', () => {
    io.emit('mqtt:reconnecting', { timestamp: Date.now() });
    console.log('[WS] MQTT reconnecting - broadcasted to all clients');
  });
}

/**
 * Setup REST API endpoints for MQTT operations
 */
function setupMqttRoutes(app: Express, mqttService: MqttService): void {
  // Get MQTT service status
  app.get('/api/mqtt/status', (req, res) => {
    const status = mqttService.getStatus();
    res.json({
      ok: true,
      ...status,
    });
  });

  // Publish firmware update
  app.post('/api/mqtt/firmware/publish', async (req, res) => {
    try {
      const { tenantId, version, url, size, sha256, changelog, required, isGlobal } = req.body;

      await mqttService.publishFirmwareUpdate(
        tenantId,
        { version, url, size, sha256, changelog, required },
        isGlobal || false
      );

      res.json({ ok: true, message: 'Firmware update published' });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Publish filesystem update
  app.post('/api/mqtt/filesystem/publish', async (req, res) => {
    try {
      const { tenantId, version, url, size, sha256, changelog, required, isGlobal } = req.body;

      await mqttService.publishFilesystemUpdate(
        tenantId,
        { version, url, size, sha256, changelog, required },
        isGlobal || false
      );

      res.json({ ok: true, message: 'Filesystem update published' });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Send command to device
  app.post('/api/mqtt/device/:tenantId/:macAddress/command', async (req, res) => {
    try {
      const { tenantId, macAddress } = req.params;
      const { command, params } = req.body;

      await mqttService.publishDeviceCommand(
        tenantId,
        macAddress,
        {
          command,
          params,
          timestamp: Date.now(),
        }
      );

      res.json({ ok: true, message: `Command '${command}' sent to device ${macAddress}` });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Reboot device
  app.post('/api/mqtt/device/:tenantId/:macAddress/reboot', async (req, res) => {
    try {
      const { tenantId, macAddress } = req.params;

      await mqttService.rebootDevice(tenantId, macAddress);

      res.json({ ok: true, message: `Reboot command sent to device ${macAddress}` });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Request device status
  app.post('/api/mqtt/device/:tenantId/:macAddress/status', async (req, res) => {
    try {
      const { tenantId, macAddress } = req.params;

      await mqttService.requestDeviceStatus(tenantId, macAddress);

      res.json({ ok: true, message: `Status request sent to device ${macAddress}` });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Reset device alert
  app.post('/api/mqtt/device/:tenantId/:macAddress/alert/reset', async (req, res) => {
    try {
      const { tenantId, macAddress } = req.params;

      await mqttService.resetDeviceAlert(tenantId, macAddress);

      res.json({ ok: true, message: `Alert reset command sent to device ${macAddress}` });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

/**
 * Setup graceful shutdown
 */
function setupGracefulShutdown(mqttService: MqttService): void {
  const shutdown = async (signal: string) => {
    console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);

    try {
      await mqttService.disconnect();
      console.log('[SHUTDOWN] MQTT service disconnected');
      process.exit(0);
    } catch (error) {
      console.error('[SHUTDOWN] Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Example: Complete server setup with MQTT
 */
export async function exampleServerSetup() {
  const express = require('express');
  const { Server } = require('socket.io');
  const { Pool } = require('pg');
  const http = require('http');

  // Create Express app
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  // Create database pool
  const dbPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'iot_platform',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    min: parseInt(process.env.DB_POOL_MIN || '2'),
  });

  // Setup middleware
  app.use(express.json());

  // Setup MQTT service
  const mqttService = await setupMqttService(app, io, dbPool);

  // Make MQTT service available to routes
  app.locals.mqttService = mqttService;

  // WebSocket connection handler
  io.on('connection', (socket: any) => {
    console.log('[WS] Client connected:', socket.id);

    // Join tenant room
    socket.on('join:tenant', (tenantId: string) => {
      socket.join(`tenant:${tenantId}`);
      console.log(`[WS] Client ${socket.id} joined tenant room: ${tenantId}`);
    });

    // Join device room
    socket.on('join:device', ({ tenantId, macAddress }: any) => {
      socket.join(`device:${tenantId}:${macAddress}`);
      console.log(`[WS] Client ${socket.id} joined device room: ${tenantId}:${macAddress}`);
    });

    // Leave tenant room
    socket.on('leave:tenant', (tenantId: string) => {
      socket.leave(`tenant:${tenantId}`);
      console.log(`[WS] Client ${socket.id} left tenant room: ${tenantId}`);
    });

    // Leave device room
    socket.on('leave:device', ({ tenantId, macAddress }: any) => {
      socket.leave(`device:${tenantId}:${macAddress}`);
      console.log(`[WS] Client ${socket.id} left device room: ${tenantId}:${macAddress}`);
    });

    socket.on('disconnect', () => {
      console.log('[WS] Client disconnected:', socket.id);
    });
  });

  // Start server
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`[SERVER] Listening on port ${PORT}`);
  });

  return { app, server, io, mqttService, dbPool };
}
