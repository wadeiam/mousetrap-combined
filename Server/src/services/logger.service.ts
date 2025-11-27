/**
 * Logger Service
 *
 * Provides structured logging with in-memory circular buffer for recent logs.
 * Logs are both written to console and stored in memory for retrieval via API.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

export interface LogContext {
  deviceId?: string;
  macAddress?: string;
  userId?: string;
  tenantId?: string;
  error?: string;
  stack?: string;
  [key: string]: any;
}

export interface LogFilter {
  level?: LogLevel | LogLevel[];
  search?: string;
  since?: Date;
  limit?: number;
  offset?: number;
}

class LoggerService {
  private logs: LogEntry[] = [];
  private maxLogs: number;
  private logCounter: number = 0;

  constructor(maxLogs: number = 5000) {
    this.maxLogs = maxLogs;
  }

  /**
   * Generate unique log ID
   */
  private generateId(): string {
    return `log_${Date.now()}_${this.logCounter++}`;
  }

  /**
   * Add log entry to circular buffer
   */
  private addLogEntry(level: LogLevel, message: string, context?: LogContext): void {
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      level,
      message,
      context,
    };

    // Add to beginning of array (newest first)
    this.logs.unshift(entry);

    // Trim to max size (circular buffer)
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // Console output with appropriate method
    this.logToConsole(entry);
  }

  /**
   * Output log to console with formatting
   */
  private logToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString();
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const logMessage = `[${timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;

    switch (entry.level) {
      case 'error':
        console.error(logMessage);
        if (entry.context?.stack) {
          console.error(entry.context.stack);
        }
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'debug':
        console.debug(logMessage);
        break;
      case 'info':
      default:
        console.log(logMessage);
        break;
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    this.addLogEntry('debug', message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    this.addLogEntry('info', message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    this.addLogEntry('warn', message, context);
  }

  /**
   * Log error message
   */
  error(message: string, context?: LogContext): void {
    this.addLogEntry('error', message, context);
  }

  /**
   * Log error from Error object
   */
  logError(error: Error, message: string, context?: LogContext): void {
    this.error(message, {
      ...context,
      error: error.message,
      stack: error.stack,
    });
  }

  /**
   * Get logs with optional filtering
   */
  getLogs(filter: LogFilter = {}): { logs: LogEntry[]; total: number } {
    let filteredLogs = [...this.logs];

    // Filter by level
    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
      filteredLogs = filteredLogs.filter((log) => levels.includes(log.level));
    }

    // Filter by search term (searches message and context)
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filteredLogs = filteredLogs.filter((log) => {
        const messageMatch = log.message.toLowerCase().includes(searchLower);
        const contextMatch = log.context
          ? JSON.stringify(log.context).toLowerCase().includes(searchLower)
          : false;
        return messageMatch || contextMatch;
      });
    }

    // Filter by timestamp
    if (filter.since) {
      filteredLogs = filteredLogs.filter(
        (log) => log.timestamp >= filter.since!
      );
    }

    const total = filteredLogs.length;

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 100;
    filteredLogs = filteredLogs.slice(offset, offset + limit);

    return { logs: filteredLogs, total };
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
    this.info('Log buffer cleared');
  }

  /**
   * Get current log count
   */
  getCount(): number {
    return this.logs.length;
  }

  /**
   * Get log statistics
   */
  getStats(): {
    total: number;
    byLevel: Record<LogLevel, number>;
  } {
    const stats = {
      total: this.logs.length,
      byLevel: {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
      } as Record<LogLevel, number>,
    };

    this.logs.forEach((log) => {
      stats.byLevel[log.level]++;
    });

    return stats;
  }
}

// Create singleton instance
export const logger = new LoggerService(5000);
export default logger;
