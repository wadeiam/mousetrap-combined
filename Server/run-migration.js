// Simple migration runner
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mousetrap_monitor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres123',
});

async function runMigration(filename) {
  const filePath = path.join(__dirname, 'migrations', filename);
  const sql = fs.readFileSync(filePath, 'utf8');

  console.log(`Running migration: ${filename}`);
  try {
    await pool.query(sql);
    console.log(`Migration ${filename} completed successfully`);
  } catch (error) {
    console.error(`Migration ${filename} failed:`, error.message);
    throw error;
  }
}

async function main() {
  const migrationFile = process.argv[2];
  if (!migrationFile) {
    console.error('Usage: node run-migration.js <migration-file.sql>');
    process.exit(1);
  }

  try {
    await runMigration(migrationFile);
  } finally {
    await pool.end();
  }
}

main();
