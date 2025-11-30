/**
 * Email Service - Nodemailer Integration
 *
 * Sends email alerts for emergency contact escalation.
 * Includes rate limiting to prevent spam during repeated escalations.
 */

import nodemailer from 'nodemailer';
import { logger } from './logger.service';

// Rate limiting: track recent sends per email address
const recentSends = new Map<string, { count: number; firstSendAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_PER_WINDOW = 10; // Max 10 emails per hour per address

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress: string = '';
  private enabled: boolean = false;

  /**
   * Initialize the email service with SMTP credentials
   */
  initialize(config?: Partial<EmailConfig>): boolean {
    const host = config?.host || process.env.SMTP_HOST;
    const port = config?.port || parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = config?.secure ?? (process.env.SMTP_SECURE === 'true');
    const user = config?.user || process.env.SMTP_USER;
    const pass = config?.pass || process.env.SMTP_PASS;
    const from = config?.from || process.env.SMTP_FROM;

    if (!host || !user || !pass || !from) {
      logger.warn('[Email] SMTP credentials not configured - Email alerts disabled');
      logger.warn('[Email] Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM');
      this.enabled = false;
      return false;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user,
          pass,
        },
      });

      this.fromAddress = from;
      this.enabled = true;
      logger.info('[Email] SMTP email service initialized', { host, port, from });
      return true;
    } catch (error: any) {
      logger.error('[Email] Failed to initialize SMTP', { error: error.message });
      this.enabled = false;
      return false;
    }
  }

  /**
   * Verify SMTP connection
   */
  async verify(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      logger.info('[Email] SMTP connection verified');
      return true;
    } catch (error: any) {
      logger.error('[Email] SMTP verification failed', { error: error.message });
      return false;
    }
  }

  /**
   * Check if email service is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.transporter !== null;
  }

  /**
   * Check rate limit for an email address
   */
  private checkRateLimit(email: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const normalizedEmail = email.toLowerCase();
    const record = recentSends.get(normalizedEmail);

    if (!record) {
      return { allowed: true };
    }

    // Reset if outside window
    if (now - record.firstSendAt > RATE_LIMIT_WINDOW_MS) {
      recentSends.delete(normalizedEmail);
      return { allowed: true };
    }

    if (record.count >= RATE_LIMIT_MAX_PER_WINDOW) {
      const resetIn = Math.ceil((record.firstSendAt + RATE_LIMIT_WINDOW_MS - now) / 60000);
      return {
        allowed: false,
        reason: `Rate limit exceeded. Max ${RATE_LIMIT_MAX_PER_WINDOW} emails per hour. Resets in ${resetIn} min.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a send for rate limiting
   */
  private recordSend(email: string): void {
    const now = Date.now();
    const normalizedEmail = email.toLowerCase();
    const record = recentSends.get(normalizedEmail);

    if (!record || now - record.firstSendAt > RATE_LIMIT_WINDOW_MS) {
      recentSends.set(normalizedEmail, { count: 1, firstSendAt: now });
    } else {
      record.count++;
    }
  }

  /**
   * Send an email
   */
  async send(to: string, subject: string, text: string, html?: string): Promise<EmailResult> {
    if (!this.isEnabled()) {
      logger.warn('[Email] Attempted to send email but service is not enabled');
      return { success: false, error: 'Email service not configured' };
    }

    const normalizedTo = to.toLowerCase();

    // Check rate limit
    const rateCheck = this.checkRateLimit(normalizedTo);
    if (!rateCheck.allowed) {
      logger.warn('[Email] Rate limit exceeded', { to: normalizedTo, reason: rateCheck.reason });
      return { success: false, error: rateCheck.reason };
    }

    try {
      const result = await this.transporter!.sendMail({
        from: this.fromAddress,
        to: normalizedTo,
        subject,
        text,
        html,
      });

      // Record successful send for rate limiting
      this.recordSend(normalizedTo);

      logger.info('[Email] Message sent successfully', {
        to: normalizedTo,
        messageId: result.messageId,
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error: any) {
      logger.error('[Email] Failed to send message', {
        to: normalizedTo,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send emergency trap alert email
   */
  async sendTrapAlert(
    to: string,
    deviceName: string,
    elapsedMinutes: number,
    level: number,
    contactName?: string
  ): Promise<EmailResult> {
    const elapsedText = elapsedMinutes < 60
      ? `${elapsedMinutes} minutes`
      : `${Math.floor(elapsedMinutes / 60)} hours ${elapsedMinutes % 60} min`;

    const urgencyPrefix = level >= 5 ? '🚨 EMERGENCY' : '⚠️ URGENT';
    const urgencyColor = level >= 5 ? '#dc2626' : '#ea580c';

    const greeting = contactName ? `Hi ${contactName},` : 'Hello,';

    const subject = `${urgencyPrefix} MouseTrap Alert: ${deviceName}`;

    const text = `${greeting}

${contactName ? "You're listed as an emergency contact. " : ''}A mouse has been trapped at "${deviceName}" for ${elapsedText}.

Please check on it ${level >= 5 ? 'IMMEDIATELY' : 'as soon as possible'}!

This is an automated alert from MouseTrap. The mouse's welfare depends on a timely response.

---
MouseTrap Alert System`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background-color: ${urgencyColor}; color: white; padding: 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">${urgencyPrefix}</h1>
      <p style="margin: 10px 0 0 0; font-size: 16px;">MouseTrap Alert</p>
    </div>
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #374151; margin: 0 0 20px 0;">${greeting}</p>

      ${contactName ? '<p style="font-size: 16px; color: #374151; margin: 0 0 20px 0;">You\'re listed as an emergency contact.</p>' : ''}

      <div style="background-color: #fef3c7; border-left: 4px solid ${urgencyColor}; padding: 15px; margin: 0 0 20px 0;">
        <p style="margin: 0; font-size: 16px; color: #92400e;">
          <strong>A mouse has been trapped at "${deviceName}" for ${elapsedText}.</strong>
        </p>
      </div>

      <p style="font-size: 18px; color: ${urgencyColor}; font-weight: bold; margin: 0 0 20px 0;">
        Please check on it ${level >= 5 ? 'IMMEDIATELY' : 'as soon as possible'}!
      </p>

      <p style="font-size: 14px; color: #6b7280; margin: 0;">
        This is an automated alert from MouseTrap. The mouse's welfare depends on a timely response.
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 15px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">MouseTrap Alert System</p>
    </div>
  </div>
</body>
</html>`;

    return this.send(to, subject, text, html);
  }

  /**
   * Get rate limit status for an email address (for debugging/admin)
   */
  getRateLimitStatus(email: string): { count: number; resetAt: Date | null } {
    const normalizedEmail = email.toLowerCase();
    const record = recentSends.get(normalizedEmail);

    if (!record) {
      return { count: 0, resetAt: null };
    }

    return {
      count: record.count,
      resetAt: new Date(record.firstSendAt + RATE_LIMIT_WINDOW_MS),
    };
  }

  /**
   * Clear rate limit for an email address (admin function)
   */
  clearRateLimit(email: string): void {
    const normalizedEmail = email.toLowerCase();
    recentSends.delete(normalizedEmail);
    logger.info('[Email] Rate limit cleared', { email: normalizedEmail });
  }
}

// Singleton instance
let emailServiceInstance: EmailService | null = null;

export function initEmailService(config?: Partial<EmailConfig>): EmailService {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService();
  }
  emailServiceInstance.initialize(config);
  return emailServiceInstance;
}

export function getEmailService(): EmailService | null {
  return emailServiceInstance;
}

export { EmailService, EmailResult };
