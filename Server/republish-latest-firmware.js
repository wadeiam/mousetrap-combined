#!/usr/bin/env node
/**
 * Script to republish the latest firmware versions to MQTT
 * Run this after clearing retained messages to publish current versions
 */

const { Pool } = require('pg');
const mqtt = require('mqtt');
require('dotenv').config();

const MQTT_HOST = process.env.MQTT_BROKER_URL?.replace('mqtt://', '').split(':')[0] || '192.168.133.110';
const MQTT_PORT = 1883;
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'mqtt_client';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'mqtt_password123';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// Connect to database
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres123',
});

// Connect to MQTT
const mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  clientId: `republish-${Date.now()}`,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clean: true,
});

async function main() {
  try {
    // Get latest firmware and filesystem versions
    const result = await pool.query(
      `SELECT version, type, url, size, sha256, changelog, required, is_global
       FROM firmware_versions
       WHERE (tenant_id = $1 OR is_global = true) AND deprecated_at IS NULL
       ORDER BY published_at DESC`,
      [TENANT_ID]
    );

    console.log(`Found ${result.rows.length} firmware versions`);

    // Group by type and get latest
    const latest = {
      firmware: result.rows.find(r => r.type === 'firmware'),
      filesystem: result.rows.find(r => r.type === 'filesystem'),
    };

    // Publish to MQTT
    for (const [type, firmware] of Object.entries(latest)) {
      if (!firmware) {
        console.log(`No ${type} version found`);
        continue;
      }

      const topic = firmware.is_global
        ? `global/${type}/latest`
        : `tenant/${TENANT_ID}/${type}/latest`;

      const message = {
        version: firmware.version,
        url: firmware.url,
        size: firmware.size,
        sha256: firmware.sha256,
        changelog: firmware.changelog,
        required: firmware.required,
      };

      console.log(`\nPublishing ${type} v${firmware.version} to ${topic}...`);
      mqttClient.publish(topic, JSON.stringify(message), { qos: 1, retain: true }, (err) => {
        if (err) {
          console.error(`  ✗ Failed:`, err.message);
        } else {
          console.log(`  ✓ Published successfully`);
        }
      });
    }

    // Wait for publishes to complete
    setTimeout(() => {
      console.log('\nDone!');
      mqttClient.end();
      pool.end();
      process.exit(0);
    }, 2000);

  } catch (error) {
    console.error('Error:', error);
    mqttClient.end();
    pool.end();
    process.exit(1);
  }
}

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker\n');
  main();
});

mqttClient.on('error', (err) => {
  console.error('MQTT error:', err.message);
  pool.end();
  process.exit(1);
});
