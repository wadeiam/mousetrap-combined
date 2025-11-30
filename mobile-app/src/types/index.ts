// User and Auth types
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'admin' | 'user' | 'viewer';
  tenantId: string;
  tenantName: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Device types
export interface Device {
  id: string;
  name: string;
  mac_address: string;
  tenant_id: string;
  status: 'online' | 'offline' | 'alerting' | 'unknown';
  battery_level: number | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  created_at: string;
  location?: string;
  trap_state: 'set' | 'triggered' | 'unknown';
  uptime?: number | null;
  rssi?: number | null;
  ip_address?: string | null;
  last_snapshot?: string | null; // base64-encoded image data
  last_snapshot_timestamp?: number | null;
  timezone?: string | null; // IANA timezone string (e.g., "America/Los_Angeles")
}

// Alert types
export interface Alert {
  id: string;
  device_id: string;
  device_name: string;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  acknowledged: boolean;
}

// Notification preferences
export interface NotificationPreferences {
  trap_alerts: boolean;
  device_offline: boolean;
  device_online: boolean;
  low_battery: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  // Escalation settings
  escalation_preset: EscalationPreset;
  custom_escalation: CustomEscalation | null;
  critical_override_dnd: boolean;
  dnd_override_acknowledged: boolean;
}

// Escalation types
export type EscalationPreset = 'relaxed' | 'normal' | 'aggressive' | 'custom';

export interface CustomEscalation {
  level2: number; // minutes
  level3: number;
  level4: number;
  level5: number;
}

export interface EscalationPresetConfig {
  id: EscalationPreset;
  name: string;
  description: string;
  timing: {
    level2: number; // minutes
    level3: number;
    level4: number;
    level5: number;
  };
}

// Emergency contact types
export type EmergencyContactType = 'app_user' | 'sms' | 'email';

export interface EmergencyContact {
  id: string;
  user_id: string;
  contact_type: EmergencyContactType;
  contact_value: string;
  contact_name: string | null;
  escalation_level: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEmergencyContact {
  contact_type: EmergencyContactType;
  contact_value: string;
  contact_name?: string;
  escalation_level?: number;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
