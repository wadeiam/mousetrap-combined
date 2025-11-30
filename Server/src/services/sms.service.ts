/**
 * SMS Service - Twilio Integration
 *
 * Sends SMS alerts for emergency contact escalation.
 * Includes rate limiting to prevent spam during repeated escalations.
 */

import Twilio from 'twilio';
import { logger } from './logger.service';

// Rate limiting: track recent sends per phone number
const recentSends = new Map<string, { count: number; firstSendAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_PER_WINDOW = 5; // Max 5 SMS per hour per number

interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

class SmsService {
  private client: Twilio.Twilio | null = null;
  private fromNumber: string = '';
  private enabled: boolean = false;

  /**
   * Initialize the SMS service with Twilio credentials
   */
  initialize(config?: Partial<SmsConfig>): boolean {
    const accountSid = config?.accountSid || process.env.TWILIO_ACCOUNT_SID;
    const authToken = config?.authToken || process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = config?.fromNumber || process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      logger.warn('[SMS] Twilio credentials not configured - SMS alerts disabled');
      logger.warn('[SMS] Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER');
      this.enabled = false;
      return false;
    }

    try {
      this.client = Twilio(accountSid, authToken);
      this.fromNumber = fromNumber;
      this.enabled = true;
      logger.info('[SMS] Twilio SMS service initialized', { fromNumber });
      return true;
    } catch (error: any) {
      logger.error('[SMS] Failed to initialize Twilio', { error: error.message });
      this.enabled = false;
      return false;
    }
  }

  /**
   * Check if SMS service is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Check rate limit for a phone number
   */
  private checkRateLimit(phoneNumber: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const record = recentSends.get(phoneNumber);

    if (!record) {
      return { allowed: true };
    }

    // Reset if outside window
    if (now - record.firstSendAt > RATE_LIMIT_WINDOW_MS) {
      recentSends.delete(phoneNumber);
      return { allowed: true };
    }

    if (record.count >= RATE_LIMIT_MAX_PER_WINDOW) {
      const resetIn = Math.ceil((record.firstSendAt + RATE_LIMIT_WINDOW_MS - now) / 60000);
      return {
        allowed: false,
        reason: `Rate limit exceeded. Max ${RATE_LIMIT_MAX_PER_WINDOW} SMS per hour. Resets in ${resetIn} min.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a send for rate limiting
   */
  private recordSend(phoneNumber: string): void {
    const now = Date.now();
    const record = recentSends.get(phoneNumber);

    if (!record || now - record.firstSendAt > RATE_LIMIT_WINDOW_MS) {
      recentSends.set(phoneNumber, { count: 1, firstSendAt: now });
    } else {
      record.count++;
    }
  }

  /**
   * Format phone number to E.164 format
   */
  private formatPhoneNumber(phone: string): string {
    // Remove all non-numeric characters
    let cleaned = phone.replace(/\D/g, '');

    // Add country code if missing (assume US)
    if (cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }

    // Add + prefix
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }

  /**
   * Send an SMS message
   */
  async send(to: string, message: string): Promise<SmsResult> {
    if (!this.isEnabled()) {
      logger.warn('[SMS] Attempted to send SMS but service is not enabled');
      return { success: false, error: 'SMS service not configured' };
    }

    const formattedTo = this.formatPhoneNumber(to);

    // Check rate limit
    const rateCheck = this.checkRateLimit(formattedTo);
    if (!rateCheck.allowed) {
      logger.warn('[SMS] Rate limit exceeded', { to: formattedTo, reason: rateCheck.reason });
      return { success: false, error: rateCheck.reason };
    }

    try {
      const result = await this.client!.messages.create({
        body: message,
        to: formattedTo,
        from: this.fromNumber,
      });

      // Record successful send for rate limiting
      this.recordSend(formattedTo);

      logger.info('[SMS] Message sent successfully', {
        to: formattedTo,
        messageId: result.sid,
        status: result.status,
      });

      return {
        success: true,
        messageId: result.sid,
      };
    } catch (error: any) {
      logger.error('[SMS] Failed to send message', {
        to: formattedTo,
        error: error.message,
        code: error.code,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send emergency trap alert SMS
   */
  async sendTrapAlert(
    to: string,
    deviceName: string,
    elapsedMinutes: number,
    level: number,
    contactName?: string
  ): Promise<SmsResult> {
    const elapsedText = elapsedMinutes < 60
      ? `${elapsedMinutes} minutes`
      : `${Math.floor(elapsedMinutes / 60)} hours ${elapsedMinutes % 60} min`;

    const urgencyPrefix = level >= 5 ? 'EMERGENCY' : 'URGENT';

    const message = contactName
      ? `${urgencyPrefix} MOUSETRAP ALERT: Hi ${contactName}, you're listed as an emergency contact. A mouse has been trapped at "${deviceName}" for ${elapsedText}. Please check on it or contact the owner immediately!`
      : `${urgencyPrefix} MOUSETRAP ALERT: A mouse has been trapped at "${deviceName}" for ${elapsedText}. Please check on it immediately!`;

    return this.send(to, message);
  }

  /**
   * Get rate limit status for a phone number (for debugging/admin)
   */
  getRateLimitStatus(phoneNumber: string): { count: number; resetAt: Date | null } {
    const formattedPhone = this.formatPhoneNumber(phoneNumber);
    const record = recentSends.get(formattedPhone);

    if (!record) {
      return { count: 0, resetAt: null };
    }

    return {
      count: record.count,
      resetAt: new Date(record.firstSendAt + RATE_LIMIT_WINDOW_MS),
    };
  }

  /**
   * Clear rate limit for a phone number (admin function)
   */
  clearRateLimit(phoneNumber: string): void {
    const formattedPhone = this.formatPhoneNumber(phoneNumber);
    recentSends.delete(formattedPhone);
    logger.info('[SMS] Rate limit cleared', { phoneNumber: formattedPhone });
  }
}

// Singleton instance
let smsServiceInstance: SmsService | null = null;

export function initSmsService(config?: Partial<SmsConfig>): SmsService {
  if (!smsServiceInstance) {
    smsServiceInstance = new SmsService();
  }
  smsServiceInstance.initialize(config);
  return smsServiceInstance;
}

export function getSmsService(): SmsService | null {
  return smsServiceInstance;
}

export { SmsService, SmsResult };
