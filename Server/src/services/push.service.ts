/**
 * Push Notification Service
 *
 * Handles sending push notifications to mobile devices.
 * Supports native APNs (iOS) and Expo Push Notifications.
 */

import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import apn from 'apn';
import { Pool } from 'pg';
import { logger } from './logger.service';
import path from 'path';

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
  private apnProvider: apn.Provider | null = null;
  private db: Pool;

  constructor(db: Pool) {
    this.expo = new Expo();
    this.db = db;
    this.initAPNs();
    logger.info('[PUSH] Push notification service initialized');
  }

  /**
   * Initialize APNs provider
   */
  private initAPNs(): void {
    const keyPath = process.env.APNS_KEY_PATH || path.join(__dirname, '../../keys/AuthKey_4LLQS44HAV.p8');
    const keyId = process.env.APNS_KEY_ID || '4LLQS44HAV';
    const teamId = process.env.APNS_TEAM_ID || 'SVW57P4S75';
    const bundleId = process.env.APNS_BUNDLE_ID || 'com.mousetrap.ios';

    try {
      this.apnProvider = new apn.Provider({
        token: {
          key: keyPath,
          keyId: keyId,
          teamId: teamId,
        },
        production: process.env.NODE_ENV === 'production',
      });
      logger.info('[PUSH] APNs provider initialized', { keyId, teamId, bundleId, production: process.env.NODE_ENV === 'production' });
    } catch (error: any) {
      logger.error('[PUSH] Failed to initialize APNs', { error: error.message });
    }
  }

  /**
   * Check if token is an APNs device token (hex string, 64 chars)
   */
  private isAPNsToken(token: string): boolean {
    // APNs device tokens are 64-character hex strings
    return /^[a-fA-F0-9]{64}$/.test(token);
  }

  /**
   * Send notification via APNs
   */
  private async sendViaAPNs(
    tokens: string[],
    notification: PushNotification
  ): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
    if (!this.apnProvider) {
      logger.warn('[PUSH] APNs provider not initialized');
      return { sent: 0, failed: tokens.length, invalidTokens: [] };
    }

    const bundleId = process.env.APNS_BUNDLE_ID || 'com.mousetrap.ios';
    const invalidTokens: string[] = [];

    const note = new apn.Notification();
    note.alert = {
      title: notification.title,
      body: notification.body,
    };
    note.topic = bundleId;
    note.sound = notification.sound || 'default';
    if (notification.badge !== undefined) {
      note.badge = notification.badge;
    }
    note.payload = notification.data || {};
    (note as any).pushType = 'alert';
    note.priority = notification.priority === 'high' ? 10 : 5;

    try {
      const result = await this.apnProvider.send(note, tokens);

      // Track invalid tokens for removal
      for (const failure of result.failed) {
        if (failure.status === '410' || failure.response?.reason === 'Unregistered') {
          invalidTokens.push(failure.device);
        }
        logger.warn('[PUSH] APNs delivery failed', {
          device: failure.device.substring(0, 16) + '...',
          status: failure.status,
          reason: failure.response?.reason
        });
      }

      logger.info('[PUSH] APNs send result', { sent: result.sent.length, failed: result.failed.length });
      return {
        sent: result.sent.length,
        failed: result.failed.length,
        invalidTokens
      };
    } catch (error: any) {
      logger.error('[PUSH] APNs send error', { error: error.message });
      return { sent: 0, failed: tokens.length, invalidTokens: [] };
    }
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
      logger.info('[PUSH] registerToken called', {
        userId,
        tokenPreview: String(token).substring(0, 20) + '...',
        platform,
        deviceName
      });

      // Accept both Expo tokens and native APNs tokens
      const isNativeAPNs = this.isAPNsToken(token);
      const isExpoToken = Expo.isExpoPushToken(token);

      if (!isNativeAPNs && !isExpoToken) {
        logger.warn('[PUSH] Invalid push token format', {
          userId,
          tokenPreview: String(token).substring(0, 20) + '...',
          length: String(token).length
        });
        // Still register it - might be a valid format we don't recognize
      }

      // Upsert the token (update if exists, insert if not)
      logger.info('[PUSH] Inserting token into database...');
      const result = await this.db.query(
        `INSERT INTO push_tokens (user_id, token, platform, device_name, last_used_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, token)
         DO UPDATE SET platform = $3, device_name = $4, last_used_at = NOW()
         RETURNING id`,
        [userId, token, platform, deviceName || null]
      );

      logger.info('[PUSH] Token insert result', {
        rowCount: result.rowCount,
        returnedId: result.rows[0]?.id
      });

      logger.info('[PUSH] Token registered', {
        userId,
        platform,
        deviceName,
        tokenType: isNativeAPNs ? 'apns' : isExpoToken ? 'expo' : 'unknown'
      });
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

      // Separate tokens by type
      const apnsTokens: string[] = [];
      const expoTokens: PushToken[] = [];

      for (const tokenRow of result.rows) {
        if (this.isAPNsToken(tokenRow.token)) {
          apnsTokens.push(tokenRow.token);
        } else if (Expo.isExpoPushToken(tokenRow.token)) {
          expoTokens.push(tokenRow);
        } else {
          // Try as APNs if iOS platform
          if (tokenRow.platform === 'ios') {
            apnsTokens.push(tokenRow.token);
          }
        }
      }

      let totalSent = 0;
      let totalFailed = 0;

      // Send via APNs
      if (apnsTokens.length > 0) {
        const apnsResult = await this.sendViaAPNs(apnsTokens, notification);
        totalSent += apnsResult.sent;
        totalFailed += apnsResult.failed;

        // Remove invalid tokens
        for (const invalidToken of apnsResult.invalidTokens) {
          await this.removeToken(invalidToken);
        }
      }

      // Send via Expo
      if (expoTokens.length > 0) {
        const messages: ExpoPushMessage[] = expoTokens.map(token => ({
          to: token.token,
          title: notification.title,
          body: notification.body,
          data: notification.data,
          sound: notification.sound || 'default',
          priority: notification.priority || 'high',
          categoryId: notification.categoryId,
        }));

        const chunks = this.expo.chunkPushNotifications(messages);

        for (const chunk of chunks) {
          try {
            const tickets = await this.expo.sendPushNotificationsAsync(chunk);

            for (let i = 0; i < tickets.length; i++) {
              const ticket = tickets[i];
              const token = expoTokens[i];

              if (ticket.status === 'ok') {
                totalSent++;
                await this.db.query(
                  'UPDATE push_tokens SET last_used_at = NOW() WHERE id = $1',
                  [token.id]
                );
              } else {
                totalFailed++;
                if ('details' in ticket && ticket.details?.error === 'DeviceNotRegistered') {
                  await this.removeToken(token.token);
                }
              }
            }
          } catch (error: any) {
            logger.error('[PUSH] Failed to send Expo chunk', { error: error.message });
            totalFailed += chunk.length;
          }
        }
      }

      // Log notification
      for (const tokenRow of result.rows) {
        await this.logNotification(
          userId,
          tokenRow.id,
          notificationType,
          notification,
          totalSent > 0 ? 'sent' : 'failed'
        );
      }

      logger.info('[PUSH] Notifications sent', { userId, sent: totalSent, failed: totalFailed });
      return { sent: totalSent, failed: totalFailed };
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
    // Trap alerts and high/critical always get sound
    const playSound = alertType === 'trap_triggered' || severity === 'critical' || severity === 'high';
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
      sound: playSound ? 'default' : null,
      priority: alertType === 'trap_triggered' || severity === 'critical' ? 'high' : 'default',
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

  /**
   * Cleanup - call when shutting down
   */
  shutdown(): void {
    if (this.apnProvider) {
      this.apnProvider.shutdown();
    }
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
