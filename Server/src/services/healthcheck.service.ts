/**
 * Healthchecks.io Integration Service
 *
 * Provides external "dead man's switch" monitoring. Pings healthchecks.io
 * periodically to prove the server is alive. If pings stop, healthchecks.io
 * sends alerts via email/SMS/etc.
 *
 * This catches scenarios where the server itself is down and can't send alerts.
 */

import { logger } from './logger.service';

interface HealthcheckConfig {
  pingUrl: string;
  intervalMs: number;
}

class HealthcheckService {
  private config: HealthcheckConfig | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private readonly MAX_FAILURES_TO_LOG = 3;

  /**
   * Initialize the healthcheck service
   * @param pingUrl - The healthchecks.io ping URL (e.g., https://hc-ping.com/uuid)
   * @param intervalMs - How often to ping (default: 5 minutes)
   */
  init(pingUrl: string | undefined, intervalMs = 5 * 60 * 1000): boolean {
    if (!pingUrl) {
      console.log('⚠ Healthcheck service not configured - external monitoring disabled');
      console.log('  Set HEALTHCHECKS_URL to enable (get a free check at healthchecks.io)');
      return false;
    }

    this.config = { pingUrl, intervalMs };
    this.start();
    return true;
  }

  private start(): void {
    if (!this.config) return;

    // Send initial ping on startup
    this.ping();

    // Then ping periodically
    this.intervalHandle = setInterval(() => {
      this.ping();
    }, this.config.intervalMs);

    const intervalMinutes = Math.round(this.config.intervalMs / 60000);
    console.log(`✓ Healthcheck service started (pinging every ${intervalMinutes} min)`);
    logger.info('Healthcheck service started', { intervalMs: this.config.intervalMs });
  }

  private async ping(): Promise<void> {
    if (!this.config) return;

    try {
      const response = await fetch(this.config.pingUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        if (this.consecutiveFailures > 0) {
          console.log(`[HEALTHCHECK] Ping successful (recovered after ${this.consecutiveFailures} failures)`);
          logger.info('Healthcheck ping recovered', { previousFailures: this.consecutiveFailures });
        }
        this.consecutiveFailures = 0;
      } else {
        this.handleFailure(`HTTP ${response.status}`);
      }
    } catch (error: any) {
      this.handleFailure(error.message || 'Unknown error');
    }
  }

  private handleFailure(reason: string): void {
    this.consecutiveFailures++;

    // Only log first few failures to avoid log spam
    if (this.consecutiveFailures <= this.MAX_FAILURES_TO_LOG) {
      console.error(`[HEALTHCHECK] Ping failed (${this.consecutiveFailures}): ${reason}`);
      logger.warn('Healthcheck ping failed', {
        consecutiveFailures: this.consecutiveFailures,
        reason
      });
    } else if (this.consecutiveFailures === this.MAX_FAILURES_TO_LOG + 1) {
      console.error('[HEALTHCHECK] Suppressing further failure logs until recovery');
    }
  }

  /**
   * Send a "start" signal for long-running jobs
   * healthchecks.io will expect a corresponding success/fail ping
   */
  async signalStart(): Promise<void> {
    if (!this.config) return;

    try {
      await fetch(`${this.config.pingUrl}/start`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Ignore errors for start signal
    }
  }

  /**
   * Send a failure signal (healthchecks.io will alert immediately)
   */
  async signalFail(message?: string): Promise<void> {
    if (!this.config) return;

    try {
      const url = message
        ? `${this.config.pingUrl}/fail`
        : `${this.config.pingUrl}/fail`;

      await fetch(url, {
        method: 'POST',
        body: message || 'Server reported failure',
        signal: AbortSignal.timeout(5000),
      });

      logger.error('Healthcheck failure signaled', { message });
    } catch {
      // Best effort - if we can't reach healthchecks.io, we're probably down anyway
    }
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[HEALTHCHECK] Service stopped');
      logger.info('Healthcheck service stopped');
    }
  }

  isEnabled(): boolean {
    return this.config !== null;
  }
}

// Singleton instance
const healthcheckService = new HealthcheckService();

export function initHealthcheckService(pingUrl: string | undefined): HealthcheckService {
  healthcheckService.init(pingUrl);
  return healthcheckService;
}

export function getHealthcheckService(): HealthcheckService {
  return healthcheckService;
}

export { HealthcheckService };
