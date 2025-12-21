/**
 * MQTT Service for IoT Device Fleet Management
 *
 * This service handles MQTT broker connections, message publishing/subscribing,
 * and integrates with PostgreSQL for data persistence.
 *
 * Compatible with ESP32 PubSubClient implementation.
 */

import { EventEmitter } from 'events';
import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { Pool } from 'pg';
import { logger } from './logger.service';
import { getPushService } from './push.service';
import { getEmailService } from './email.service';
import { getSmsService } from './sms.service';
import {
  DeviceStatusMessage,
  OtaProgressMessage,
  FirmwareUpdateMessage,
  FilesystemUpdateMessage,
  DeviceCommandMessage,
  MotionEventMessage,
  MqttConfig,
  MqttServiceEvents,
  ParsedTopic,
  MqttPublishOptions,
  mqttTopics,
} from '../types/mqtt.types';
import { classifyImage, ClassificationResponse } from './classification.client';

// Type-safe EventEmitter
interface TypedEventEmitter {
  on<K extends keyof MqttServiceEvents>(event: K, listener: MqttServiceEvents[K]): this;
  emit<K extends keyof MqttServiceEvents>(event: K, ...args: Parameters<MqttServiceEvents[K]>): boolean;
  removeListener<K extends keyof MqttServiceEvents>(event: K, listener: MqttServiceEvents[K]): this;
  removeAllListeners(event?: keyof MqttServiceEvents): this;
}

// Pending rotation tracking for ACK-based credential rotation
interface PendingRotation {
  rotationId: string;
  mqttClientId: string;
  tenantId: string;
  newPassword: string;
  createdAt: number;
  resolve: (success: boolean) => void;
  timeout: NodeJS.Timeout;
}

export class MqttService extends EventEmitter implements TypedEventEmitter {
  private client: MqttClient | null = null;
  private config: MqttConfig;
  private db: Pool;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 100; // Effectively unlimited with backoff
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private isShuttingDown: boolean = false;
  private deviceHeartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEVICE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  // Credential rotation ACK tracking
  private pendingRotations: Map<string, PendingRotation> = new Map();
  private readonly ROTATION_ACK_TIMEOUT_MS = 30 * 1000; // 30 seconds

  constructor(config: MqttConfig, dbPool: Pool) {
    super();
    this.config = config;
    this.db = dbPool;
  }

  /**
   * Initialize MQTT connection
   */
  public async connect(): Promise<void> {
    if (this.isConnecting) {
      console.log('[MQTT] Connection already in progress');
      logger.debug('MQTT connection already in progress');
      return;
    }

    if (this.client?.connected) {
      console.log('[MQTT] Already connected');
      logger.debug('MQTT already connected');
      return;
    }

    this.isConnecting = true;

    try {
      const clientOptions: IClientOptions = {
        clientId: this.config.client.clientId || `server_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        clean: this.config.client.clean,
        reconnectPeriod: 0, // We'll handle reconnection manually for better control
        connectTimeout: this.config.client.connectTimeout,
        keepalive: this.config.client.keepalive,
        will: {
          topic: 'server/status',
          payload: Buffer.from(JSON.stringify({ online: false, timestamp: Date.now() })),
          qos: 1,
          retain: true,
        },
      };

      // Add authentication if configured
      if (this.config.auth) {
        clientOptions.username = this.config.auth.username;
        clientOptions.password = this.config.auth.password;
      }

      console.log(`[MQTT] Connecting to ${this.config.broker.url}...`);
      logger.info('MQTT connecting to broker', { brokerUrl: this.config.broker.url });

      this.client = mqtt.connect(this.config.broker.url, clientOptions);

      this.setupEventHandlers();

      // Wait for connection or error
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, this.config.client.connectTimeout);

        this.client!.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.client!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      this.isConnecting = false;
      console.error('[MQTT] Connection failed:', error);
      logger.error('MQTT connection failed', {
        error: error instanceof Error ? error.message : String(error),
        brokerUrl: this.config.broker.url,
      });
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Setup MQTT client event handlers
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      console.log('[MQTT] Connected to broker');
      logger.info('MQTT connected to broker');
      this.reconnectAttempts = 0;
      this.isConnecting = false;

      // Subscribe to all necessary topics
      this.subscribeToTopics();

      // Publish server online status
      this.publishServerStatus(true);

      this.emit('connected');
    });

    this.client.on('disconnect', () => {
      console.log('[MQTT] Disconnected from broker');
      logger.warn('MQTT disconnected from broker');
      this.emit('disconnected');
    });

    this.client.on('offline', () => {
      console.log('[MQTT] Client went offline');
      logger.warn('MQTT client went offline');
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    });

    this.client.on('error', (error) => {
      console.error('[MQTT] Client error:', error);
      logger.error('MQTT client error', {
        error: error.message,
      });
      this.emit('error', error);
    });

    this.client.on('reconnect', () => {
      console.log('[MQTT] Attempting to reconnect...');
      logger.info('MQTT attempting to reconnect');
      this.emit('reconnecting');
    });

    this.client.on('message', (topic, payload) => {
      this.handleMessage(topic, payload);
    });

    this.client.on('close', () => {
      console.log('[MQTT] Connection closed');
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Subscribe to all necessary MQTT topics
   */
  private subscribeToTopics(): void {
    if (!this.client?.connected) return;

    const subscriptions = [
      // Subscribe to all tenant device status updates
      { topic: 'tenant/+/device/+/status', qos: this.config.qos.status },
      // Subscribe to all OTA progress updates
      { topic: 'tenant/+/device/+/ota/progress', qos: this.config.qos.default },
      // Subscribe to all camera snapshots
      { topic: 'tenant/+/device/+/camera/snapshot', qos: this.config.qos.default },
      // Subscribe to all device alerts/traps
      { topic: 'tenant/+/device/+/alert', qos: this.config.qos.default },
      // Subscribe to alert cleared notifications from devices
      { topic: 'tenant/+/device/+/alert_cleared', qos: this.config.qos.default },
      // Subscribe to credential rotation ACKs from devices
      { topic: 'tenant/+/device/+/rotation_ack', qos: this.config.qos.commands },
      // Subscribe to motion events from Scout devices (AI classification)
      { topic: 'tenant/+/device/+/motion', qos: this.config.qos.default },
    ];

    subscriptions.forEach(({ topic, qos }) => {
      this.client!.subscribe(topic, { qos: qos as 0 | 1 | 2 }, (err) => {
        if (err) {
          console.error(`[MQTT] Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`[MQTT] Subscribed to ${topic} (QoS ${qos})`);
        }
      });
    });
  }

  /**
   * Handle incoming MQTT messages
   */
  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    try {
      const parsedTopic = this.parseTopic(topic);
      const message = JSON.parse(payload.toString());

      console.log(`[MQTT] Message received on ${topic}:`, message);

      switch (parsedTopic.type) {
        case 'device_status':
          await this.handleDeviceStatus(parsedTopic, message as DeviceStatusMessage);
          break;

        case 'ota_progress':
          await this.handleOtaProgress(parsedTopic, message as OtaProgressMessage);
          break;

        case 'camera_snapshot':
          await this.handleCameraSnapshot(parsedTopic, message);
          break;

        case 'device_alert':
          await this.handleDeviceAlert(parsedTopic, message);
          break;

        case 'alert_cleared':
          await this.handleAlertCleared(parsedTopic, message);
          break;

        case 'rotation_ack':
          this.handleRotationAck(parsedTopic, message);
          break;

        case 'motion_event':
          await this.handleMotionEvent(parsedTopic, message as MotionEventMessage);
          break;

        default:
          console.warn(`[MQTT] Unknown topic type: ${topic}`);
      }
    } catch (error) {
      console.error(`[MQTT] Error handling message on ${topic}:`, error);
    }
  }

  /**
   * Parse MQTT topic to extract components
   */
  private parseTopic(topic: string): ParsedTopic {
    const parts = topic.split('/');

    // tenant/{tenantId}/device/{macAddress}/status
    if (parts[0] === 'tenant' && parts[2] === 'device' && parts[4] === 'status') {
      return {
        type: 'device_status',
        tenantId: parts[1],
        macAddress: parts[3],
      };
    }

    // tenant/{tenantId}/device/{macAddress}/ota/progress
    if (parts[0] === 'tenant' && parts[2] === 'device' && parts[4] === 'ota' && parts[5] === 'progress') {
      return {
        type: 'ota_progress',
        tenantId: parts[1],
        macAddress: parts[3],
      };
    }

    // tenant/{tenantId}/device/{macAddress}/camera/snapshot
    if (parts[0] === 'tenant' && parts[2] === 'device' && parts[4] === 'camera' && parts[5] === 'snapshot') {
      return {
        type: 'camera_snapshot',
        tenantId: parts[1],
        macAddress: parts[3],
      };
    }

    // tenant/{tenantId}/device/{macAddress}/alert
    if (parts[0] === 'tenant' && parts[2] === 'device' && parts[4] === 'alert') {
      return {
        type: 'device_alert',
        tenantId: parts[1],
        macAddress: parts[3],
      };
    }

    // tenant/{tenantId}/device/{macAddress}/alert_cleared
    if (parts[0] === 'tenant' && parts[2] === 'device' && parts[4] === 'alert_cleared') {
      return {
        type: 'alert_cleared',
        tenantId: parts[1],
        macAddress: parts[3],
      };
    }

    // tenant/{tenantId}/device/{macAddress}/rotation_ack
    if (parts[0] === 'tenant' && parts[2] === 'device' && parts[4] === 'rotation_ack') {
      return {
        type: 'rotation_ack',
        tenantId: parts[1],
        macAddress: parts[3],
      };
    }

    // tenant/{tenantId}/device/{macAddress}/motion
    if (parts[0] === 'tenant' && parts[2] === 'device' && parts[4] === 'motion') {
      return {
        type: 'motion_event',
        tenantId: parts[1],
        macAddress: parts[3],
      };
    }

    // tenant/{tenantId}/firmware/latest
    if (parts[0] === 'tenant' && parts[2] === 'firmware' && parts[3] === 'latest') {
      return {
        type: 'firmware_update',
        tenantId: parts[1],
      };
    }

    // tenant/{tenantId}/filesystem/latest
    if (parts[0] === 'tenant' && parts[2] === 'filesystem' && parts[3] === 'latest') {
      return {
        type: 'filesystem_update',
        tenantId: parts[1],
      };
    }

    // tenant/{tenantId}/device/{macAddress}/cmd/{commandType}
    if (parts[0] === 'tenant' && parts[2] === 'device' && parts[4] === 'cmd') {
      return {
        type: 'device_command',
        tenantId: parts[1],
        macAddress: parts[3],
        commandType: parts[5],
      };
    }

    return { type: 'unknown' };
  }

  /**
   * Handle device status message
   */
  private async handleDeviceStatus(parsedTopic: ParsedTopic, status: DeviceStatusMessage): Promise<void> {
    const { tenantId, macAddress } = parsedTopic;

    if (!tenantId || !macAddress) {
      console.error('[MQTT] Invalid device status message - missing tenantId or macAddress');
      return;
    }

    try {
      // Update device in database using mqtt_client_id
      const query = `
        UPDATE devices SET
          online = $3,
          firmware_version = $4,
          filesystem_version = $5,
          uptime = $6,
          heap_free = $7,
          rssi = $8,
          local_ip = $9,
          mac_address = COALESCE(mac_address, $2),
          last_seen = NOW(),
          updated_at = NOW()
        WHERE tenant_id = $1 AND mqtt_client_id = $2
      `;

      const result = await this.db.query(query, [
        tenantId,
        macAddress, // This is actually mqtt_client_id from the topic
        status.online,
        status.firmware_version,
        status.filesystem_version,
        status.uptime,
        status.heap_free,
        status.rssi,
        status.ip,
      ]);

      if (result.rowCount === 0) {
        console.warn(`[MQTT] Device not found for status update: tenant=${tenantId}, mqtt_client_id=${macAddress}`);
        return;
      }

      // Reset heartbeat timer
      this.resetDeviceHeartbeat(tenantId, macAddress);

      // Emit event for WebSocket forwarding
      this.emit('device:status', {
        tenantId,
        macAddress: macAddress.toUpperCase(),
        status,
      });

      // Emit device online/offline events
      if (status.online) {
        this.emit('device:online', { tenantId, macAddress: macAddress.toUpperCase() });

        // Clear any retained revoke message for this device
        // This prevents newly claimed devices from receiving old revoke messages
        // from previous unclaims when they reconnect
        try {
          await this.clearDeviceRevocation(tenantId, macAddress);
        } catch (clearError) {
          // Log but don't fail - this is a preventive measure
          console.warn(`[MQTT] Could not clear retained revoke message for ${macAddress}:`, clearError);
        }

        // Sync alert state: If device reports triggered=true, ensure server has active alert
        if (status.triggered) {
          await this.syncDeviceAlertState(tenantId, macAddress, status);
        }
      } else {
        this.emit('device:offline', { tenantId, macAddress: macAddress.toUpperCase() });
      }

      console.log(`[MQTT] Device status updated: ${macAddress} (tenant: ${tenantId})`);
    } catch (error) {
      console.error('[MQTT] Error saving device status:', error);
    }
  }

  /**
   * Handle camera snapshot message - store in database and emit for WebSocket
   */
  private async handleCameraSnapshot(parsedTopic: ParsedTopic, message: { image: string; timestamp?: number }): Promise<void> {
    const { tenantId, macAddress } = parsedTopic;

    if (!tenantId || !macAddress) {
      console.error('[MQTT] Invalid snapshot message - missing tenantId or macAddress');
      return;
    }

    // Normalize timestamp to milliseconds
    // Device may send seconds (10 digits) or milliseconds (13 digits)
    let timestamp = message.timestamp || Date.now();
    if (timestamp < 10000000000) {
      // Timestamp is in seconds, convert to milliseconds
      timestamp = timestamp * 1000;
    }
    const imageData = message.image;

    try {
      // Store snapshot in database (timestamp is now in ms, divide by 1000 for to_timestamp)
      // Use AT TIME ZONE 'UTC' to store as UTC in the timestamp without timezone column
      const query = `
        UPDATE devices SET
          last_snapshot = $3,
          last_snapshot_at = (to_timestamp($4 / 1000.0) AT TIME ZONE 'UTC'),
          updated_at = NOW()
        WHERE tenant_id = $1 AND mqtt_client_id = $2
      `;

      await this.db.query(query, [tenantId, macAddress.toUpperCase(), imageData, timestamp]);

      console.log(`[MQTT] Snapshot stored for device: ${macAddress} (tenant: ${tenantId})`);

      // Emit event for WebSocket forwarding
      this.emit('snapshot', {
        tenantId,
        macAddress: macAddress.toUpperCase(),
        imageData,
        timestamp,
      });
    } catch (error) {
      console.error('[MQTT] Error storing snapshot:', error);
    }
  }

  /**
   * Handle OTA progress message
   */
  private async handleOtaProgress(parsedTopic: ParsedTopic, progress: OtaProgressMessage): Promise<void> {
    const { tenantId, macAddress } = parsedTopic;

    if (!tenantId || !macAddress) {
      console.error('[MQTT] Invalid OTA progress message - missing tenantId or macAddress');
      logger.error('Invalid OTA progress message', {
        reason: 'missing tenantId or macAddress',
        tenantId,
        macAddress,
      });
      return;
    }

    try {
      // Store OTA progress in database
      const query = `
        INSERT INTO device_ota_logs (
          tenant_id, mac_address, ota_type, status, progress,
          bytes_downloaded, total_bytes, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

      await this.db.query(query, [
        tenantId,
        macAddress.toUpperCase(),
        progress.type,
        progress.status,
        progress.progress,
        progress.bytes_downloaded,
        progress.total_bytes,
        progress.error || null,
      ]);

      // Emit event for WebSocket forwarding
      this.emit('device:ota_progress', {
        tenantId,
        macAddress: macAddress.toUpperCase(),
        progress,
      });

      console.log(`[MQTT] OTA progress: ${macAddress} - ${progress.status} ${progress.progress}%`);
      logger.info('Firmware OTA progress', {
        macAddress: macAddress.toUpperCase(),
        tenantId,
        status: progress.status,
        progress: progress.progress,
        type: progress.type,
      });

      // Log errors and completion
      if (progress.status === 'error' && progress.error) {
        logger.error('Firmware OTA failed', {
          macAddress: macAddress.toUpperCase(),
          tenantId,
          error: progress.error,
        });
      } else if (progress.status === 'success') {
        logger.info('Firmware OTA completed successfully', {
          macAddress: macAddress.toUpperCase(),
          tenantId,
          type: progress.type,
        });
      }
    } catch (error) {
      console.error('[MQTT] Error saving OTA progress:', error);
      logger.error('Error saving OTA progress', {
        macAddress,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle device alert (trap triggered)
   */
  private async handleDeviceAlert(parsedTopic: ParsedTopic, message: any): Promise<void> {
    const { tenantId, macAddress } = parsedTopic;

    if (!tenantId || !macAddress) {
      console.error('[MQTT] Invalid alert message - missing tenantId or macAddress');
      return;
    }

    try {
      // Get device ID from MAC address
      const deviceQuery = await this.db.query(
        'SELECT id FROM devices WHERE tenant_id = $1 AND mqtt_client_id = $2',
        [tenantId, macAddress.toUpperCase()]
      );

      if (deviceQuery.rows.length === 0) {
        console.error(`[MQTT] Device not found for alert: ${macAddress}`);
        return;
      }

      const deviceId = deviceQuery.rows[0].id;

      // Check if device already has an active alert - only one alert per trap
      const existingAlert = await this.db.query(
        `SELECT id FROM alerts WHERE device_id = $1 AND status IN ('new', 'acknowledged') LIMIT 1`,
        [deviceId]
      );

      if (existingAlert.rows.length > 0) {
        console.log(`[MQTT] Device ${macAddress} already has active alert ${existingAlert.rows[0].id}, skipping new alert`);
        return;
      }

      // Create alert in database
      const insertQuery = `
        INSERT INTO alerts (
          device_id, tenant_id, severity, status, sensor_data, triggered_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id
      `;

      const severity = message.severity || 'medium';
      const sensorData = {
        alert_type: message.alert_type || 'trap_triggered',
        message: message.message || 'Motion detected',
        ...message,
      };

      const result = await this.db.query(insertQuery, [
        deviceId,
        tenantId,
        severity,
        'new',
        JSON.stringify(sensorData),
      ]);

      const alertId = result.rows[0].id;

      // Emit WebSocket event for real-time notification
      this.emit('device:alert', {
        id: alertId,
        deviceId,
        tenantId,
        severity,
        status: 'new',
        type: sensorData.alert_type,
        message: sensorData.message,
        createdAt: new Date().toISOString(),
      });

      console.log(`[MQTT] Alert created for device ${macAddress}: ${sensorData.message}`);

      // Get device name for notifications
      const deviceNameQuery = await this.db.query(
        'SELECT name FROM devices WHERE id = $1',
        [deviceId]
      );
      const deviceName = deviceNameQuery.rows[0]?.name || macAddress;

      // Send push notification to all users in tenant
      const pushService = getPushService();
      if (pushService) {
        pushService.handleAlertNotification({
          alertId,
          deviceId,
          deviceName,
          alertType: sensorData.alert_type,
          severity,
          tenantId,
          message: sensorData.message,
        }).catch((err: Error) => {
          logger.error('Failed to send push notification', { error: err.message, alertId });
        });
      }

      // Send immediate email/SMS to emergency contacts
      this.notifyEmergencyContactsImmediately(tenantId, deviceName, alertId).catch((err: Error) => {
        logger.error('Failed to notify emergency contacts', { error: err.message, alertId });
      });

      logger.info('Device alert created', {
        alertId,
        deviceId,
        tenantId,
        macAddress: macAddress.toUpperCase(),
        severity,
        alertType: sensorData.alert_type,
      });
    } catch (error) {
      console.error('[MQTT] Error creating alert:', error);
      logger.error('Error creating device alert', {
        tenantId,
        macAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Sync device alert state on reconnect
   * If device reports triggered=true but server has no active alert, create one
   * This ensures dashboard stays in sync with device after reboots/disconnects
   */
  private async syncDeviceAlertState(tenantId: string, macAddress: string, status: DeviceStatusMessage): Promise<void> {
    try {
      // Get device ID
      const deviceQuery = await this.db.query(
        'SELECT id, name FROM devices WHERE tenant_id = $1 AND mqtt_client_id = $2',
        [tenantId, macAddress.toUpperCase()]
      );

      if (deviceQuery.rows.length === 0) {
        console.warn(`[MQTT] Device not found for alert sync: ${macAddress}`);
        return;
      }

      const deviceId = deviceQuery.rows[0].id;
      const deviceName = deviceQuery.rows[0].name || macAddress;

      // Check if there's already an active (non-resolved) alert for this device
      const activeAlertQuery = await this.db.query(
        `SELECT id FROM alerts
         WHERE device_id = $1 AND status != 'resolved'
         ORDER BY triggered_at DESC LIMIT 1`,
        [deviceId]
      );

      if (activeAlertQuery.rows.length > 0) {
        // Already have an active alert, no need to create another
        console.log(`[MQTT] Device ${macAddress} has active alert, no sync needed`);
        return;
      }

      // Device is triggered but server has no active alert - create one
      console.log(`[MQTT] Syncing alert state for device ${macAddress} - creating alert from device state`);

      const triggeredAt = status.triggered_at
        ? new Date(status.triggered_at * 1000).toISOString()
        : new Date().toISOString();

      const insertQuery = `
        INSERT INTO alerts (
          device_id, tenant_id, severity, status, sensor_data, triggered_at
        ) VALUES ($1, $2, 'high', 'new', $3, $4)
        RETURNING id
      `;

      const sensorData = {
        alert_type: 'trap_triggered',
        message: 'Alert synced from device state on reconnect',
        synced_from_device: true,
        alert_level: status.alert_level || 1,
      };

      const result = await this.db.query(insertQuery, [
        deviceId,
        tenantId,
        JSON.stringify(sensorData),
        triggeredAt,
      ]);

      const alertId = result.rows[0].id;

      // Emit WebSocket event for real-time UI update
      this.emit('device:alert', {
        id: alertId,
        deviceId,
        tenantId,
        severity: 'high',
        status: 'new',
        type: 'trap_triggered',
        message: 'Alert synced from device',
        createdAt: triggeredAt,
      });

      logger.info('Alert synced from device state on reconnect', {
        alertId,
        deviceId,
        tenantId,
        macAddress: macAddress.toUpperCase(),
        alertLevel: status.alert_level,
        triggeredAt,
      });

      console.log(`[MQTT] Created synced alert ${alertId} for device ${deviceName}`);
    } catch (error) {
      console.error('[MQTT] Error syncing device alert state:', error);
      logger.error('Error syncing device alert state', {
        tenantId,
        macAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle alert cleared notification from device
   */
  private async handleAlertCleared(parsedTopic: ParsedTopic, message: any): Promise<void> {
    const { tenantId, macAddress } = parsedTopic;

    if (!tenantId || !macAddress) {
      console.warn('[MQTT] Invalid topic for alert clear');
      return;
    }

    try {
      // Get device ID from MAC address
      const deviceQuery = await this.db.query(
        'SELECT id FROM devices WHERE tenant_id = $1 AND mqtt_client_id = $2',
        [tenantId, macAddress.toUpperCase()]
      );

      if (deviceQuery.rows.length === 0) {
        console.warn(`[MQTT] Device not found for alert clear: tenant=${tenantId}, mqtt_client_id=${macAddress}`);
        return;
      }

      const deviceId = deviceQuery.rows[0].id;

      // Resolve all active alerts for this device
      // Note: resolve_consistency constraint requires resolved_by (UUID) AND resolved_at when status='resolved'
      // resolved_by has FK to users, so we need to find a user in the tenant to use
      const userQuery = await this.db.query(
        `SELECT u.id FROM users u
         JOIN user_tenant_memberships utm ON u.id = utm.user_id
         WHERE utm.tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );

      // Use the first tenant user, or fall back to a hardcoded admin if none found
      const resolvedBy = userQuery.rows[0]?.id || '10000000-0000-0000-0000-000000000001';

      const updateQuery = `
        UPDATE alerts
        SET status = 'resolved',
            resolved_at = NOW(),
            resolved_by = $3,
            notes = COALESCE(notes || ' | ', '') || 'Cleared from device',
            updated_at = NOW()
        WHERE device_id = $1 AND tenant_id = $2 AND status IN ('new', 'acknowledged')
        RETURNING id
      `;

      const result = await this.db.query(updateQuery, [deviceId, tenantId, resolvedBy]);

      if (result.rows.length > 0) {
        console.log(`[MQTT] Cleared ${result.rows.length} alert(s) for device ${macAddress}`);

        // Emit WebSocket event for each cleared alert
        result.rows.forEach((row: any) => {
          this.emit('alert:resolved', {
            id: row.id,
            deviceId,
            tenantId,
          });
        });
      }
    } catch (error) {
      console.error('[MQTT] Error clearing alerts:', error);
      logger.error('Error clearing device alerts', {
        tenantId,
        macAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle motion event from Scout device
   * Sends image to classification service and stores result
   */
  private async handleMotionEvent(parsedTopic: ParsedTopic, message: MotionEventMessage): Promise<void> {
    const { tenantId, macAddress } = parsedTopic;

    if (!tenantId || !macAddress) {
      console.error('[MQTT] Invalid motion event - missing tenantId or macAddress');
      return;
    }

    const startTime = Date.now();
    console.log(`[MQTT] Motion event received from ${macAddress} (tenant: ${tenantId})`);

    try {
      // Get device ID from mqtt_client_id
      const deviceQuery = await this.db.query(
        'SELECT id, name FROM devices WHERE tenant_id = $1 AND mqtt_client_id = $2',
        [tenantId, macAddress.toUpperCase()]
      );

      if (deviceQuery.rows.length === 0) {
        console.warn(`[MQTT] Device not found for motion event: ${macAddress}`);
        return;
      }

      const deviceId = deviceQuery.rows[0].id;
      const deviceName = deviceQuery.rows[0].name || macAddress;

      // Extract image from message
      const imageBase64 = message.image;
      if (!imageBase64) {
        console.warn(`[MQTT] Motion event missing image data from ${macAddress}`);
        return;
      }

      // Call classification service
      logger.info('Classifying motion event image', {
        tenantId,
        macAddress,
        deviceId,
        imageSize: imageBase64.length,
      });

      const classification = await classifyImage(imageBase64);
      const classificationTimeMs = Date.now() - startTime;

      console.log(`[MQTT] Classification result for ${macAddress}: ${classification.classification} (${(classification.confidence * 100).toFixed(1)}%)`);

      // Store classification result in database
      const insertQuery = `
        INSERT INTO image_classifications (
          device_id,
          tenant_id,
          image_hash,
          classification,
          confidence,
          all_predictions,
          model_version,
          inference_time_ms,
          image_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, classified_at
      `;

      // Generate hash for deduplication
      const crypto = await import('crypto');
      const imageHash = crypto.createHash('sha256').update(imageBase64.slice(0, 1000)).digest('hex');

      const result = await this.db.query(insertQuery, [
        deviceId,
        tenantId,
        imageHash,
        classification.classification,
        classification.confidence,
        JSON.stringify(classification.predictions),
        'mobilenet-docker-v1',
        classification.processingTimeMs || classificationTimeMs,
        'motion_event',
      ]);

      const classificationId = result.rows[0].id;

      // Update device's last classification
      await this.db.query(
        `UPDATE devices SET
          last_classification = $2,
          last_classification_confidence = $3,
          last_classification_at = NOW(),
          updated_at = NOW()
        WHERE id = $1`,
        [deviceId, classification.classification, classification.confidence]
      );

      logger.info('Motion event classified and stored', {
        classificationId,
        deviceId,
        tenantId,
        classification: classification.classification,
        confidence: classification.confidence,
        topMatch: classification.topMatch,
        timeMs: classificationTimeMs,
      });

      // If rodent detected with high confidence, create an alert
      if (classification.classification === 'rodent' && classification.confidence > 0.5) {
        // Check if device already has an active alert - only one alert per trap
        const existingAlert = await this.db.query(
          `SELECT id FROM alerts WHERE device_id = $1 AND status IN ('new', 'acknowledged') LIMIT 1`,
          [deviceId]
        );

        if (existingAlert.rows.length > 0) {
          console.log(`[MQTT] Device ${deviceName} already has active alert, skipping rodent detection alert`);
        } else {
          console.log(`[MQTT] Rodent detected by ${deviceName}! Creating alert...`);

          const alertQuery = `
            INSERT INTO alerts (
              device_id, tenant_id, severity, status, sensor_data, triggered_at
            ) VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id
          `;

        const severity = classification.confidence > 0.8 ? 'high' : 'medium';
        const sensorData = {
          alert_type: 'rodent_detected',
          message: `Rodent detected with ${(classification.confidence * 100).toFixed(0)}% confidence`,
          classification: classification.classification,
          confidence: classification.confidence,
          topMatch: classification.topMatch,
          classificationId,
          source: 'ai_classification',
        };

        const alertResult = await this.db.query(alertQuery, [
          deviceId,
          tenantId,
          severity,
          'new',
          JSON.stringify(sensorData),
        ]);

        const alertId = alertResult.rows[0].id;

        // Emit WebSocket event for real-time notification
        this.emit('device:alert', {
          id: alertId,
          deviceId,
          tenantId,
          severity,
          status: 'new',
          type: 'rodent_detected',
          message: sensorData.message,
          createdAt: new Date().toISOString(),
        });

        // Send push notification
        const pushService = getPushService();
        if (pushService) {
          pushService.handleAlertNotification({
            alertId,
            deviceId,
            deviceName,
            alertType: 'rodent_detected',
            severity,
            tenantId,
            message: sensorData.message,
          }).catch((err: Error) => {
            logger.error('Failed to send push notification for rodent detection', { error: err.message, alertId });
          });
        }

        // Notify emergency contacts
        this.notifyEmergencyContactsImmediately(tenantId, deviceName, alertId).catch((err: Error) => {
          logger.error('Failed to notify emergency contacts for rodent detection', { error: err.message, alertId });
        });

          console.log(`[MQTT] Alert ${alertId} created for rodent detection on ${deviceName}`);
        }
      }

      // Emit classification event for WebSocket/dashboard updates
      this.emit('motion_classified' as any, {
        tenantId,
        deviceId,
        macAddress: macAddress.toUpperCase(),
        classification: classification.classification,
        confidence: classification.confidence,
        topMatch: classification.topMatch,
        classificationId,
        timestamp: message.timestamp || Date.now(),
      });

    } catch (error) {
      console.error('[MQTT] Error handling motion event:', error);
      logger.error('Error handling motion event', {
        tenantId,
        macAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Send immediate notification to all emergency contacts for a tenant
   * Called when an alert is first created (Level 1)
   */
  private async notifyEmergencyContactsImmediately(
    tenantId: string,
    deviceName: string,
    alertId: string
  ): Promise<void> {
    try {
      // Get all users in this tenant
      const usersResult = await this.db.query<{ user_id: string }>(
        `SELECT DISTINCT utm.user_id
         FROM user_tenant_memberships utm
         WHERE utm.tenant_id = $1`,
        [tenantId]
      );

      if (usersResult.rows.length === 0) {
        logger.debug('[MQTT] No users in tenant for emergency contact notification', { tenantId });
        return;
      }

      const emailService = getEmailService();
      const smsService = getSmsService();

      let emailsSent = 0;
      let smsSent = 0;

      for (const user of usersResult.rows) {
        // Get all enabled emergency contacts for this user (level 1 = immediate)
        const contactsResult = await this.db.query<{
          id: string;
          contact_type: 'email' | 'sms' | 'app_user';
          contact_value: string;
          contact_name: string | null;
        }>(
          `SELECT id, contact_type, contact_value, contact_name
           FROM emergency_contacts
           WHERE user_id = $1 AND enabled = true`,
          [user.user_id]
        );

        for (const contact of contactsResult.rows) {
          try {
            if (contact.contact_type === 'email' && emailService?.isEnabled()) {
              const result = await emailService.sendTrapAlert(
                contact.contact_value,
                deviceName,
                0, // Just triggered
                1, // Level 1 (initial)
                contact.contact_name || undefined
              );
              if (result.success) {
                emailsSent++;
                logger.info('[MQTT] Immediate email sent to emergency contact', {
                  email: contact.contact_value,
                  alertId,
                  deviceName,
                });
              }
            } else if (contact.contact_type === 'sms' && smsService?.isEnabled()) {
              const result = await smsService.sendTrapAlert(
                contact.contact_value,
                deviceName,
                0,
                1,
                contact.contact_name || undefined
              );
              if (result.success) {
                smsSent++;
                logger.info('[MQTT] Immediate SMS sent to emergency contact', {
                  phone: contact.contact_value,
                  alertId,
                  deviceName,
                });
              }
            }
            // Note: app_user contacts are already handled by push notifications
          } catch (err: any) {
            logger.error('[MQTT] Failed to notify emergency contact', {
              contactId: contact.id,
              contactType: contact.contact_type,
              error: err.message,
            });
          }
        }
      }

      if (emailsSent > 0 || smsSent > 0) {
        logger.info('[MQTT] Emergency contacts notified immediately', {
          alertId,
          deviceName,
          emailsSent,
          smsSent,
        });
      }
    } catch (error: any) {
      logger.error('[MQTT] Error notifying emergency contacts', {
        tenantId,
        alertId,
        error: error.message,
      });
    }
  }

  /**
   * Reset device heartbeat timer
   */
  private resetDeviceHeartbeat(tenantId: string, macAddress: string): void {
    const key = `${tenantId}:${macAddress}`;

    // Clear existing timer
    if (this.deviceHeartbeatTimers.has(key)) {
      clearTimeout(this.deviceHeartbeatTimers.get(key)!);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.handleDeviceTimeout(tenantId, macAddress);
    }, this.DEVICE_TIMEOUT_MS);

    this.deviceHeartbeatTimers.set(key, timer);
  }

  /**
   * Handle device timeout (no heartbeat received)
   */
  private async handleDeviceTimeout(tenantId: string, macAddress: string): Promise<void> {
    console.warn(`[MQTT] Device timeout: ${macAddress} (tenant: ${tenantId})`);

    try {
      // Mark device as offline in database
      const query = `
        UPDATE devices
        SET online = false, updated_at = NOW()
        WHERE tenant_id = $1 AND mac_address = $2
      `;

      await this.db.query(query, [tenantId, macAddress.toUpperCase()]);

      // Emit offline event
      this.emit('device:offline', { tenantId, macAddress: macAddress.toUpperCase() });
    } catch (error) {
      console.error('[MQTT] Error handling device timeout:', error);
    }
  }

  /**
   * Publish firmware update notification
   */
  public async publishFirmwareUpdate(
    tenantId: string,
    update: FirmwareUpdateMessage,
    isGlobal: boolean = false
  ): Promise<void> {
    const topic = isGlobal
      ? mqttTopics.globalFirmwareUpdate()
      : mqttTopics.firmwareUpdate(tenantId);

    await this.publish(topic, update, { qos: 1, retain: true });
    console.log(`[MQTT] Published firmware update to ${topic}:`, update);
  }

  /**
   * Publish filesystem update notification
   */
  public async publishFilesystemUpdate(
    tenantId: string,
    update: FilesystemUpdateMessage,
    isGlobal: boolean = false
  ): Promise<void> {
    const topic = isGlobal
      ? mqttTopics.globalFilesystemUpdate()
      : mqttTopics.filesystemUpdate(tenantId);

    await this.publish(topic, update, { qos: 1, retain: true });
    console.log(`[MQTT] Published filesystem update to ${topic}:`, update);
  }

  /**
   * Publish command to specific device
   */
  public async publishDeviceCommand(
    tenantId: string,
    macAddress: string,
    command: DeviceCommandMessage
  ): Promise<void> {
    const topic = mqttTopics.deviceCommand(tenantId, macAddress, command.command);

    await this.publish(topic, command, { qos: this.config.qos.commands, retain: false });
    console.log(`[MQTT] Published command to ${topic}:`, command);
  }

  /**
   * Reboot a device
   */
  public async rebootDevice(tenantId: string, macAddress: string): Promise<void> {
    const command: DeviceCommandMessage = {
      command: 'reboot',
      timestamp: Date.now(),
    };

    await this.publishDeviceCommand(tenantId, macAddress, command);
  }

  /**
   * Request device status
   */
  public async requestDeviceStatus(tenantId: string, macAddress: string): Promise<void> {
    const command: DeviceCommandMessage = {
      command: 'status',
      timestamp: Date.now(),
    };

    await this.publishDeviceCommand(tenantId, macAddress, command);
  }

  /**
   * Reset device alert
   */
  public async resetDeviceAlert(tenantId: string, macAddress: string): Promise<void> {
    const command: DeviceCommandMessage = {
      command: 'alert_reset',
      timestamp: Date.now(),
    };

    await this.publishDeviceCommand(tenantId, macAddress, command);
  }

  /**
   * Trigger test alert on device (activates buzzer/LED without taking photos)
   */
  public async triggerTestAlert(tenantId: string, mqttClientId: string): Promise<void> {
    const command: DeviceCommandMessage = {
      command: 'test_trigger',
      timestamp: Date.now(),
    };

    await this.publishDeviceCommand(tenantId, mqttClientId, command);
    console.log(`[MQTT] Sent test_trigger command to ${mqttClientId}`);
  }

  /**
   * Request camera snapshot from device
   */
  public async requestSnapshot(tenantId: string, macAddress: string): Promise<void> {
    const command: DeviceCommandMessage = {
      command: 'capture_snapshot',
      timestamp: Date.now(),
    };

    logger.info('Requesting snapshot from device', {
      tenantId,
      macAddress: macAddress.toUpperCase(),
    });

    await this.publishDeviceCommand(tenantId, macAddress, command);
  }

  /**
   * Clear a specific retained message on a topic
   */
  public async clearRetainedMessage(topic: string): Promise<void> {
    await this.publish(topic, null, { qos: 1, retain: true });
    console.log(`[MQTT] Cleared retained message on ${topic}`);
  }

  /**
   * Clear all retained firmware/filesystem messages for a tenant (including global)
   */
  public async clearAllRetainedUpdates(tenantId: string): Promise<void> {
    const topics = [
      mqttTopics.firmwareUpdate(tenantId),
      mqttTopics.filesystemUpdate(tenantId),
      mqttTopics.globalFirmwareUpdate(),
      mqttTopics.globalFilesystemUpdate(),
    ];

    for (const topic of topics) {
      await this.clearRetainedMessage(topic);
    }
  }

  /**
   * Publish server online status
   */
  private async publishServerStatus(online: boolean): Promise<void> {
    const status = {
      online,
      timestamp: Date.now(),
    };

    await this.publish('server/status', status, { qos: 1, retain: true });
  }

  /**
   * Generic publish method (private)
   */
  private async publish(
    topic: string,
    payload: any,
    options: MqttPublishOptions = {}
  ): Promise<void> {
    if (!this.client?.connected) {
      throw new Error('MQTT client not connected');
    }

    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, message, {
        qos: options.qos || this.config.qos.default,
        retain: options.retain || false,
        dup: options.dup || false,
      }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Public publish method for device revocation
   *
   * SECURITY: The token parameter is required for devices to verify the revocation.
   * Devices should call /api/device/verify-revocation to validate the token
   * before actually unclaiming. This prevents accidental unclaims from network
   * issues or malformed messages.
   */
  public async publishDeviceRevocation(
    tenantId: string,
    mqttClientId: string,
    reason: string = 'Admin unclaimed device',
    token: string  // Required token for device verification
  ): Promise<void> {
    const topic = `tenant/${tenantId}/device/${mqttClientId}/revoke`;
    const message = {
      action: 'revoke',
      token,  // Device must verify this token before unclaiming
      timestamp: Date.now(),
      reason,
    };

    // NOTE: Using retain: false to prevent issues with re-claimed devices
    // receiving old revoke messages. The device also checks claim status via HTTP.
    await this.publish(topic, message, { qos: 1, retain: false });
    console.log(`[MQTT] Published device revocation to ${topic} (with verification token)`);
    logger.info('Device revocation published', {
      tenantId,
      mqttClientId,
      reason,
      hasToken: true,
    });
  }

  /**
   * Clear any retained revoke message for a device
   * This should be called when a device is successfully claimed to prevent
   * the device from receiving old revoke messages from previous unclaims
   */
  public async clearDeviceRevocation(
    tenantId: string,
    mqttClientId: string
  ): Promise<void> {
    const topic = `tenant/${tenantId}/device/${mqttClientId}/revoke`;
    await this.clearRetainedMessage(topic);
    console.log(`[MQTT] Cleared retained revoke message for device ${mqttClientId}`);
    logger.info('Device revocation cleared', {
      tenantId,
      mqttClientId,
    });
  }

  /**
   * Rotate MQTT credentials for a device
   * Used for migrating devices to Dynamic Security without re-claiming
   *
   * Flow:
   * 1. Generate new password
   * 2. Add new credentials to Mosquitto (both old and new systems during migration)
   * 3. Send rotate_credentials command to device via MQTT
   * 4. Device updates its stored password and reconnects
   * 5. On successful reconnect, remove old credentials
   */
  public async rotateDeviceCredentials(
    tenantId: string,
    mqttClientId: string,
    newPassword: string,
    rotationId: string
  ): Promise<void> {
    const topic = mqttTopics.deviceCommand(tenantId, mqttClientId, 'rotate_credentials');
    const message = {
      command: 'rotate_credentials',
      password: newPassword,
      rotationId,
      timestamp: Date.now(),
    };

    await this.publish(topic, message, { qos: 1, retain: false });
    console.log(`[MQTT] Published credential rotation to ${topic} (rotationId: ${rotationId})`);
    logger.info('Device credential rotation published', {
      tenantId,
      mqttClientId,
      rotationId,
    });
  }

  /**
   * Rotate device credentials with ACK confirmation
   *
   * This method waits for the device to ACK the rotation before returning.
   * If no ACK is received within the timeout, returns false.
   *
   * Flow:
   * 1. Send rotate_credentials command to device
   * 2. Wait for rotation_ack message from device
   * 3. Return true if ACK received, false if timeout
   */
  public async rotateDeviceCredentialsWithAck(
    tenantId: string,
    mqttClientId: string,
    newPassword: string,
    rotationId: string
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        const pending = this.pendingRotations.get(rotationId);
        if (pending) {
          this.pendingRotations.delete(rotationId);
          console.log(`[MQTT] Rotation ACK timeout for ${mqttClientId} (${rotationId})`);
          logger.warn('Credential rotation ACK timeout', {
            tenantId,
            mqttClientId,
            rotationId,
          });
          resolve(false);
        }
      }, this.ROTATION_ACK_TIMEOUT_MS);

      // Store pending rotation
      const pending: PendingRotation = {
        rotationId,
        mqttClientId,
        tenantId,
        newPassword,
        createdAt: Date.now(),
        resolve,
        timeout,
      };
      this.pendingRotations.set(rotationId, pending);

      // Send the rotation command
      this.rotateDeviceCredentials(tenantId, mqttClientId, newPassword, rotationId)
        .catch((error) => {
          // Clean up and reject on publish failure
          clearTimeout(timeout);
          this.pendingRotations.delete(rotationId);
          console.error(`[MQTT] Failed to publish rotation command: ${error.message}`);
          resolve(false);
        });
    });
  }

  /**
   * Handle rotation ACK from device
   */
  private handleRotationAck(parsedTopic: ParsedTopic, message: any): void {
    const { tenantId, macAddress } = parsedTopic;
    const rotationId = message.rotationId;
    const success = message.success !== false; // Default to true if not specified

    console.log(`[MQTT] Rotation ACK received from ${macAddress}: rotationId=${rotationId}, success=${success}`);

    if (!rotationId) {
      console.warn('[MQTT] Rotation ACK missing rotationId');
      return;
    }

    const pending = this.pendingRotations.get(rotationId);
    if (!pending) {
      console.warn(`[MQTT] No pending rotation found for ${rotationId}`);
      return;
    }

    // Verify it's from the expected device
    if (pending.mqttClientId !== macAddress) {
      console.warn(`[MQTT] Rotation ACK device mismatch: expected ${pending.mqttClientId}, got ${macAddress}`);
      return;
    }

    // Clear timeout and pending
    clearTimeout(pending.timeout);
    this.pendingRotations.delete(rotationId);

    logger.info('Credential rotation ACK received', {
      tenantId,
      mqttClientId: macAddress,
      rotationId,
      success,
    });

    // Resolve the promise
    pending.resolve(success);
  }

  /**
   * Get pending rotation by device
   * Useful for checking if a device has a rotation in progress
   */
  public getPendingRotation(mqttClientId: string): PendingRotation | undefined {
    for (const pending of this.pendingRotations.values()) {
      if (pending.mqttClientId === mqttClientId) {
        return pending;
      }
    }
    return undefined;
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isShuttingDown || this.isConnecting) {
      return;
    }

    this.reconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, max 60s
    const baseDelay = 1000;
    const maxDelay = 60000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), maxDelay);

    console.log(`[MQTT] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this.isShuttingDown) {
        return;
      }

      try {
        await this.connect();
      } catch (error) {
        console.error('[MQTT] Reconnect failed:', error);
        // Will schedule another reconnect via the 'offline' or 'close' event
      }
    }, delay);
  }

  /**
   * Disconnect from MQTT broker
   */
  public async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clear all heartbeat timers
    this.deviceHeartbeatTimers.forEach((timer) => clearTimeout(timer));
    this.deviceHeartbeatTimers.clear();

    if (this.client) {
      // Publish offline status before disconnecting
      try {
        await this.publishServerStatus(false);
      } catch (error) {
        console.error('[MQTT] Error publishing offline status:', error);
      }

      return new Promise((resolve) => {
        this.client!.end(false, {}, () => {
          console.log('[MQTT] Disconnected');
          resolve();
        });
      });
    }
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.client?.connected || false;
  }

  /**
   * Get connection status
   */
  public getStatus(): {
    connected: boolean;
    reconnectAttempts: number;
    clientId: string | undefined;
  } {
    return {
      connected: this.isConnected(),
      reconnectAttempts: this.reconnectAttempts,
      clientId: this.client?.options?.clientId,
    };
  }
}

/**
 * Factory function to create and initialize MQTT service
 */
export async function createMqttService(config: MqttConfig, dbPool: Pool): Promise<MqttService> {
  const service = new MqttService(config, dbPool);
  await service.connect();
  return service;
}

// Singleton instance for services that need to access MQTT without constructor injection
let mqttServiceInstance: MqttService | null = null;

export function setMqttService(service: MqttService): void {
  mqttServiceInstance = service;
}

export function getMqttService(): MqttService | null {
  return mqttServiceInstance;
}
