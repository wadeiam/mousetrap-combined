#!/usr/bin/env tsx

/**
 * Credential Sync Health Check
 *
 * Verifies that all claimed devices in the database have matching
 * credentials in the Mosquitto Dynamic Security plugin.
 *
 * Use this script to:
 * - Detect devices with missing broker credentials
 * - Identify stale credentials in the broker
 * - Audit credential sync health after migrations
 *
 * Usage:
 *   npx tsx scripts/check-credential-sync.ts           # Check and report
 *   npx tsx scripts/check-credential-sync.ts --fix     # Fix missing credentials
 */

import { Pool } from 'pg';
import mqtt, { MqttClient } from 'mqtt';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres123',
};

// Dynamic Security settings
const DYNSEC_BROKER_URL = process.env.MQTT_DYNSEC_BROKER_URL || 'mqtt://localhost:1883';
const DYNSEC_ADMIN_USER = process.env.MQTT_DYNSEC_ADMIN_USER || 'server_admin';
const DYNSEC_ADMIN_PASS = process.env.MQTT_DYNSEC_ADMIN_PASS || 'mqtt_admin_password';
const DYNSEC_DEFAULT_ROLE = process.env.MQTT_DYNSEC_DEFAULT_ROLE || 'device';

interface DeviceRecord {
  id: string;
  name: string;
  mqtt_username: string;
  mqtt_password_plain: string | null;
  status: string;
  online: boolean;
  last_seen: Date | null;
}

interface SyncIssue {
  device: DeviceRecord;
  issue: 'missing_in_broker' | 'missing_password_plain' | 'stale_in_broker';
}

let dynsecClient: MqttClient | null = null;
let pendingCommands: Map<string, { resolve: (response: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }> = new Map();

async function connectDynsecClient(): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    console.log('[DYNSEC] Connecting to broker...');

    dynsecClient = mqtt.connect(DYNSEC_BROKER_URL, {
      clientId: `dynsec_check_${Date.now()}`,
      username: DYNSEC_ADMIN_USER,
      password: DYNSEC_ADMIN_PASS,
      clean: true,
      connectTimeout: 10000,
    });

    dynsecClient.on('connect', () => {
      console.log('[DYNSEC] Connected to broker');

      dynsecClient!.subscribe('$CONTROL/dynamic-security/v1/response', { qos: 0 }, (err) => {
        if (err) {
          console.error('[DYNSEC] Failed to subscribe:', err);
          reject(err);
        } else {
          console.log('[DYNSEC] Subscribed to response topic');
          resolve(dynsecClient!);
        }
      });
    });

    dynsecClient.on('error', (err) => {
      console.error('[DYNSEC] Connection error:', err);
      reject(err);
    });

    dynsecClient.on('message', (topic, message) => {
      if (topic === '$CONTROL/dynamic-security/v1/response') {
        try {
          const response = JSON.parse(message.toString());
          let correlationData = response.correlationData;

          if (!correlationData && pendingCommands.size === 1) {
            correlationData = pendingCommands.keys().next().value;
          }

          if (correlationData && pendingCommands.has(correlationData)) {
            const pending = pendingCommands.get(correlationData)!;
            clearTimeout(pending.timeout);
            pendingCommands.delete(correlationData);

            if (response.responses && response.responses.length > 0) {
              const result = response.responses[0];
              if (result.error) {
                pending.reject(new Error(result.error));
              } else {
                pending.resolve(result);
              }
            } else {
              pending.resolve(response);
            }
          }
        } catch (err) {
          console.error('[DYNSEC] Failed to parse response:', err);
        }
      }
    });
  });
}

async function sendDynsecCommand(command: any): Promise<any> {
  if (!dynsecClient) {
    throw new Error('Dynsec client not connected');
  }

  const correlationData = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const payload = {
    commands: [command],
    correlationData,
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCommands.delete(correlationData);
      reject(new Error('Command timeout'));
    }, 10000);

    pendingCommands.set(correlationData, { resolve, reject, timeout });

    dynsecClient!.publish('$CONTROL/dynamic-security/v1', JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        clearTimeout(timeout);
        pendingCommands.delete(correlationData);
        reject(err);
      }
    });
  });
}

async function listBrokerClients(): Promise<string[]> {
  try {
    const response = await sendDynsecCommand({ command: 'listClients' });
    return response.data?.clients?.map((c: any) => c.username) || [];
  } catch (error: any) {
    console.error('[DYNSEC] Failed to list clients:', error.message);
    return [];
  }
}

async function checkClientExists(username: string): Promise<boolean> {
  try {
    await sendDynsecCommand({ command: 'getClient', username });
    return true;
  } catch {
    return false;
  }
}

async function addDevice(username: string, password: string): Promise<boolean> {
  try {
    // First try to delete existing (ignore errors)
    try {
      await sendDynsecCommand({ command: 'deleteClient', username });
    } catch { /* ignore */ }

    // Create new client
    await sendDynsecCommand({
      command: 'createClient',
      username,
      password,
      roles: [{ rolename: DYNSEC_DEFAULT_ROLE }],
    });

    return true;
  } catch (error: any) {
    console.error(`   Failed to add ${username}: ${error.message}`);
    return false;
  }
}

async function checkCredentialSync(fix: boolean = false) {
  const pool = new Pool(DB_CONFIG);

  try {
    console.log('\n======================================');
    console.log('  Credential Sync Health Check');
    console.log('======================================\n');

    // Connect to Dynamic Security
    await connectDynsecClient();

    // Get all clients from broker
    console.log('[CHECK] Fetching broker clients...');
    const brokerClients = await listBrokerClients();
    console.log(`[CHECK] Found ${brokerClients.length} clients in broker\n`);

    // Filter to device clients only (exclude server_admin, mqtt_client, etc.)
    const knownSystemClients = ['server_admin', 'mqtt_client'];
    const deviceClientsInBroker = brokerClients.filter(c => !knownSystemClients.includes(c));

    // Get all claimed devices from database
    console.log('[CHECK] Fetching database devices...');
    const result = await pool.query<DeviceRecord>(`
      SELECT
        d.id,
        d.name,
        d.mqtt_username,
        d.mqtt_password_plain,
        d.status,
        d.online,
        d.last_seen
      FROM devices d
      WHERE d.mqtt_username IS NOT NULL
        AND d.unclaimed_at IS NULL
      ORDER BY d.name
    `);

    const devices = result.rows;
    console.log(`[CHECK] Found ${devices.length} claimed devices in database\n`);

    const issues: SyncIssue[] = [];
    const deviceUsernames = new Set<string>();

    // Check each device
    console.log('Checking devices...\n');
    for (const device of devices) {
      deviceUsernames.add(device.mqtt_username);

      // Check if device exists in broker
      const existsInBroker = await checkClientExists(device.mqtt_username);

      if (!existsInBroker) {
        issues.push({ device, issue: 'missing_in_broker' });
        console.log(`  [ISSUE] ${device.name} (${device.mqtt_username}) - Missing in broker`);

        if (!device.mqtt_password_plain) {
          console.log(`          No password_plain available - cannot auto-fix`);
        }
      } else if (!device.mqtt_password_plain) {
        issues.push({ device, issue: 'missing_password_plain' });
        console.log(`  [WARN]  ${device.name} (${device.mqtt_username}) - No password_plain in DB`);
      } else {
        console.log(`  [OK]    ${device.name} (${device.mqtt_username})`);
      }
    }

    // Check for stale credentials in broker (devices that exist in broker but not in DB)
    console.log('\nChecking for stale broker credentials...\n');
    for (const brokerClient of deviceClientsInBroker) {
      if (!deviceUsernames.has(brokerClient)) {
        console.log(`  [STALE] ${brokerClient} - In broker but not in database`);
        // Note: We don't auto-remove stale credentials as it could break something
      }
    }

    // Summary
    console.log('\n======================================');
    console.log('  Summary');
    console.log('======================================\n');

    const missingInBroker = issues.filter(i => i.issue === 'missing_in_broker');
    const missingPassword = issues.filter(i => i.issue === 'missing_password_plain');

    console.log(`Total devices in DB:     ${devices.length}`);
    console.log(`Total clients in broker: ${deviceClientsInBroker.length}`);
    console.log(`Missing in broker:       ${missingInBroker.length}`);
    console.log(`Missing password_plain:  ${missingPassword.length}`);

    if (issues.length === 0) {
      console.log('\nAll credentials are in sync!');
      return;
    }

    // Fix issues if requested
    if (fix && missingInBroker.length > 0) {
      console.log('\n======================================');
      console.log('  Fixing Issues');
      console.log('======================================\n');

      const fixable = missingInBroker.filter(i => i.device.mqtt_password_plain);

      if (fixable.length === 0) {
        console.log('No fixable issues (devices missing password_plain need manual recovery).');
      } else {
        console.log(`Fixing ${fixable.length} device(s)...\n`);

        let fixed = 0;
        for (const { device } of fixable) {
          process.stdout.write(`  Adding ${device.name} (${device.mqtt_username})... `);
          const success = await addDevice(device.mqtt_username, device.mqtt_password_plain!);
          if (success) {
            console.log('OK');
            fixed++;
          }
        }

        console.log(`\nFixed ${fixed}/${fixable.length} devices`);
      }
    } else if (!fix && missingInBroker.length > 0) {
      console.log('\nRun with --fix to add missing devices to broker.');
    }

  } catch (error) {
    console.error('\nFatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
    if (dynsecClient) {
      dynsecClient.end();
    }
  }
}

// Main execution
const args = process.argv.slice(2);
const fix = args.includes('--fix');

checkCredentialSync(fix);
