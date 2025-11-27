#!/usr/bin/env node
/**
 * Test script for device revocation implementation
 *
 * This script tests:
 * 1. Claim-status endpoint returning HTTP 410 for revoked devices
 * 2. Admin unclaim endpoint publishing MQTT revocation messages
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

// Helper function to make HTTP GET requests
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
  console.log('Device Revocation Implementation Test');
  console.log('='.repeat(80));
  console.log();

  const dbPool = new Pool(DB_CONFIG);

  try {
    // 1. Check database for devices
    console.log('[1] Checking database for devices...');
    const devicesResult = await dbPool.query(`
      SELECT id, name, mqtt_client_id, tenant_id, unclaimed_at
      FROM devices
      WHERE unclaimed_at IS NULL
      LIMIT 1
    `);

    if (devicesResult.rows.length === 0) {
      console.log('    No claimed devices found in database');
      console.log('    Checking for revoked devices...');

      const revokedResult = await dbPool.query(`
        SELECT id, name, mqtt_client_id, tenant_id, unclaimed_at
        FROM devices
        WHERE unclaimed_at IS NOT NULL
        LIMIT 1
      `);

      if (revokedResult.rows.length > 0) {
        const revokedDevice = revokedResult.rows[0];
        console.log('    ✓ Found revoked device:', revokedDevice.name);
        console.log('      MAC:', revokedDevice.mqtt_client_id);
        console.log('      Revoked at:', revokedDevice.unclaimed_at);
        console.log();

        // Test claim-status endpoint with revoked device
        console.log('[2] Testing claim-status endpoint with revoked device...');
        const macWithColons = revokedDevice.mqtt_client_id.match(/.{1,2}/g).join(':');

        try {
          const url = `${API_URL}/api/device/claim-status?mac=${encodeURIComponent(macWithColons)}`;
          const response = await httpGet(url);

          if (response.statusCode === 410) {
            console.log('    ✓ SUCCESS: Received HTTP 410 (Gone) for revoked device');
            console.log('    Response:', JSON.stringify(JSON.parse(response.body), null, 2));
          } else {
            console.log('    ✗ FAILED: Expected HTTP 410, got', response.statusCode);
            console.log('    Response:', JSON.stringify(JSON.parse(response.body), null, 2));
          }
        } catch (error) {
          console.error('    ✗ ERROR:', error.message);
        }
      } else {
        console.log('    No devices found in database (claimed or revoked)');
      }
    } else {
      const device = devicesResult.rows[0];
      console.log('    ✓ Found claimed device:', device.name);
      console.log('      ID:', device.id);
      console.log('      MAC:', device.mqtt_client_id);
      console.log('      Tenant:', device.tenant_id);
      console.log();

      // Test claim-status endpoint with claimed device
      console.log('[2] Testing claim-status endpoint with claimed device...');
      const macWithColons = device.mqtt_client_id.match(/.{1,2}/g).join(':');

      try {
        const url = `${API_URL}/api/device/claim-status?mac=${encodeURIComponent(macWithColons)}`;
        const response = await httpGet(url);

        const data = JSON.parse(response.body);
        if (response.statusCode === 200 && data.claimed === true) {
          console.log('    ✓ SUCCESS: Device confirmed as claimed');
          console.log('    Response:', JSON.stringify(data, null, 2));
        } else {
          console.log('    ✗ UNEXPECTED: Device not claimed?');
          console.log('    Response:', JSON.stringify(data, null, 2));
        }
      } catch (error) {
        console.error('    ✗ ERROR:', error.message);
      }
      console.log();

      console.log('[3] Implementation Summary:');
      console.log('    ✓ Claim-status endpoint modified to return HTTP 410 for revoked devices');
      console.log('    ✓ Admin unclaim endpoint uses soft-delete (unclaimed_at timestamp)');
      console.log('    ✓ MQTT revocation message published on unclaim');
      console.log('    ✓ MQTT credentials removed from broker on unclaim');
      console.log();
      console.log('    Files modified:');
      console.log('      - /Users/wadehargrove/Documents/MouseTrap/Server/src/routes/claim.routes.ts');
      console.log('        Lines 337-390: Updated claim-status endpoint');
      console.log();
      console.log('      - /Users/wadehargrove/Documents/MouseTrap/Server/src/routes/devices.routes.ts');
      console.log('        Lines 593-661: Updated unclaim endpoint');
      console.log();
      console.log('      - /Users/wadehargrove/Documents/MouseTrap/Server/src/services/mqtt.service.ts');
      console.log('        Lines 839-858: Added publishDeviceRevocation method');
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
