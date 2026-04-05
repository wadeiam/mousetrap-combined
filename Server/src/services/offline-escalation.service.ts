/**
 * Offline Escalation Service
 *
 * Tracks device offline status and escalates alerts:
 * - 0 min: Push notification (immediate, medium severity)
 * - 15 min: Push (with sound) + SMS (high severity)
 * - 30 min: Push (with sound) + SMS with URGENT prefix (critical)
 * - 60 min: Push + SMS with CRITICAL prefix, repeats hourly
 *
 * CRITICAL: This is essential for animal welfare - trapped mice must not
 * be left unattended in offline traps.
 */

import { Pool } from 'pg';
import { getPushService } from './push.service';
import { getSmsService } from './sms.service';
import { logger } from './logger.service';

interface OfflineDevice {
  deviceId: string;
  deviceName: string;
  tenantId: string;
  offlineSince: Date;
  lastEscalationLevel: number;
  lastNotificationAt: Date;
}

// Escalation levels in minutes
// TODO: Restore production values after testing:
// minutes: 0, 15, 30, 60
const ESCALATION_LEVELS = [
  { minutes: 0,  level: 1, actions: ['push'],        prefix: '',                severity: 'medium' as const },
  { minutes: 1,  level: 2, actions: ['push', 'sms'], prefix: '',                severity: 'high' as const },
  { minutes: 2,  level: 3, actions: ['push', 'sms'], prefix: 'URGENT: ',        severity: 'critical' as const },
  { minutes: 3,  level: 4, actions: ['push', 'sms'], prefix: 'CRITICAL: ',      severity: 'critical' as const },
];

class OfflineEscalationService {
  private db: Pool;
  private offlineDevices: Map<string, OfflineDevice> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Start the escalation service
   */
  start(): void {
    // Check every minute for escalation needs
    this.checkInterval = setInterval(() => this.checkEscalations(), 60 * 1000);
    logger.info('[OFFLINE-ESCALATION] Service started');
    console.log('[OFFLINE-ESCALATION] Service started - checking every minute');
  }

  /**
   * Stop the escalation service
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check if a device has offline alerts muted
   */
  private async isDeviceMuted(deviceId: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        `SELECT mute_offline_permanently, mute_offline_until
         FROM devices WHERE id = $1`,
        [deviceId]
      );
      if (result.rows.length === 0) return false;

      const { mute_offline_permanently, mute_offline_until } = result.rows[0];

      // Permanently muted
      if (mute_offline_permanently) return true;

      // Temporarily muted (check if still active)
      if (mute_offline_until && new Date(mute_offline_until) > new Date()) {
        return true;
      }

      return false;
    } catch (error: any) {
      logger.error('[OFFLINE-ESCALATION] Error checking mute status', { error: error?.message });
      return false;
    }
  }

  /**
   * Record a device going offline
   */
  async deviceOffline(tenantId: string, deviceId: string, deviceName: string): Promise<void> {
    const key = `${tenantId}:${deviceId}`;

    if (this.offlineDevices.has(key)) {
      return; // Already tracking
    }

    // Check if device is muted
    const isMuted = await this.isDeviceMuted(deviceId);
    if (isMuted) {
      logger.info('[OFFLINE-ESCALATION] Device offline alerts muted, skipping', { deviceName, deviceId });
      return;
    }

    const device: OfflineDevice = {
      deviceId,
      deviceName,
      tenantId,
      offlineSince: new Date(),
      lastEscalationLevel: 0,
      lastNotificationAt: new Date(),
    };

    this.offlineDevices.set(key, device);
    logger.info('[OFFLINE-ESCALATION] Tracking offline device', { deviceName, tenantId });

    // Send immediate push notification (level 1)
    await this.sendPushNotification(device, '', 'medium', 0);
    device.lastEscalationLevel = 1;
    device.lastNotificationAt = new Date();
  }

  /**
   * Record a device coming back online
   */
  deviceOnline(tenantId: string, deviceId: string): void {
    const key = `${tenantId}:${deviceId}`;
    const device = this.offlineDevices.get(key);

    if (device) {
      const offlineMinutes = Math.round((Date.now() - device.offlineSince.getTime()) / 60000);
      logger.info('[OFFLINE-ESCALATION] Device back online', {
        deviceName: device.deviceName,
        offlineMinutes,
      });
      this.offlineDevices.delete(key);
    }
  }

  /**
   * Check all offline devices for escalation needs
   */
  private async checkEscalations(): Promise<void> {
    const now = Date.now();

    for (const [key, device] of this.offlineDevices) {
      const offlineMinutes = (now - device.offlineSince.getTime()) / 60000;

      // Find the appropriate escalation level
      let targetLevel = ESCALATION_LEVELS[0];
      for (const level of ESCALATION_LEVELS) {
        if (offlineMinutes >= level.minutes) {
          targetLevel = level;
        }
      }

      // Check if we need to escalate
      if (targetLevel.level > device.lastEscalationLevel) {
        await this.escalate(device, targetLevel);
        device.lastEscalationLevel = targetLevel.level;
        device.lastNotificationAt = new Date();
      }
      // For level 4+, resend every hour
      else if (device.lastEscalationLevel >= 4) {
        const minutesSinceLastNotification = (now - device.lastNotificationAt.getTime()) / 60000;
        if (minutesSinceLastNotification >= 60) {
          await this.escalate(device, targetLevel);
          device.lastNotificationAt = new Date();
        }
      }
    }
  }

  /**
   * Escalate notification for a device
   */
  private async escalate(device: OfflineDevice, level: typeof ESCALATION_LEVELS[0]): Promise<void> {
    const offlineMinutes = Math.round((Date.now() - device.offlineSince.getTime()) / 60000);

    logger.warn('[OFFLINE-ESCALATION] Escalating', {
      deviceName: device.deviceName,
      level: level.level,
      offlineMinutes,
      actions: level.actions,
    });

    console.log(`[OFFLINE-ESCALATION] Level ${level.level}: ${device.deviceName} offline for ${offlineMinutes} min`);

    for (const action of level.actions) {
      if (action === 'push') {
        await this.sendPushNotification(device, level.prefix, level.severity, offlineMinutes);
      } else if (action === 'sms') {
        await this.sendSmsToEmergencyContacts(device, level.prefix, offlineMinutes);
      }
    }
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(
    device: OfflineDevice,
    prefix: string,
    severity: string,
    offlineMinutes: number
  ): Promise<void> {
    const pushService = getPushService();
    if (!pushService) return;

    const message = offlineMinutes > 0
      ? `${prefix}${device.deviceName} has been offline for ${offlineMinutes} minutes`
      : `${prefix}${device.deviceName} has gone offline`;

    try {
      await pushService.handleAlertNotification({
        alertId: `offline-${device.deviceId}-${Date.now()}`,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        alertType: 'offline',
        severity,
        tenantId: device.tenantId,
        message,
      });
    } catch (error: any) {
      logger.error('[OFFLINE-ESCALATION] Push notification failed', { error: error?.message });
    }
  }

  /**
   * Send SMS to all emergency contacts for the tenant
   */
  private async sendSmsToEmergencyContacts(
    device: OfflineDevice,
    prefix: string,
    offlineMinutes: number
  ): Promise<void> {
    const smsService = getSmsService();
    if (!smsService || !smsService.isEnabled()) {
      logger.warn('[OFFLINE-ESCALATION] SMS service not available');
      return;
    }

    try {
      // Get emergency contacts with SMS for users in this tenant
      const result = await this.db.query(
        `SELECT DISTINCT ec.contact_value
         FROM emergency_contacts ec
         JOIN users u ON u.id = ec.user_id
         WHERE u.tenant_id = $1 AND ec.contact_type = 'sms' AND ec.enabled = true`,
        [device.tenantId]
      );

      const message = `${prefix}${device.deviceName} has been OFFLINE for ${offlineMinutes} minutes. ` +
        `If a mouse is trapped, it may be in distress. Please check immediately!`;

      for (const row of result.rows) {
        try {
          await smsService.send(row.contact_value, message);
          logger.info('[OFFLINE-ESCALATION] SMS sent', {
            deviceName: device.deviceName,
            phone: row.contact_value.slice(-4),
          });
        } catch (smsError: any) {
          logger.error('[OFFLINE-ESCALATION] SMS send failed', { error: smsError?.message });
        }
      }
    } catch (error: any) {
      logger.error('[OFFLINE-ESCALATION] Failed to get emergency contacts', { error: error?.message });
    }
  }

  /**
   * Get current offline devices (for debugging/status)
   */
  getOfflineDevices(): OfflineDevice[] {
    return Array.from(this.offlineDevices.values());
  }
}

let escalationService: OfflineEscalationService | null = null;

export function initOfflineEscalationService(db: Pool): OfflineEscalationService {
  escalationService = new OfflineEscalationService(db);
  escalationService.start();
  return escalationService;
}

export function getOfflineEscalationService(): OfflineEscalationService | null {
  return escalationService;
}
