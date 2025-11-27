#!/usr/bin/env node
/**
 * Test HTTP 410 response for revoked devices
 */

const http = require('http');
const { Pool } = require('pg');

const API_URL = process.env.API_URL || 'http://localhost:4000';
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('='.repeat(80));
  console.log('HTTP 410 Test for Revoked Devices');
  console.log('='.repeat(80));
  console.log();

  const dbPool = new Pool(DB_CONFIG);

  try {
    // Find a device to test with
    console.log('[1] Finding a test device...');
    const devicesResult = await dbPool.query(`
      SELECT id, name, mqtt_client_id, tenant_id, unclaimed_at
      FROM devices
      WHERE unclaimed_at IS NULL
      LIMIT 1
    `);

    if (devicesResult.rows.length === 0) {
      console.log('    No claimed devices found to test with');
      return;
    }

    const device = devicesResult.rows[0];
    console.log('    ✓ Found device:', device.name);
    console.log('      MAC:', device.mqtt_client_id);
    console.log();

    // Test 1: Verify device is claimed (should return 200)
    console.log('[2] Testing claim-status for CLAIMED device...');
    const macWithColons = device.mqtt_client_id.match(/.{1,2}/g)?.join(':') || device.mqtt_client_id;
    const url1 = `${API_URL}/api/device/claim-status?mac=${encodeURIComponent(macWithColons)}`;

    try {
      const response1 = await httpGet(url1);
      console.log('    Status Code:', response1.statusCode);
      const data1 = JSON.parse(response1.body);
      console.log('    Response:', JSON.stringify(data1, null, 2));

      if (response1.statusCode === 200 && data1.claimed === true) {
        console.log('    ✓ PASS: Device is claimed (HTTP 200)');
      } else {
        console.log('    ✗ FAIL: Unexpected response');
      }
    } catch (error) {
      console.error('    ✗ ERROR:', error.message);
    }
    console.log();

    // Test 2: Manually revoke device and test again (should return 410)
    console.log('[3] Manually revoking device in database...');
    await dbPool.query(
      'UPDATE devices SET unclaimed_at = NOW() WHERE id = $1',
      [device.id]
    );
    console.log('    ✓ Device marked as revoked');
    console.log();

    console.log('[4] Testing claim-status for REVOKED device...');
    const url2 = `${API_URL}/api/device/claim-status?mac=${encodeURIComponent(macWithColons)}`;

    try {
      const response2 = await httpGet(url2);
      console.log('    Status Code:', response2.statusCode);
      const data2 = JSON.parse(response2.body);
      console.log('    Response:', JSON.stringify(data2, null, 2));

      if (response2.statusCode === 410) {
        console.log('    ✓ PASS: Received HTTP 410 (Gone) for revoked device');
        if (data2.claimed === false && data2.message === 'Device has been revoked') {
          console.log('    ✓ PASS: Response contains correct revocation message');
        }
        if (data2.revokedAt) {
          console.log('    ✓ PASS: Response includes revokedAt timestamp:', data2.revokedAt);
        }
      } else {
        console.log('    ✗ FAIL: Expected HTTP 410, got', response2.statusCode);
      }
    } catch (error) {
      console.error('    ✗ ERROR:', error.message);
    }
    console.log();

    // Cleanup: Restore device to claimed state
    console.log('[5] Restoring device to claimed state...');
    await dbPool.query(
      'UPDATE devices SET unclaimed_at = NULL WHERE id = $1',
      [device.id]
    );
    console.log('    ✓ Device restored to claimed state');
    console.log();

    // Final verification
    console.log('[6] Final verification - device should be claimed again...');
    const url3 = `${API_URL}/api/device/claim-status?mac=${encodeURIComponent(macWithColons)}`;

    try {
      const response3 = await httpGet(url3);
      console.log('    Status Code:', response3.statusCode);
      const data3 = JSON.parse(response3.body);

      if (response3.statusCode === 200 && data3.claimed === true) {
        console.log('    ✓ PASS: Device successfully restored (HTTP 200)');
      } else {
        console.log('    ✗ FAIL: Device not restored correctly');
      }
    } catch (error) {
      console.error('    ✗ ERROR:', error.message);
    }

  } catch (error) {
    console.error('Test error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    await dbPool.end();
  }

  console.log();
  console.log('='.repeat(80));
  console.log('Test Complete');
  console.log('='.repeat(80));
}

main().catch(console.error);
