import axios, { AxiosInstance, AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiResponse, User, Device, Alert, NotificationPreferences, EscalationPresetConfig, EmergencyContact, CreateEmergencyContact, EscalationPreset, CustomEscalation } from '../types';

// Configure base URL - change this for production
const API_BASE_URL = __DEV__
  ? 'http://192.168.133.110:4000/api'  // Local dev server
  : 'https://your-production-server.com/api';

class ApiService {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      async (config) => {
        if (!this.token) {
          this.token = await AsyncStorage.getItem('authToken');
        }
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Token expired, clear auth
          await this.logout();
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string | null) {
    this.token = token;
  }

  // Auth endpoints
  async login(email: string, password: string): Promise<ApiResponse<{ token: string; user: User }>> {
    try {
      const response = await this.client.post('/auth/login', { email, password });
      // Server returns { data: { accessToken, user } }
      const token = response.data.data?.accessToken || response.data.accessToken;
      const userData = response.data.data?.user || response.data.user;

      if (token) {
        this.token = token;
        await AsyncStorage.setItem('authToken', token);
      }

      // Map server user format to our User type
      const user: User = {
        id: userData.id,
        email: userData.email,
        name: userData.name || userData.email.split('@')[0],
        role: userData.tenants?.[0]?.role || 'user',
        tenantId: userData.tenants?.[0]?.tenant_id || '',
        tenantName: userData.tenants?.[0]?.tenant_name || '',
      };

      return { success: true, data: { token, user } };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Login failed'
      };
    }
  }

  async logout(): Promise<void> {
    this.token = null;
    await AsyncStorage.removeItem('authToken');
  }

  async getProfile(): Promise<ApiResponse<User>> {
    try {
      const response = await this.client.get('/auth/profile');
      return { success: true, data: response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to get profile'
      };
    }
  }

  // Device endpoints
  async getDevices(): Promise<ApiResponse<Device[]>> {
    try {
      const response = await this.client.get('/devices');
      // Server returns { data: { items: [...] } }
      const items = response.data.data?.items || response.data.items || response.data.devices || [];

      // Map server device format to our Device type
      const devices: Device[] = items.map((d: any) => ({
        id: d.id,
        name: d.name,
        mac_address: d.macAddress || d.deviceId,
        tenant_id: d.tenantId,
        status: d.status || 'unknown',
        battery_level: d.batteryLevel ?? null,
        firmware_version: d.firmwareVersion ?? null,
        last_seen_at: d.lastSeen ?? null,
        created_at: d.createdAt,
        location: d.location,
        trap_state: d.trapState || 'unknown',
      }));

      return { success: true, data: devices };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to get devices'
      };
    }
  }

  async getDevice(id: string): Promise<ApiResponse<Device>> {
    try {
      const response = await this.client.get(`/devices/${id}`);
      // Server returns { data: {...} }
      const d = response.data.data || response.data;

      // Map server device format to our Device type
      const device: Device = {
        id: d.id,
        name: d.name,
        mac_address: d.macAddress || d.deviceId,
        tenant_id: d.tenantId,
        status: d.status || 'unknown',
        battery_level: d.batteryLevel ?? null,
        firmware_version: d.firmwareVersion ?? null,
        last_seen_at: d.lastSeen ?? null,
        created_at: d.createdAt,
        location: d.location,
        trap_state: d.trapState || 'unknown',
        uptime: d.uptime ?? null,
        rssi: d.signalStrength ?? null,
        ip_address: d.ipAddress ?? null,
        last_snapshot: d.lastSnapshot ?? null,
        last_snapshot_timestamp: d.lastSnapshotTimestamp ? Number(d.lastSnapshotTimestamp) : null,
        timezone: d.timezone ?? null,
      };

      return { success: true, data: device };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to get device'
      };
    }
  }

  async requestSnapshot(deviceId: string): Promise<ApiResponse<{ message: string }>> {
    try {
      const response = await this.client.post(`/devices/${deviceId}/request-snapshot`);
      return {
        success: true,
        data: { message: response.data.message || 'Snapshot request sent' }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to request snapshot'
      };
    }
  }

  async clearAlerts(deviceId: string): Promise<ApiResponse<{ message: string; clearedCount: number }>> {
    try {
      const response = await this.client.post(`/devices/${deviceId}/clear-alerts`);
      return {
        success: true,
        data: response.data.data || { message: 'Alerts cleared', clearedCount: 0 }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to clear alerts'
      };
    }
  }

  async triggerTestAlert(deviceId: string): Promise<ApiResponse<{ alertId: string; message: string; deviceName: string }>> {
    try {
      const response = await this.client.post(`/devices/${deviceId}/test-alert`);
      return {
        success: true,
        data: response.data.data || { alertId: '', message: 'Test alert created', deviceName: '' }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to trigger test alert'
      };
    }
  }

  // Alert endpoints
  async getAlerts(filters?: { resolved?: boolean; deviceId?: string }): Promise<ApiResponse<Alert[]>> {
    try {
      const params = new URLSearchParams();
      if (filters?.resolved !== undefined) params.append('isResolved', String(filters.resolved));
      if (filters?.deviceId) params.append('deviceId', filters.deviceId);

      const response = await this.client.get(`/alerts?${params.toString()}`);
      // Server returns { data: { items: [...] } }
      const items = response.data.data?.items || response.data.items || [];

      // Map server alert format to our Alert type
      const alerts: Alert[] = items.map((a: any) => ({
        id: a.id,
        device_id: a.deviceId,
        device_name: a.label || a.macAddress || 'Unknown Device',
        tenant_id: a.tenantId,
        alert_type: a.type,
        severity: a.severity,
        message: a.message,
        acknowledged: a.isAcknowledged,
        acknowledged_at: a.acknowledgedAt,
        resolved_at: a.resolvedAt,
        created_at: a.createdAt,
      }));

      return { success: true, data: alerts };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to get alerts'
      };
    }
  }

  async acknowledgeAlert(alertId: string): Promise<ApiResponse<Alert>> {
    try {
      const response = await this.client.post(`/alerts/${alertId}/acknowledge`);
      return { success: true, data: response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to acknowledge alert'
      };
    }
  }

  async resolveAlert(alertId: string, notes?: string): Promise<ApiResponse<Alert>> {
    try {
      const response = await this.client.post(`/alerts/${alertId}/resolve`, { notes });
      return { success: true, data: response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to resolve alert'
      };
    }
  }

  // Push notification endpoints
  async registerPushToken(token: string, platform: 'ios' | 'android' | 'web', deviceName?: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post('/push/register-token', { token, platform, deviceName });
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to register push token'
      };
    }
  }

  async removePushToken(token: string): Promise<ApiResponse<void>> {
    try {
      await this.client.delete('/push/token', { data: { token } });
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to remove push token'
      };
    }
  }

  async getNotificationPreferences(): Promise<ApiResponse<NotificationPreferences>> {
    try {
      const response = await this.client.get('/push/preferences');
      return { success: true, data: response.data.preferences };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to get preferences'
      };
    }
  }

  async updateNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<ApiResponse<void>> {
    try {
      await this.client.put('/push/preferences', preferences);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to update preferences'
      };
    }
  }

  async sendTestNotification(): Promise<ApiResponse<{ sent: number; failed: number }>> {
    try {
      const response = await this.client.post('/push/test');
      return { success: true, data: response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to send test notification'
      };
    }
  }

  // Escalation endpoints
  async getEscalationPresets(): Promise<ApiResponse<EscalationPresetConfig[]>> {
    try {
      const response = await this.client.get('/push/escalation/presets');
      return { success: true, data: response.data.presets || response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to get escalation presets'
      };
    }
  }

  async getEscalationSettings(): Promise<ApiResponse<{ preset: EscalationPreset; customTiming: CustomEscalation | null; criticalOverrideDnd: boolean; dndOverrideAcknowledged: boolean }>> {
    try {
      const response = await this.client.get('/push/escalation/settings');
      return { success: true, data: response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to get escalation settings'
      };
    }
  }

  async updateEscalationSettings(settings: { preset?: EscalationPreset; customTiming?: CustomEscalation; criticalOverrideDnd?: boolean; dndOverrideAcknowledged?: boolean }): Promise<ApiResponse<void>> {
    try {
      await this.client.put('/push/escalation/settings', settings);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to update escalation settings'
      };
    }
  }

  // Emergency contacts endpoints
  async getEmergencyContacts(): Promise<ApiResponse<EmergencyContact[]>> {
    try {
      const response = await this.client.get('/push/emergency-contacts');
      return { success: true, data: response.data.contacts || response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to get emergency contacts'
      };
    }
  }

  async addEmergencyContact(contact: CreateEmergencyContact): Promise<ApiResponse<EmergencyContact>> {
    try {
      const response = await this.client.post('/push/emergency-contacts', contact);
      return { success: true, data: response.data.contact || response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to add emergency contact'
      };
    }
  }

  async updateEmergencyContact(id: string, updates: Partial<CreateEmergencyContact> & { enabled?: boolean }): Promise<ApiResponse<EmergencyContact>> {
    try {
      const response = await this.client.put(`/push/emergency-contacts/${id}`, updates);
      return { success: true, data: response.data.contact || response.data };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to update emergency contact'
      };
    }
  }

  async deleteEmergencyContact(id: string): Promise<ApiResponse<void>> {
    try {
      await this.client.delete(`/push/emergency-contacts/${id}`);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to delete emergency contact'
      };
    }
  }
}

export const api = new ApiService();
