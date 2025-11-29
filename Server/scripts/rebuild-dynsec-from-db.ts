#!/usr/bin/env tsx

/**
 * Rebuild Dynamic Security credentials from database
 *
 * Use this script when:
 * - dynamic-security.json is lost or corrupted
 * - Devices are stranded because broker doesn't recognize their credentials
 * - You need to resync all device credentials to the broker
 *
 * This script reads mqtt_password_plain from the database and recreates
 * all device credentials in the Mosquitto Dynamic Security plugin.
 *
 * Usage: tsx scripts/rebuild-dynsec-from-db.ts [--dry-run]
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

interface DeviceCredential {
  id: string;
  name: string;
  mqtt_username: string;
  mqtt_password_plain: string;
  tenant_id: string;
  status: string;
}

let dynsecClient: MqttClient | null = null;
let pendingCommands: Map<string, { resolve: (response: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }> = new Map();

async function connectDynsecClient(): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    console.log('[DYNSEC] Connecting to broker...');

    dynsecClient = mqtt.connect(DYNSEC_BROKER_URL, {
      clientId: `dynsec_rebuild_${Date.now()}`,
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

async function addDevice(username: string, password: string): Promise<boolean> {
  try {
    // First try to delete existing client (ignore errors if not found)
    try {
      await sendDynsecCommand({
        command: 'deleteClient',
        username: username,
      });
    } catch {
      // Ignore - client might not exist
    }

    // Create new client with the device role
    await sendDynsecCommand({
      command: 'createClient',
      username: username,
      password: password,
      roles: [{ rolename: DYNSEC_DEFAULT_ROLE }],
    });

    return true;
  } catch (error: any) {
    console.error(`   Failed: ${error.message}`);
    return false;
  }
}

async function rebuildDynsec(dryRun: boolean = false) {
  const pool = new Pool(DB_CONFIG);

  try {
    console.log('\n======================================');
    console.log('  Rebuild Dynamic Security from DB');
    console.log('======================================\n');

    if (dryRun) {
      console.log('*** DRY RUN MODE - No changes will be made ***\n');
    }

    // Query all claimed devices with mqtt_password_plain
    console.log('[DB] Querying claimed devices...');
    const result = await pool.query<DeviceCredential>(`
      SELECT
        d.id,
        d.name,
        d.mqtt_username,
        d.mqtt_password_plain,
        d.tenant_id,
        d.status
      FROM devices d
      WHERE d.mqtt_username IS NOT NULL
        AND d.mqtt_password_plain IS NOT NULL
        AND d.status != 'unclaimed'
      ORDER BY d.name
    `);

    const devices = result.rows;
    console.log(`[DB] Found ${devices.length} claimed devices with credentials\n`);

    if (devices.length === 0) {
      console.log('No devices to sync. Exiting.');
      return;
    }

    // List devices to be synced
    console.log('Devices to sync:');
    devices.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.name} (${d.mqtt_username}) - ${d.status}`);
    });
    console.log('');

    if (dryRun) {
      console.log('[DRY RUN] Would sync the above devices. Exiting.');
      return;
    }

    // Connect to Dynamic Security
    await connectDynsecClient();

    // Sync each device
    console.log('Syncing devices to Dynamic Security...\n');
    let successCount = 0;
    let failCount = 0;

    for (const device of devices) {
      process.stdout.write(`  Syncing ${device.name} (${device.mqtt_username})... `);

      const success = await addDevice(device.mqtt_username, device.mqtt_password_plain);

      if (success) {
        console.log('OK');
        successCount++;
      } else {
        failCount++;
      }

      // Small delay between operations to avoid overwhelming the broker
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n--------------------------------------');
    console.log(`Results: ${successCount} succeeded, ${failCount} failed`);
    console.log('--------------------------------------\n');

    if (failCount > 0) {
      console.log('WARNING: Some devices failed to sync. They may need manual attention.');
      process.exitCode = 1;
    } else {
      console.log('All devices synced successfully!');
      console.log('\nDevices should be able to reconnect with their existing credentials.');
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
const dryRun = args.includes('--dry-run');

rebuildDynsec(dryRun);
