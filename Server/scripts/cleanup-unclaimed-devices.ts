#!/usr/bin/env ts-node

/**
 * Cleanup Job: Remove devices that have been unclaimed for more than 6 months
 *
 * This script should be run periodically (e.g., daily via cron):
 * 0 2 * * * cd /path/to/server && npm run cleanup-unclaimed
 *
 * Or add to PM2 as a cron job:
 * pm2 start scripts/cleanup-unclaimed-devices.ts --cron "0 2 * * *" --no-autorestart
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dbPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true',
});

async function cleanupUnclaimedDevices() {
  try {
    console.log('[CLEANUP] Starting cleanup of unclaimed devices...');

    // Find devices unclaimed more than 6 months ago
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const result = await dbPool.query(
      `SELECT id, name, mqtt_client_id, unclaimed_at
       FROM devices
       WHERE unclaimed_at IS NOT NULL
       AND unclaimed_at < $1`,
      [sixMonthsAgo]
    );

    const devicesToDelete = result.rows;

    if (devicesToDelete.length === 0) {
      console.log('[CLEANUP] No devices to clean up');
      return;
    }

    console.log(`[CLEANUP] Found ${devicesToDelete.length} device(s) to delete:`);

    for (const device of devicesToDelete) {
      const daysUnclaimed = Math.floor(
        (Date.now() - new Date(device.unclaimed_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      console.log(`  - ${device.name} (ID: ${device.id}, unclaimed ${daysUnclaimed} days ago)`);
    }

    // Delete the devices
    const deleteResult = await dbPool.query(
      `DELETE FROM devices
       WHERE unclaimed_at IS NOT NULL
       AND unclaimed_at < $1
       RETURNING id, name`,
      [sixMonthsAgo]
    );

    console.log(`[CLEANUP] ✓ Deleted ${deleteResult.rows.length} device(s)`);

    // Note: MQTT credentials should already be removed when device was unclaimed
    // But if there are orphaned credentials, they can be cleaned up by sync-mqtt-auth.sh

  } catch (error: any) {
    console.error('[CLEANUP] Error during cleanup:', error);
    throw error;
  } finally {
    await dbPool.end();
  }
}

// Run cleanup
cleanupUnclaimedDevices()
  .then(() => {
    console.log('[CLEANUP] Cleanup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[CLEANUP] Cleanup failed:', error);
    process.exit(1);
  });
