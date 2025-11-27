-- ============================================================================
-- MQTT Integration Database Schema
-- Migration: 001_create_mqtt_tables.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Devices Table
-- Stores all registered IoT devices with their current status
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,

  -- Identity
  tenant_id VARCHAR(50) NOT NULL,
  mac_address VARCHAR(17) NOT NULL,

  -- Status
  online BOOLEAN DEFAULT false,
  firmware_version VARCHAR(20),
  filesystem_version VARCHAR(20),

  -- Telemetry
  uptime INTEGER,              -- Uptime in seconds
  heap_free INTEGER,           -- Free heap in bytes
  rssi INTEGER,                -- WiFi signal strength in dBm
  local_ip INET,               -- Local IP address

  -- Metadata
  location VARCHAR(100),       -- Human-readable location
  label VARCHAR(100),          -- Optional device label
  paused BOOLEAN DEFAULT false,-- Alert pause flag

  -- Timestamps
  last_seen TIMESTAMP,         -- Last status message received
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  UNIQUE(tenant_id, mac_address)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_devices_tenant_id ON devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_online ON devices(online);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
CREATE INDEX IF NOT EXISTS idx_devices_tenant_mac ON devices(tenant_id, mac_address);

-- ----------------------------------------------------------------------------
-- Device OTA Logs Table
-- Tracks all OTA update attempts and their progress
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_ota_logs (
  id SERIAL PRIMARY KEY,

  -- Identity
  tenant_id VARCHAR(50) NOT NULL,
  mac_address VARCHAR(17) NOT NULL,

  -- OTA Details
  ota_type VARCHAR(20) NOT NULL,           -- 'firmware' or 'filesystem'
  status VARCHAR(20) NOT NULL,             -- 'downloading', 'verifying', 'success', 'error'
  progress INTEGER,                        -- 0-100

  -- Transfer Stats
  bytes_downloaded BIGINT,
  total_bytes BIGINT,

  -- Error Tracking
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ota_logs_tenant_id ON device_ota_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ota_logs_mac_address ON device_ota_logs(mac_address);
CREATE INDEX IF NOT EXISTS idx_ota_logs_status ON device_ota_logs(status);
CREATE INDEX IF NOT EXISTS idx_ota_logs_created_at ON device_ota_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ota_logs_tenant_mac ON device_ota_logs(tenant_id, mac_address);

-- ----------------------------------------------------------------------------
-- Device Alerts Table
-- Stores device alert events (trap triggers, sensor alerts, etc.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_alerts (
  id SERIAL PRIMARY KEY,

  -- Identity
  tenant_id VARCHAR(50) NOT NULL,
  mac_address VARCHAR(17) NOT NULL,

  -- Alert Details
  alert_type VARCHAR(50) NOT NULL,         -- 'trap_triggered', 'offline', 'low_battery', etc.
  alert_status VARCHAR(20) NOT NULL,       -- 'active', 'cleared', 'acknowledged'
  severity VARCHAR(20),                     -- 'low', 'medium', 'high', 'critical'

  -- Alert Data
  message TEXT,
  metadata JSONB,                          -- Additional alert-specific data

  -- Timestamps
  triggered_at TIMESTAMP DEFAULT NOW(),
  cleared_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_id ON device_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alerts_mac_address ON device_alerts(mac_address);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON device_alerts(alert_status);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at ON device_alerts(triggered_at);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_mac ON device_alerts(tenant_id, mac_address);

-- ----------------------------------------------------------------------------
-- Firmware Versions Table
-- Tracks available firmware versions for OTA updates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS firmware_versions (
  id SERIAL PRIMARY KEY,

  -- Identity
  tenant_id VARCHAR(50),                   -- NULL for global versions

  -- Version Info
  version VARCHAR(20) NOT NULL,
  type VARCHAR(20) NOT NULL,               -- 'firmware' or 'filesystem'

  -- Download Info
  url TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,

  -- Metadata
  changelog TEXT,
  required BOOLEAN DEFAULT false,
  is_global BOOLEAN DEFAULT false,

  -- Timestamps
  published_at TIMESTAMP DEFAULT NOW(),
  deprecated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  UNIQUE(tenant_id, version, type)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_firmware_tenant_id ON firmware_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_firmware_type ON firmware_versions(type);
CREATE INDEX IF NOT EXISTS idx_firmware_published_at ON firmware_versions(published_at);

-- ----------------------------------------------------------------------------
-- Device Commands Table
-- Logs all commands sent to devices
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_commands (
  id SERIAL PRIMARY KEY,

  -- Identity
  tenant_id VARCHAR(50) NOT NULL,
  mac_address VARCHAR(17) NOT NULL,

  -- Command Details
  command_type VARCHAR(50) NOT NULL,       -- 'reboot', 'status', 'alert_reset', etc.
  params JSONB,                            -- Command parameters
  request_id VARCHAR(36),                  -- UUID for tracking

  -- Status
  status VARCHAR(20) DEFAULT 'sent',       -- 'sent', 'acknowledged', 'completed', 'failed'
  response JSONB,                          -- Response from device
  error_message TEXT,

  -- Timestamps
  sent_at TIMESTAMP DEFAULT NOW(),
  acknowledged_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_commands_tenant_id ON device_commands(tenant_id);
CREATE INDEX IF NOT EXISTS idx_commands_mac_address ON device_commands(mac_address);
CREATE INDEX IF NOT EXISTS idx_commands_status ON device_commands(status);
CREATE INDEX IF NOT EXISTS idx_commands_sent_at ON device_commands(sent_at);
CREATE INDEX IF NOT EXISTS idx_commands_request_id ON device_commands(request_id);

-- ----------------------------------------------------------------------------
-- Device Telemetry Table (Optional - for high-frequency sensor data)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_telemetry (
  id SERIAL PRIMARY KEY,

  -- Identity
  tenant_id VARCHAR(50) NOT NULL,
  mac_address VARCHAR(17) NOT NULL,

  -- Telemetry Data
  metric_name VARCHAR(50) NOT NULL,
  metric_value NUMERIC,
  metric_unit VARCHAR(20),
  tags JSONB,                              -- Additional metadata/tags

  -- Timestamp
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Partitioning by date recommended for large datasets
-- CREATE INDEX for time-series queries
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON device_telemetry(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_tenant_mac ON device_telemetry(tenant_id, mac_address);
CREATE INDEX IF NOT EXISTS idx_telemetry_metric_name ON device_telemetry(metric_name);

-- ----------------------------------------------------------------------------
-- Functions & Triggers
-- ----------------------------------------------------------------------------

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for devices table
DROP TRIGGER IF EXISTS update_devices_updated_at ON devices;
CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- Views
-- ----------------------------------------------------------------------------

-- View: Active devices (online and recently seen)
CREATE OR REPLACE VIEW active_devices AS
SELECT
  d.*,
  EXTRACT(EPOCH FROM (NOW() - d.last_seen)) AS seconds_since_seen
FROM devices d
WHERE d.online = true
  AND d.last_seen > NOW() - INTERVAL '15 minutes';

-- View: Offline devices
CREATE OR REPLACE VIEW offline_devices AS
SELECT
  d.*,
  EXTRACT(EPOCH FROM (NOW() - d.last_seen)) AS seconds_since_seen
FROM devices d
WHERE d.online = false
  OR d.last_seen < NOW() - INTERVAL '15 minutes';

-- View: Recent OTA updates
CREATE OR REPLACE VIEW recent_ota_updates AS
SELECT
  tenant_id,
  mac_address,
  ota_type,
  status,
  progress,
  bytes_downloaded,
  total_bytes,
  error_message,
  created_at
FROM device_ota_logs
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- View: Active alerts
CREATE OR REPLACE VIEW active_alerts AS
SELECT
  a.*,
  d.location,
  d.label,
  EXTRACT(EPOCH FROM (NOW() - a.triggered_at)) AS seconds_active
FROM device_alerts a
JOIN devices d ON a.tenant_id = d.tenant_id AND a.mac_address = d.mac_address
WHERE a.alert_status = 'active'
ORDER BY a.triggered_at DESC;

-- ----------------------------------------------------------------------------
-- Sample Data (Development Only)
-- ----------------------------------------------------------------------------

-- Insert sample tenant
-- INSERT INTO devices (tenant_id, mac_address, online, firmware_version, filesystem_version, location, local_ip)
-- VALUES ('dev', 'AA:BB:CC:DD:EE:FF', true, '1.2.3', '1.0.0', 'Office - Desk 1', '192.168.1.100')
-- ON CONFLICT (tenant_id, mac_address) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE devices IS 'IoT devices registered in the system';
COMMENT ON TABLE device_ota_logs IS 'OTA update logs and progress tracking';
COMMENT ON TABLE device_alerts IS 'Device alerts and events (trap triggers, errors, etc.)';
COMMENT ON TABLE firmware_versions IS 'Available firmware and filesystem versions for OTA';
COMMENT ON TABLE device_commands IS 'Commands sent to devices';
COMMENT ON TABLE device_telemetry IS 'High-frequency telemetry and sensor data';

COMMENT ON COLUMN devices.tenant_id IS 'Tenant identifier (e.g., "dev", "prod-abc123")';
COMMENT ON COLUMN devices.mac_address IS 'Device MAC address (uppercase with colons)';
COMMENT ON COLUMN devices.paused IS 'If true, alerts from this device are suppressed';
COMMENT ON COLUMN device_ota_logs.ota_type IS 'Type of OTA: "firmware" or "filesystem"';
COMMENT ON COLUMN device_ota_logs.status IS 'OTA status: "downloading", "verifying", "success", "error"';
