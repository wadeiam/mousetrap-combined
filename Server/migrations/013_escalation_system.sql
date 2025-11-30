-- Migration 013: Escalating Notification System
-- Adds emergency contacts, escalation state tracking, and preference columns
-- for the time-based urgency escalation system

-- ----------------------------------------------------------------------------
-- Emergency Contacts Table
-- Stores contacts to notify at high escalation levels
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Contact Type and Value
  contact_type VARCHAR(20) NOT NULL CHECK (contact_type IN ('app_user', 'sms', 'email')),
  contact_value TEXT NOT NULL,  -- user_id for app_user, phone number for sms, email address for email
  contact_name VARCHAR(100),    -- Display name for the contact

  -- Configuration
  escalation_level INT DEFAULT 4 CHECK (escalation_level BETWEEN 1 AND 5),  -- Minimum level to notify
  enabled BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for emergency contacts
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id ON emergency_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_enabled ON emergency_contacts(enabled) WHERE enabled = true;

-- ----------------------------------------------------------------------------
-- Alert Escalation State Table
-- Tracks escalation state for each active alert
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_escalation_state (
  alert_id UUID PRIMARY KEY REFERENCES alerts(id) ON DELETE CASCADE,

  -- Current State
  current_level INT DEFAULT 1 CHECK (current_level BETWEEN 1 AND 5),

  -- Notification Tracking
  last_notification_at TIMESTAMP WITH TIME ZONE,
  next_notification_at TIMESTAMP WITH TIME ZONE,
  notification_count INT DEFAULT 0,

  -- Contact Escalation Tracking
  contacts_notified JSONB DEFAULT '[]'::jsonb,  -- Array of {contact_id, level, notified_at}

  -- DND Override
  dnd_overridden BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for finding alerts due for escalation processing
CREATE INDEX IF NOT EXISTS idx_alert_escalation_next_notification
  ON alert_escalation_state(next_notification_at)
  WHERE next_notification_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Add escalation columns to notification_preferences
-- ----------------------------------------------------------------------------

-- Escalation preset: 'relaxed', 'normal', 'aggressive', 'custom'
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS escalation_preset VARCHAR(20) DEFAULT 'normal';

-- Custom escalation timing (JSON with level thresholds in minutes)
-- Example: {"level2": 60, "level3": 120, "level4": 240, "level5": 480}
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS custom_escalation JSONB;

-- Whether critical alerts (L4+) override DND
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS critical_override_dnd BOOLEAN DEFAULT true;

-- Whether user has acknowledged the DND override warning
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS dnd_override_acknowledged BOOLEAN DEFAULT false;

-- ----------------------------------------------------------------------------
-- Add escalation tracking columns to notification_log
-- ----------------------------------------------------------------------------
ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS escalation_level INT;

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS contact_type VARCHAR(20);

-- ----------------------------------------------------------------------------
-- Trigger for updating emergency_contacts.updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_emergency_contacts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_emergency_contacts_timestamp ON emergency_contacts;
CREATE TRIGGER update_emergency_contacts_timestamp
  BEFORE UPDATE ON emergency_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_emergency_contacts_timestamp();

-- ----------------------------------------------------------------------------
-- Trigger for updating alert_escalation_state.updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_alert_escalation_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_alert_escalation_state_timestamp ON alert_escalation_state;
CREATE TRIGGER update_alert_escalation_state_timestamp
  BEFORE UPDATE ON alert_escalation_state
  FOR EACH ROW
  EXECUTE FUNCTION update_alert_escalation_state_timestamp();

-- ----------------------------------------------------------------------------
-- Comments for documentation
-- ----------------------------------------------------------------------------
COMMENT ON TABLE emergency_contacts IS 'Emergency contacts to notify at high alert escalation levels (SMS, email, other app users)';
COMMENT ON TABLE alert_escalation_state IS 'Tracks escalation state for active alerts including notification timing and contact escalation';
COMMENT ON COLUMN notification_preferences.escalation_preset IS 'Timing preset: relaxed, normal, aggressive, or custom';
COMMENT ON COLUMN notification_preferences.custom_escalation IS 'Custom timing thresholds in minutes for each escalation level';
COMMENT ON COLUMN notification_preferences.critical_override_dnd IS 'Whether critical alerts (level 4+) should override quiet hours';
COMMENT ON COLUMN notification_preferences.dnd_override_acknowledged IS 'Whether user has seen the warning about disabling DND override';
