/**
 * Escalation Service
 *
 * Manages alert escalation based on time elapsed since trigger.
 * Escalation levels increase notification frequency, sound intensity,
 * and contact escalation to ensure humane response times for trapped mice.
 *
 * Timeline (default "normal" preset):
 * - Level 1 (0-1h): Single notification, standard sound
 * - Level 2 (1-2h): Repeat every 30 min, louder sound
 * - Level 3 (2-4h): Repeat every 15 min, device buzzer starts
 * - Level 4 (4-8h): Repeat every 10 min, override DND, escalate contacts
 * - Level 5 (8h+): Repeat every 5 min, all escalation methods
 */

import { Pool } from 'pg';
import { logger } from './logger.service';
import { getPushService, PushNotification, NotificationType } from './push.service';
import { getMqttService } from './mqtt.service';
import { getSmsService } from './sms.service';
import { getEmailService } from './email.service';

// Escalation level definitions
export const ESCALATION_LEVELS = {
  NORMAL: 1,
  ELEVATED: 2,
  HIGH: 3,
  CRITICAL: 4,
  EMERGENCY: 5,
} as const;

// Preset timing thresholds (in minutes)
export const ESCALATION_PRESETS = {
  relaxed: {
    level2: 120,   // 2 hours
    level3: 240,   // 4 hours
    level4: 480,   // 8 hours
    level5: 720,   // 12 hours
  },
  normal: {
    level2: 60,    // 1 hour
    level3: 120,   // 2 hours
    level4: 240,   // 4 hours
    level5: 480,   // 8 hours
  },
  aggressive: {
    level2: 30,    // 30 minutes
    level3: 60,    // 1 hour
    level4: 120,   // 2 hours
    level5: 240,   // 4 hours
  },
} as const;

// Notification intervals per level (in minutes)
const NOTIFICATION_INTERVALS = {
  1: null,  // Single notification only
  2: 30,    // Every 30 minutes
  3: 15,    // Every 15 minutes
  4: 10,    // Every 10 minutes
  5: 5,     // Every 5 minutes
};

// Sound/priority configuration per level
const LEVEL_NOTIFICATION_CONFIG = {
  1: { sound: 'default' as const, priority: 'default' as const, channelId: 'mousetrap_normal' },
  2: { sound: 'default' as const, priority: 'high' as const, channelId: 'mousetrap_normal' },
  3: { sound: 'default' as const, priority: 'high' as const, channelId: 'mousetrap_high' },
  4: { sound: 'default' as const, priority: 'high' as const, channelId: 'mousetrap_critical' },
  5: { sound: 'default' as const, priority: 'high' as const, channelId: 'mousetrap_critical' },
};

interface Alert {
  id: string;  // UUID
  tenant_id: string;
  device_id: string;
  mac_address: string;
  alert_type: string;
  status: string;  // 'new', 'acknowledged', 'resolved'
  severity: string;
  message: string | null;
  triggered_at: Date;
  device_name?: string;
}

interface EscalationState {
  alert_id: string;  // UUID
  current_level: number;
  last_notification_at: Date | null;
  next_notification_at: Date | null;
  notification_count: number;
  contacts_notified: Array<{ contact_id: string; level: number; notified_at: string }>;
  dnd_overridden: boolean;
}

interface UserPreferences {
  user_id: string;
  escalation_preset: string;
  custom_escalation: { level2?: number; level3?: number; level4?: number; level5?: number } | null;
  critical_override_dnd: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

interface EmergencyContact {
  id: string;
  user_id: string;
  contact_type: 'app_user' | 'sms' | 'email';
  contact_value: string;
  contact_name: string | null;
  escalation_level: number;
  enabled: boolean;
}

export class EscalationService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
    logger.info('[ESCALATION] Escalation service initialized');
  }

  /**
   * Calculate escalation level based on time elapsed and preset
   */
  getEscalationLevel(triggeredAt: Date, preset: string = 'normal', customTiming?: UserPreferences['custom_escalation']): number {
    const elapsedMinutes = (Date.now() - triggeredAt.getTime()) / (1000 * 60);

    // Use custom timing if preset is 'custom' and custom values provided
    const thresholds = preset === 'custom' && customTiming
      ? {
          level2: customTiming.level2 ?? ESCALATION_PRESETS.normal.level2,
          level3: customTiming.level3 ?? ESCALATION_PRESETS.normal.level3,
          level4: customTiming.level4 ?? ESCALATION_PRESETS.normal.level4,
          level5: customTiming.level5 ?? ESCALATION_PRESETS.normal.level5,
        }
      : ESCALATION_PRESETS[preset as keyof typeof ESCALATION_PRESETS] || ESCALATION_PRESETS.normal;

    if (elapsedMinutes >= thresholds.level5) return ESCALATION_LEVELS.EMERGENCY;
    if (elapsedMinutes >= thresholds.level4) return ESCALATION_LEVELS.CRITICAL;
    if (elapsedMinutes >= thresholds.level3) return ESCALATION_LEVELS.HIGH;
    if (elapsedMinutes >= thresholds.level2) return ESCALATION_LEVELS.ELEVATED;
    return ESCALATION_LEVELS.NORMAL;
  }

  /**
   * Get next notification time based on current level
   */
  getNextNotificationTime(level: number): Date | null {
    const intervalMinutes = NOTIFICATION_INTERVALS[level as keyof typeof NOTIFICATION_INTERVALS];
    if (!intervalMinutes) return null;

    return new Date(Date.now() + intervalMinutes * 60 * 1000);
  }

  /**
   * Process unacknowledged alerts that need notification
   * Optimized for scale: only queries alerts that actually need processing
   * This should be called by a cron job every minute
   */
  async processEscalations(): Promise<{ processed: number; notified: number }> {
    let processed = 0;
    let notified = 0;

    try {
      // Get only alerts that need processing:
      // 1. New/active alerts with no escalation state (new alerts)
      // 2. Alerts where next_notification_at has passed
      // Limited to 100 per batch for scalability
      // Note: The alerts table uses 'new' status for active alerts, and the
      // device_alerts view maps 'new' to 'active'. We query the alerts table directly.
      const alertsResult = await this.db.query<Alert>(`
        SELECT
          a.id, a.tenant_id, a.device_id, a.status,
          a.severity, a.triggered_at,
          d.name as device_name, d.mac_address,
          COALESCE(a.sensor_data->>'alert_type', 'trap_triggered') as alert_type,
          COALESCE(a.sensor_data->>'message', 'Trap triggered') as message
        FROM alerts a
        LEFT JOIN devices d ON d.id = a.device_id
        LEFT JOIN alert_escalation_state es ON es.alert_id = a.id
        WHERE a.status = 'new'
          AND (
            es.alert_id IS NULL  -- New alerts without escalation state
            OR es.next_notification_at <= NOW()  -- Alerts due for notification
          )
        ORDER BY a.triggered_at ASC
        LIMIT 100
      `);

      for (const alert of alertsResult.rows) {
        processed++;

        // Get or create escalation state for this alert
        let state = await this.getEscalationState(alert.id);
        if (!state) {
          state = await this.createEscalationState(alert.id);
        }

        // Get the tenant's users and their preferences
        const usersResult = await this.db.query<{ user_id: string }>(`
          SELECT DISTINCT utm.user_id
          FROM user_tenant_memberships utm
          WHERE utm.tenant_id = $1
        `, [alert.tenant_id]);

        if (usersResult.rows.length === 0) continue;

        // Use the first user's preferences for escalation timing
        // In practice, you might want to use the most aggressive setting across all users
        const prefs = await this.getUserPreferences(usersResult.rows[0].user_id);

        // Calculate current escalation level
        const newLevel = this.getEscalationLevel(
          alert.triggered_at,
          prefs.escalation_preset,
          prefs.custom_escalation
        );

        // Check if level increased
        const levelIncreased = newLevel > state.current_level;

        // Check if it's time to send another notification
        const shouldNotify = levelIncreased ||
          (state.next_notification_at && new Date(state.next_notification_at) <= new Date());

        if (shouldNotify) {
          // Send notifications
          const sent = await this.sendEscalatedNotification(alert, newLevel, state, prefs);
          if (sent > 0) notified++;

          // Update escalation state
          await this.updateEscalationState(alert.id, {
            current_level: newLevel,
            last_notification_at: new Date(),
            next_notification_at: this.getNextNotificationTime(newLevel),
            notification_count: state.notification_count + 1,
            dnd_overridden: newLevel >= ESCALATION_LEVELS.CRITICAL && prefs.critical_override_dnd,
          });

          // Send MQTT command to device for buzzer/LED escalation
          await this.sendDeviceEscalationCommand(alert, newLevel);

          // At Level 4+, notify emergency contacts
          if (newLevel >= ESCALATION_LEVELS.CRITICAL) {
            await this.notifyEmergencyContacts(alert, newLevel, state);
          }
        }
      }

      if (processed > 0) {
        logger.info('[ESCALATION] Processing complete', { processed, notified });
      }
    } catch (error: any) {
      logger.error('[ESCALATION] Error processing escalations', { error: error.message });
    }

    return { processed, notified };
  }

  /**
   * Get escalation state for an alert
   */
  private async getEscalationState(alertId: string): Promise<EscalationState | null> {
    const result = await this.db.query<EscalationState>(
      'SELECT * FROM alert_escalation_state WHERE alert_id = $1',
      [alertId]
    );
    return result.rows[0] || null;
  }

  /**
   * Create initial escalation state for an alert
   */
  private async createEscalationState(alertId: string): Promise<EscalationState> {
    const result = await this.db.query<EscalationState>(
      `INSERT INTO alert_escalation_state (alert_id, current_level, next_notification_at)
       VALUES ($1, 1, $2)
       RETURNING *`,
      [alertId, this.getNextNotificationTime(1)]
    );
    return result.rows[0];
  }

  /**
   * Update escalation state
   */
  private async updateEscalationState(alertId: string, updates: Partial<EscalationState>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (fields.length === 0) return;

    values.push(alertId);
    await this.db.query(
      `UPDATE alert_escalation_state SET ${fields.join(', ')} WHERE alert_id = $${paramIndex}`,
      values
    );
  }

  /**
   * Get user's notification preferences including escalation settings
   */
  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    const result = await this.db.query<UserPreferences>(
      `SELECT user_id, escalation_preset, custom_escalation, critical_override_dnd,
              quiet_hours_enabled, quiet_hours_start::text, quiet_hours_end::text
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return {
        user_id: userId,
        escalation_preset: 'normal',
        custom_escalation: null,
        critical_override_dnd: true,
        quiet_hours_enabled: false,
        quiet_hours_start: null,
        quiet_hours_end: null,
      };
    }

    return result.rows[0];
  }

  /**
   * Send notification with level-appropriate urgency
   */
  private async sendEscalatedNotification(
    alert: Alert,
    level: number,
    state: EscalationState,
    prefs: UserPreferences
  ): Promise<number> {
    const pushService = getPushService();
    if (!pushService) {
      logger.warn('[ESCALATION] Push service not available');
      return 0;
    }

    const config = LEVEL_NOTIFICATION_CONFIG[level as keyof typeof LEVEL_NOTIFICATION_CONFIG];
    const deviceName = alert.device_name || alert.mac_address;

    // Build urgency prefix based on level
    const levelPrefix = {
      1: '🪤',
      2: '⚠️🪤',
      3: '🚨🪤',
      4: '‼️🚨🪤',
      5: '🆘‼️🚨🪤',
    }[level] || '🪤';

    const notification: PushNotification = {
      title: `${levelPrefix} ${deviceName}: Trap Triggered!`,
      body: this.getEscalatedBody(alert, level, state.notification_count),
      data: {
        type: 'alert',
        alertId: String(alert.id),
        deviceId: alert.device_id || '',
        alertType: alert.alert_type,
        severity: alert.severity,
        escalationLevel: level,
      },
      sound: config.sound,
      priority: config.priority,
      categoryId: config.channelId,
    };

    // Get all users in tenant
    const usersResult = await this.db.query<{ user_id: string }>(
      `SELECT DISTINCT utm.user_id
       FROM user_tenant_memberships utm
       WHERE utm.tenant_id = $1`,
      [alert.tenant_id]
    );

    let totalSent = 0;
    for (const user of usersResult.rows) {
      // Check if we should override DND at this level
      const userPrefs = await this.getUserPreferences(user.user_id);
      const shouldOverrideDnd = level >= ESCALATION_LEVELS.CRITICAL && userPrefs.critical_override_dnd;

      const result = await pushService.sendToUser(
        user.user_id,
        notification,
        'trap_alert',
        shouldOverrideDnd  // Skip preference check if overriding DND
      );

      totalSent += result.sent;

      // Log with escalation level
      if (result.sent > 0) {
        await this.logEscalatedNotification(user.user_id, alert.id, level, 'push');
      }
    }

    return totalSent;
  }

  /**
   * Get notification body based on level
   */
  private getEscalatedBody(alert: Alert, level: number, notificationCount: number): string {
    const deviceName = alert.device_name || alert.mac_address;
    const elapsedMinutes = Math.floor((Date.now() - alert.triggered_at.getTime()) / (1000 * 60));
    const elapsedText = elapsedMinutes < 60
      ? `${elapsedMinutes} min`
      : `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`;

    switch (level) {
      case 1:
        return `The trap at ${deviceName} has been triggered. Check it now!`;
      case 2:
        return `Trap triggered ${elapsedText} ago. Please check ${deviceName}.`;
      case 3:
        return `URGENT: Trap at ${deviceName} triggered ${elapsedText} ago. Immediate attention needed!`;
      case 4:
        return `CRITICAL: Mouse at ${deviceName} for ${elapsedText}! Welfare at risk. Act now!`;
      case 5:
        return `EMERGENCY: Mouse trapped ${elapsedText}! Check ${deviceName} IMMEDIATELY!`;
      default:
        return alert.message || `Alert from ${deviceName}`;
    }
  }

  /**
   * Send MQTT command to device for buzzer/LED escalation
   */
  private async sendDeviceEscalationCommand(alert: Alert, level: number): Promise<void> {
    const mqttService = getMqttService();
    if (!mqttService) {
      logger.warn('[ESCALATION] MQTT service not available');
      return;
    }

    // Buzzer patterns per level
    const buzzerConfig = {
      1: { buzzer: false, led: 'solid_red' },
      2: { buzzer: true, buzzerPattern: 'single', led: 'slow_blink' },
      3: { buzzer: true, buzzerPattern: 'triple', led: 'fast_blink' },
      4: { buzzer: true, buzzerPattern: 'continuous_short', led: 'rapid_blink' },
      5: { buzzer: true, buzzerPattern: 'continuous', led: 'rapid_flash' },
    }[level] || { buzzer: false, led: 'off' };

    try {
      await mqttService.publishDeviceCommand(alert.tenant_id, alert.mac_address, {
        command: 'escalation',
        level,
        ...buzzerConfig,
        timestamp: Date.now(),
      });
      logger.debug('[ESCALATION] Sent device command', { mac: alert.mac_address, level });
    } catch (error: any) {
      logger.error('[ESCALATION] Failed to send device command', { error: error.message });
    }
  }

  /**
   * Notify emergency contacts at Level 4+
   */
  private async notifyEmergencyContacts(
    alert: Alert,
    level: number,
    state: EscalationState
  ): Promise<void> {
    // Get the alert owner's emergency contacts
    const usersResult = await this.db.query<{ user_id: string }>(
      `SELECT DISTINCT utm.user_id
       FROM user_tenant_memberships utm
       WHERE utm.tenant_id = $1`,
      [alert.tenant_id]
    );

    for (const user of usersResult.rows) {
      const contactsResult = await this.db.query<EmergencyContact>(
        `SELECT * FROM emergency_contacts
         WHERE user_id = $1 AND enabled = true AND escalation_level <= $2`,
        [user.user_id, level]
      );

      for (const contact of contactsResult.rows) {
        // Check if already notified at this level
        const alreadyNotified = state.contacts_notified.some(
          (c) => c.contact_id === contact.id && c.level >= level
        );
        if (alreadyNotified) continue;

        // Send notification based on contact type
        let success = false;
        switch (contact.contact_type) {
          case 'app_user':
            success = await this.notifyAppUser(contact, alert, level);
            break;
          case 'sms':
            success = await this.sendSmsAlert(contact, alert, level);
            break;
          case 'email':
            success = await this.sendEmailAlert(contact, alert, level);
            break;
        }

        if (success) {
          // Update contacts_notified
          const updatedContacts = [
            ...state.contacts_notified,
            { contact_id: contact.id, level, notified_at: new Date().toISOString() },
          ];
          await this.db.query(
            `UPDATE alert_escalation_state SET contacts_notified = $1 WHERE alert_id = $2`,
            [JSON.stringify(updatedContacts), alert.id]
          );
          state.contacts_notified = updatedContacts;

          await this.logEscalatedNotification(user.user_id, alert.id, level, contact.contact_type);
        }
      }
    }
  }

  /**
   * Notify another app user
   */
  private async notifyAppUser(contact: EmergencyContact, alert: Alert, level: number): Promise<boolean> {
    const pushService = getPushService();
    if (!pushService) return false;

    const deviceName = alert.device_name || alert.mac_address;
    const notification: PushNotification = {
      title: `🆘 Emergency Alert - ${deviceName}`,
      body: `You've been contacted as an emergency contact. A mouse has been trapped for over ${Math.floor((Date.now() - alert.triggered_at.getTime()) / (1000 * 60 * 60))} hours. Please help!`,
      data: {
        type: 'emergency_contact_alert',
        alertId: String(alert.id),
        escalationLevel: level,
      },
      sound: 'default',
      priority: 'high',
    };

    const result = await pushService.sendToUser(contact.contact_value, notification, 'trap_alert', true);
    return result.sent > 0;
  }

  /**
   * Send SMS alert via Twilio
   */
  private async sendSmsAlert(contact: EmergencyContact, alert: Alert, level: number): Promise<boolean> {
    const smsService = getSmsService();
    if (!smsService || !smsService.isEnabled()) {
      logger.warn('[ESCALATION] SMS service not configured, skipping SMS alert', {
        phone: contact.contact_value,
        alertId: alert.id,
      });
      return false;
    }

    const deviceName = alert.device_name || alert.mac_address;
    const elapsedMinutes = Math.floor((Date.now() - alert.triggered_at.getTime()) / (1000 * 60));

    try {
      const result = await smsService.sendTrapAlert(
        contact.contact_value,
        deviceName,
        elapsedMinutes,
        level,
        contact.contact_name || undefined
      );

      if (result.success) {
        logger.info('[ESCALATION] SMS alert sent successfully', {
          phone: contact.contact_value,
          alertId: alert.id,
          level,
          messageId: result.messageId,
        });
        return true;
      } else {
        logger.warn('[ESCALATION] SMS alert failed', {
          phone: contact.contact_value,
          alertId: alert.id,
          error: result.error,
        });
        return false;
      }
    } catch (error: any) {
      logger.error('[ESCALATION] SMS alert error', {
        phone: contact.contact_value,
        alertId: alert.id,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Send email alert via Nodemailer/SMTP
   */
  private async sendEmailAlert(contact: EmergencyContact, alert: Alert, level: number): Promise<boolean> {
    const emailService = getEmailService();
    if (!emailService || !emailService.isEnabled()) {
      logger.warn('[ESCALATION] Email service not configured, skipping email alert', {
        email: contact.contact_value,
        alertId: alert.id,
      });
      return false;
    }

    const deviceName = alert.device_name || alert.mac_address;
    const elapsedMinutes = Math.floor((Date.now() - alert.triggered_at.getTime()) / (1000 * 60));

    try {
      const result = await emailService.sendTrapAlert(
        contact.contact_value,
        deviceName,
        elapsedMinutes,
        level,
        contact.contact_name || undefined
      );

      if (result.success) {
        logger.info('[ESCALATION] Email alert sent successfully', {
          email: contact.contact_value,
          alertId: alert.id,
          level,
          messageId: result.messageId,
        });
        return true;
      } else {
        logger.warn('[ESCALATION] Email alert failed', {
          email: contact.contact_value,
          alertId: alert.id,
          error: result.error,
        });
        return false;
      }
    } catch (error: any) {
      logger.error('[ESCALATION] Email alert error', {
        email: contact.contact_value,
        alertId: alert.id,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Log escalated notification for analytics
   */
  private async logEscalatedNotification(
    userId: string,
    alertId: string,
    level: number,
    contactType: string
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO notification_log
         (user_id, notification_type, title, body, data, status, escalation_level, contact_type)
         VALUES ($1, 'trap_alert', 'Escalated Alert', 'Level ' || $2, $3, 'sent', $2, $4)`,
        [userId, level, JSON.stringify({ alertId }), contactType]
      );
    } catch (error: any) {
      logger.error('[ESCALATION] Failed to log notification', { error: error.message });
    }
  }

  /**
   * Acknowledge an alert and stop escalation
   */
  async acknowledgeAlert(alertId: string): Promise<void> {
    // Delete escalation state (stops further escalation)
    // Note: The actual alert status update is done by the alerts.routes.ts endpoint
    await this.db.query(
      'DELETE FROM alert_escalation_state WHERE alert_id = $1',
      [alertId]
    );

    // Get alert details to send device clear command
    const alertResult = await this.db.query<{ tenant_id: string; mac_address: string }>(
      `SELECT a.tenant_id, d.mac_address
       FROM alerts a
       LEFT JOIN devices d ON d.id = a.device_id
       WHERE a.id = $1`,
      [alertId]
    );

    if (alertResult.rows[0] && alertResult.rows[0].mac_address) {
      const { tenant_id, mac_address } = alertResult.rows[0];
      const mqttService = getMqttService();
      if (mqttService) {
        try {
          await mqttService.publishDeviceCommand(tenant_id, mac_address, {
            command: 'alert_clear',
            alertId: String(alertId),
            reason: 'acknowledged',
            timestamp: Date.now(),
          });
        } catch (error: any) {
          logger.warn('[ESCALATION] Failed to send alert_clear command', { error: error.message });
        }
      }
    }

    logger.info('[ESCALATION] Alert acknowledged', { alertId });
  }

  /**
   * Get current escalation presets
   */
  getPresets(): typeof ESCALATION_PRESETS {
    return ESCALATION_PRESETS;
  }
}

// Singleton instance
let escalationServiceInstance: EscalationService | null = null;

export function initEscalationService(db: Pool): EscalationService {
  if (!escalationServiceInstance) {
    escalationServiceInstance = new EscalationService(db);
  }
  return escalationServiceInstance;
}

export function getEscalationService(): EscalationService | null {
  return escalationServiceInstance;
}
