-- Migration 006: Create device claiming queue table
-- This table tracks devices that have entered "claiming mode" via button press
-- Enables Web Bluetooth and mDNS discovery for seamless device setup

CREATE TABLE IF NOT EXISTS device_claiming_queue (
  id SERIAL PRIMARY KEY,
  mac_address VARCHAR(17) UNIQUE NOT NULL,
  serial_number VARCHAR(50),
  ip_address VARCHAR(45),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_mac CHECK (mac_address ~ '^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$')
);

-- Index for efficient expiration queries
CREATE INDEX idx_claiming_expires ON device_claiming_queue(expires_at);

-- Index for MAC lookup
CREATE INDEX idx_claiming_mac ON device_claiming_queue(mac_address);

-- Auto-cleanup function to remove expired entries
CREATE OR REPLACE FUNCTION cleanup_expired_claiming_devices()
RETURNS void AS $$
BEGIN
  DELETE FROM device_claiming_queue WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE device_claiming_queue IS 'Temporary queue of devices in claiming mode waiting to be claimed by users';
COMMENT ON COLUMN device_claiming_queue.mac_address IS 'Device MAC address (unique identifier)';
COMMENT ON COLUMN device_claiming_queue.serial_number IS 'Device serial number from manufacturer';
COMMENT ON COLUMN device_claiming_queue.ip_address IS 'Current IP address of device on local network';
COMMENT ON COLUMN device_claiming_queue.expires_at IS 'When claiming mode expires (10 minutes after button press)';
COMMENT ON COLUMN device_claiming_queue.created_at IS 'When device entered claiming mode';
