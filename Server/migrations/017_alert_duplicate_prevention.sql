-- Migration: Prevent duplicate alerts for same device/trigger time
-- This prevents race conditions where multiple MQTT messages create duplicate alerts

-- Create unique partial index to prevent duplicate active alerts for the same device and trigger time
-- Only applies to non-resolved alerts (resolved alerts can have the same trigger time for historical records)
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_device_triggered_unique
ON alerts (device_id, triggered_at)
WHERE status <> 'resolved';
