const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function checkPassword() {
  try {
    const result = await pool.query(
      `SELECT mqtt_client_id, mqtt_username, mqtt_password_plain, claimed_at
       FROM devices
       WHERE mqtt_client_id = 'D0CF13155060'
       ORDER BY claimed_at DESC
       LIMIT 1`
    );

    if (result.rows.length > 0) {
      const device = result.rows[0];
      console.log('Device found in database:');
      console.log('  MQTT Client ID:', device.mqtt_client_id);
      console.log('  MQTT Username:', device.mqtt_username);
      console.log('  MQTT Password (plain):', device.mqtt_password_plain);
      console.log('  Claimed at:', device.claimed_at);
    } else {
      console.log('Device not found in database');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkPassword();
