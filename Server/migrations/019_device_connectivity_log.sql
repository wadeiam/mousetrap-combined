-- Track device online/offline transitions for connectivity history
CREATE TABLE IF NOT EXISTS device_connectivity_log (
    id SERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    event VARCHAR(10) NOT NULL CHECK (event IN ('online', 'offline')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_device_connectivity_device_time
    ON device_connectivity_log (device_id, created_at DESC);
