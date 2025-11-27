#!/usr/bin/env node
/**
 * Script to clear retained MQTT messages for firmware/filesystem updates
 * Run this when old firmware versions are deleted but devices keep receiving stale MQTT messages
 */

const mqtt = require('mqtt');

const MQTT_HOST = process.env.MQTT_HOST || '192.168.133.110';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883');
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'mqtt_client';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'mqtt_password123';
const TENANT_ID = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000001';

const topics = [
  `tenant/${TENANT_ID}/firmware/latest`,
  `tenant/${TENANT_ID}/filesystem/latest`,
  `global/firmware/latest`,
  `global/filesystem/latest`,
];

console.log(`Connecting to MQTT broker at ${MQTT_HOST}:${MQTT_PORT}...`);

const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  clientId: `clear-retained-${Date.now()}`,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clean: true,
});

client.on('connect', async () => {
  console.log('Connected to MQTT broker');

  for (const topic of topics) {
    console.log(`Clearing retained message on ${topic}...`);
    client.publish(topic, null, { qos: 1, retain: true }, (err) => {
      if (err) {
        console.error(`  ✗ Failed to clear ${topic}:`, err.message);
      } else {
        console.log(`  ✓ Cleared ${topic}`);
      }
    });
  }

  // Wait a bit for publishes to complete
  setTimeout(() => {
    console.log('\nDone! Disconnecting...');
    client.end();
  }, 2000);
});

client.on('error', (err) => {
  console.error('MQTT connection error:', err.message);
  process.exit(1);
});
