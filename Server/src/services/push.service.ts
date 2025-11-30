/**
 * Push Notification Service
 *
 * Handles sending push notifications to mobile devices via Expo Push Notifications.
 * Supports iOS, Android, and web push tokens.
 */

import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from 'expo-server-sdk';
import { Pool } from 'pg';
import { logger } from './logger.service';

// Notification types
export type NotificationType =
  | 'trap_alert'
  | 'device_offline'
  | 'device_online'
  | 'low_battery'
  | 'test';

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  badge?: number;
  priority?: 'default' | 'normal' | 'high';
  categoryId?: string;
}

export interface AlertNotificationData {
  alertId: string;
  deviceId: string;
  deviceName: string;
  alertType: string;
  severity: string;
  tenantId: string;
  message?: string;
}

interface PushToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  device_name: string | null;
}

interface NotificationPreferences {
  trap_alerts: boolean;
  device_offline: boolean;
  device_online: boolean;
  low_battery: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export class PushService {
  private expo: Expo;
  private db: Pool;

  constructor(db: Pool) {
    this.expo = new Expo();
    this.db = db;
    logger.info('[PUSH] Push notification service initialized');
  }

  /**
   * Register a push token for a user
   */
  async registerToken(
    userId: string,
    token: string,
    platform: 'ios' | 'android' | 'web',
    deviceName?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate the token format
      if (!Expo.isExpoPushToken(token)) {
        logger.warn('[PUSH] Invalid Expo push token', { userId, token: String(token).substring(0, 20) + '...' });
        return { success: false, error: 'Invalid push token format' };
      }

      // Upsert the token (update if exists, insert if not)
      await this.db.query(
        `INSERT INTO push_tokens (user_id, token, platform, device_name, last_used_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, token)
         DO UPDATE SET platform = $3, device_name = $4, last_used_at = NOW()`,
        [userId, token, platform, deviceName || null]
      );

      logger.info('[PUSH] Token registered', { userId, platform, deviceName });
      return { success: true };
    } catch (error: any) {
      logger.error('[PUSH] Failed to register token', { error: error.message, userId });
      return { success: false, error: 'Database error' };
    }
  }

  /**
   * Remove a push token
   */
  async removeToken(token: string): Promise<void> {
    try {
      await this.db.query('DELETE FROM push_tokens WHERE token = $1', [token]);
      logger.info('[PUSH] Token removed', { token: token.substring(0, 20) + '...' });
    } catch (error: any) {
      logger.error('[PUSH] Failed to remove token', { error: error.message });
    }
  }

  /**
   * Get notification preferences for a user
   */
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const result = await this.db.query(
      'SELECT * FROM notification_preferences WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Return defaults
      return {
        trap_alerts: true,
        device_offline: true,
        device_online: false,
        low_battery: true,
        quiet_hours_enabled: false,
        quiet_hours_start: null,
        quiet_hours_end: null,
      };
    }

    return result.rows[0];
  }

  /**
   * Update notification preferences for a user
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [userId];
    let paramIndex = 2;

    for (const [key, value] of Object.entries(preferences)) {
      if (value !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (fields.length === 0) return;

    await this.db.query(
      `INSERT INTO notification_preferences (user_id, ${Object.keys(preferences).join(', ')})
       VALUES ($1, ${Object.keys(preferences).map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id)
       DO UPDATE SET ${fields.join(', ')}`,
      values
    );
  }

  /**
   * Check if user is in quiet hours
   */
  private isInQuietHours(prefs: NotificationPreferences): boolean {
    if (!prefs.quiet_hours_enabled || !prefs.quiet_hours_start || !prefs.quiet_hours_end) {
      return false;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = prefs.quiet_hours_start.split(':').map(Number);
    const [endHour, endMin] = prefs.quiet_hours_end.split(':').map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 22:00 - 07:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    }

    return currentTime >= startTime && currentTime < endTime;
  }

  /**
   * Send notification to a specific user
   */
  async sendToUser(
    userId: string,
    notification: PushNotification,
    notificationType: NotificationType,
    skipPreferenceCheck: boolean = false
  ): Promise<{ sent: number; failed: number }> {
    try {
      // Check user preferences unless skipping
      if (!skipPreferenceCheck) {
        const prefs = await this.getPreferences(userId);

        // Check if this notification type is enabled
        const typeKey = notificationType.replace('_alert', '_alerts') as keyof NotificationPreferences;
        if (prefs[typeKey] === false) {
          logger.debug('[PUSH] Notification type disabled for user', { userId, notificationType });
          return { sent: 0, failed: 0 };
        }

        // Check quiet hours
        if (this.isInQuietHours(prefs)) {
          logger.debug('[PUSH] User in quiet hours, skipping notification', { userId });
          return { sent: 0, failed: 0 };
        }
      }

      // Get all push tokens for user
      const result = await this.db.query<PushToken>(
        'SELECT * FROM push_tokens WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        logger.debug('[PUSH] No push tokens for user', { userId });
        return { sent: 0, failed: 0 };
      }

      // Build messages for each token
      const messages: ExpoPushMessage[] = result.rows.map(token => ({
        to: token.token,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        sound: notification.sound || 'default',
        priority: notification.priority || 'high',
        categoryId: notification.categoryId,
      }));

      // Send in chunks (Expo recommends max 100 per request)
      const chunks = this.expo.chunkPushNotifications(messages);
      let sent = 0;
      let failed = 0;

      for (const chunk of chunks) {
        try {
          const tickets = await this.expo.sendPushNotificationsAsync(chunk);

          // Process tickets
          for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            const token = result.rows[i];

            if (ticket.status === 'ok') {
              sent++;
              // Log the notification
              await this.logNotification(userId, token.id, notificationType, notification, 'sent');
              // Update last_used_at
              await this.db.query(
                'UPDATE push_tokens SET last_used_at = NOW() WHERE id = $1',
                [token.id]
              );
            } else {
              failed++;
              const errorMessage = 'message' in ticket ? ticket.message : 'Unknown error';
              await this.logNotification(userId, token.id, notificationType, notification, 'failed', errorMessage);

              // Remove invalid tokens
              if ('details' in ticket && ticket.details?.error === 'DeviceNotRegistered') {
                logger.info('[PUSH] Removing invalid token', { tokenId: token.id });
                await this.removeToken(token.token);
              }
            }
          }
        } catch (error: any) {
          logger.error('[PUSH] Failed to send chunk', { error: error.message });
          failed += chunk.length;
        }
      }

      logger.info('[PUSH] Notifications sent', { userId, sent, failed });
      return { sent, failed };
    } catch (error: any) {
      logger.error('[PUSH] Error sending to user', { error: error.message, userId });
      return { sent: 0, failed: 0 };
    }
  }

  /**
   * Send notification to all users in a tenant
   */
  async sendToTenant(
    tenantId: string,
    notification: PushNotification,
    notificationType: NotificationType
  ): Promise<{ sent: number; failed: number }> {
    try {
      // Get all users in tenant
      const usersResult = await this.db.query(
        `SELECT DISTINCT u.id
         FROM users u
         JOIN user_tenant_memberships utm ON u.id = utm.user_id
         WHERE utm.tenant_id = $1`,
        [tenantId]
      );

      let totalSent = 0;
      let totalFailed = 0;

      for (const user of usersResult.rows) {
        const { sent, failed } = await this.sendToUser(user.id, notification, notificationType);
        totalSent += sent;
        totalFailed += failed;
      }

      logger.info('[PUSH] Tenant notifications sent', { tenantId, sent: totalSent, failed: totalFailed });
      return { sent: totalSent, failed: totalFailed };
    } catch (error: any) {
      logger.error('[PUSH] Error sending to tenant', { error: error.message, tenantId });
      return { sent: 0, failed: 0 };
    }
  }

  /**
   * Handle alert notification - main entry point for device alerts
   */
  async handleAlertNotification(data: AlertNotificationData): Promise<void> {
    const { alertId, deviceId, deviceName, alertType, severity, tenantId, message } = data;

    logger.info('[PUSH] Processing alert notification', { alertId, deviceName, alertType, severity });

    // Determine notification type
    let notificationType: NotificationType = 'trap_alert';
    if (alertType === 'offline') notificationType = 'device_offline';
    else if (alertType === 'online') notificationType = 'device_online';
    else if (alertType === 'low_battery') notificationType = 'low_battery';

    // Build notification content
    const notification: PushNotification = {
      title: this.getAlertTitle(alertType, deviceName, severity),
      body: message || this.getAlertBody(alertType, deviceName),
      data: {
        type: 'alert',
        alertId,
        deviceId,
        alertType,
        severity,
      },
      sound: severity === 'critical' || severity === 'high' ? 'default' : null,
      priority: severity === 'critical' ? 'high' : 'default',
    };

    // Send to all users in tenant
    await this.sendToTenant(tenantId, notification, notificationType);
  }

  /**
   * Generate alert title based on type
   */
  private getAlertTitle(alertType: string, deviceName: string, severity: string): string {
    switch (alertType) {
      case 'trap_triggered':
        return `🪤 ${deviceName}: Trap Triggered!`;
      case 'offline':
        return `⚠️ ${deviceName}: Device Offline`;
      case 'online':
        return `✅ ${deviceName}: Back Online`;
      case 'low_battery':
        return `🔋 ${deviceName}: Low Battery`;
      default:
        return `${deviceName}: ${alertType}`;
    }
  }

  /**
   * Generate alert body based on type
   */
  private getAlertBody(alertType: string, deviceName: string): string {
    switch (alertType) {
      case 'trap_triggered':
        return `The trap at ${deviceName} has been triggered. Check it now!`;
      case 'offline':
        return `${deviceName} has gone offline. Check the device connection.`;
      case 'online':
        return `${deviceName} is back online and operational.`;
      case 'low_battery':
        return `${deviceName} battery is low. Please replace or recharge soon.`;
      default:
        return `Alert from ${deviceName}`;
    }
  }

  /**
   * Log notification to database
   */
  private async logNotification(
    userId: string,
    pushTokenId: string,
    notificationType: NotificationType,
    notification: PushNotification,
    status: 'sent' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO notification_log
         (user_id, push_token_id, notification_type, title, body, data, status, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          pushTokenId,
          notificationType,
          notification.title,
          notification.body,
          JSON.stringify(notification.data || {}),
          status,
          errorMessage || null,
        ]
      );
    } catch (error: any) {
      logger.error('[PUSH] Failed to log notification', { error: error.message });
    }
  }

  /**
   * Send a test notification to a user
   */
  async sendTestNotification(userId: string): Promise<{ sent: number; failed: number }> {
    return this.sendToUser(
      userId,
      {
        title: '🧪 Test Notification',
        body: 'If you see this, push notifications are working!',
        data: { type: 'test' },
      },
      'test',
      true // Skip preference check for test
    );
  }
}

// Singleton instance
let pushServiceInstance: PushService | null = null;

export function initPushService(db: Pool): PushService {
  if (!pushServiceInstance) {
    pushServiceInstance = new PushService(db);
  }
  return pushServiceInstance;
}

export function getPushService(): PushService | null {
  return pushServiceInstance;
}
