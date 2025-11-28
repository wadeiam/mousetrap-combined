/**
 * MQTT Message Type Definitions
 *
 * These types define the exact message formats used by ESP32 devices
 * for communication with the MQTT broker.
 */

// ============================================================================
// Device-to-Server Messages (Published by ESP32)
// ============================================================================

/**
 * Device Status Message
 * Topic: tenant/{tenantId}/device/{macAddress}/status
 * QoS: 1, Retained: true
 * Published: On connection, every 5 minutes, or on command
 */
export interface DeviceStatusMessage {
  online: boolean;
  firmware_version: string;
  filesystem_version: string;
  uptime: number;        // seconds
  heap_free: number;     // bytes
  rssi: number;          // WiFi signal strength (dBm)
  ip: string;            // Local IP address
}

/**
 * OTA Progress Message
 * Topic: tenant/{tenantId}/device/{macAddress}/ota/progress
 * QoS: 0, Retained: false
 * Published: During OTA updates (every 10% and on completion/error)
 */
export interface OtaProgressMessage {
  type: 'firmware' | 'filesystem';
  status: 'downloading' | 'verifying' | 'success' | 'error';
  progress: number;      // 0-100
  bytes_downloaded: number;
  total_bytes: number;
  error?: string;        // Only present when status is 'error'
}

// ============================================================================
// Server-to-Device Messages (Published by Server, Subscribed by ESP32)
// ============================================================================

/**
 * Firmware Update Notification
 * Topic: tenant/{tenantId}/firmware/latest OR global/firmware/latest
 * QoS: 1, Retained: true
 * Published: When new firmware is available
 */
export interface FirmwareUpdateMessage {
  version: string;       // Semantic version (e.g., "1.2.3")
  url: string;          // HTTP(S) download URL
  size: number;         // File size in bytes
  sha256: string;       // SHA-256 hash for verification
  changelog?: string;   // Optional release notes
  required?: boolean;   // If true, device MUST update
}

/**
 * Filesystem Update Notification
 * Topic: tenant/{tenantId}/filesystem/latest OR global/filesystem/latest
 * QoS: 1, Retained: true
 * Published: When new filesystem image is available
 */
export interface FilesystemUpdateMessage {
  version: string;       // Semantic version (e.g., "1.0.0")
  url: string;          // HTTP(S) download URL
  size: number;         // File size in bytes
  sha256: string;       // SHA-256 hash for verification
  changelog?: string;   // Optional release notes
  required?: boolean;   // If true, device MUST update
}

/**
 * Device Command Message
 * Topic: tenant/{tenantId}/device/{macAddress}/command/{commandType}
 * QoS: 1, Retained: false
 * Published: When server needs device to perform action
 */
export interface DeviceCommandMessage {
  command: 'reboot' | 'status' | 'alert_reset' | 'calibrate' | 'test_alert' | 'ota_update' | 'capture_snapshot' | 'update_tenant';
  params?: Record<string, any>;  // Command-specific parameters
  timestamp?: number;            // Unix timestamp (ms)
  requestId?: string;            // For tracking command execution
  // OTA-specific fields (when command is 'ota_update')
  type?: 'firmware' | 'filesystem';
  version?: string;
  url?: string;
  size?: number;
  sha256?: string;
  // Tenant move fields (when command is 'update_tenant')
  tenantId?: string;             // New tenant ID
  deviceId?: string;             // Device ID (usually unchanged)
  deviceName?: string;           // Device name (usually unchanged)
}

// ============================================================================
// MQTT Topic Structure
// ============================================================================

export interface MqttTopics {
  // Device publishes to these topics
  deviceStatus: (tenantId: string, macAddress: string) => string;
  otaProgress: (tenantId: string, macAddress: string) => string;

  // Server publishes to these topics
  firmwareUpdate: (tenantId: string) => string;
  filesystemUpdate: (tenantId: string) => string;
  deviceCommand: (tenantId: string, macAddress: string, commandType?: string) => string;

  // Global admin topics (override tenant-specific)
  globalFirmwareUpdate: () => string;
  globalFilesystemUpdate: () => string;
}

/**
 * MQTT topic builder helper
 */
export const mqttTopics: MqttTopics = {
  // Device → Server
  deviceStatus: (tenantId: string, macAddress: string) =>
    `tenant/${tenantId}/device/${macAddress}/status`,

  otaProgress: (tenantId: string, macAddress: string) =>
    `tenant/${tenantId}/device/${macAddress}/ota/progress`,

  // Server → Device
  firmwareUpdate: (tenantId: string) =>
    `tenant/${tenantId}/firmware/latest`,

  filesystemUpdate: (tenantId: string) =>
    `tenant/${tenantId}/filesystem/latest`,

  deviceCommand: (tenantId: string, macAddress: string, commandType: string = '#') =>
    `tenant/${tenantId}/device/${macAddress}/command/${commandType}`,

  // Global admin topics
  globalFirmwareUpdate: () =>
    'global/firmware/latest',

  globalFilesystemUpdate: () =>
    'global/filesystem/latest',
};

// ============================================================================
// MQTT Configuration
// ============================================================================

export interface MqttConfig {
  broker: {
    url: string;          // mqtt://host:port or mqtts://host:port
    host?: string;        // Deprecated: use url instead
    port?: number;        // Deprecated: use url instead
  };
  auth?: {
    username: string;
    password: string;
  };
  client: {
    clientId?: string;    // Auto-generated if not provided
    clean: boolean;       // Clean session
    reconnectPeriod: number;      // ms
    connectTimeout: number;       // ms
    keepalive: number;            // seconds
  };
  qos: {
    default: 0 | 1 | 2;
    status: 0 | 1 | 2;
    commands: 0 | 1 | 2;
  };
}

// ============================================================================
// MQTT Service Events
// ============================================================================

/**
 * Events emitted by the MQTT service
 * These can be listened to by the Express server to forward to WebSocket clients
 */
export interface MqttServiceEvents {
  'connected': () => void;
  'disconnected': (error?: Error) => void;
  'reconnecting': () => void;
  'error': (error: Error) => void;

  'device:status': (data: { tenantId: string; macAddress: string; status: DeviceStatusMessage }) => void;
  'device:ota_progress': (data: { tenantId: string; macAddress: string; progress: OtaProgressMessage }) => void;
  'device:online': (data: { tenantId: string; macAddress: string }) => void;
  'device:offline': (data: { tenantId: string; macAddress: string }) => void;
  'device:alert': (data: { id: string; deviceId: string; tenantId: string; severity: string; type: string; message: string; createdAt: string }) => void;
  'snapshot': (data: { tenantId: string; macAddress: string; imageData: string; timestamp: number }) => void;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Parsed MQTT topic components
 */
export interface ParsedTopic {
  type: 'device_status' | 'ota_progress' | 'firmware_update' | 'filesystem_update' | 'device_command' | 'camera_snapshot' | 'device_alert' | 'alert_cleared' | 'unknown';
  tenantId?: string;
  macAddress?: string;
  commandType?: string;
  isGlobal?: boolean;
}

/**
 * MQTT Publish Options
 */
export interface MqttPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
  dup?: boolean;
}

/**
 * Device info extracted from MAC address
 */
export interface DeviceInfo {
  macAddress: string;     // Uppercase, with colons (e.g., "AA:BB:CC:DD:EE:FF")
  tenantId: string;       // Tenant identifier
  lastSeen?: Date;        // Last status message received
  online: boolean;        // Current online status
}
