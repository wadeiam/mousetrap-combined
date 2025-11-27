#!/bin/bash

# ============================================================================
# Database Restore Script
# ============================================================================
# Restores a PostgreSQL database from a backup
# Usage: ./scripts/restore-database.sh <backup-name>
# Example: ./scripts/restore-database.sh backup_20250116_103045
# ============================================================================

set -e

# Check if backup name provided
if [ -z "$1" ]; then
  echo "Error: Backup name required"
  echo "Usage: ./scripts/restore-database.sh <backup-name>"
  echo ""
  echo "Available backups:"
  ls -1 ./backups/*.sql.gz 2>/dev/null | xargs -n 1 basename | sed 's/.sql.gz//' || echo "  No backups found"
  exit 1
fi

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-mousetrap_monitor}"
DB_USER="${DB_USER:-postgres}"
BACKUP_DIR="./backups"
BACKUP_NAME="$1"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql.gz"

# Check if backup exists
if [ ! -f "$BACKUP_FILE" ]; then
  # Try without .gz extension
  BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql"
  if [ ! -f "$BACKUP_FILE" ]; then
    echo "✗ Error: Backup file not found: $BACKUP_NAME"
    echo ""
    echo "Available backups:"
    ls -1 ./backups/*.sql.gz 2>/dev/null | xargs -n 1 basename | sed 's/.sql.gz//' || echo "  No backups found"
    exit 1
  fi
fi

echo "============================================"
echo "Database Restore"
echo "============================================"
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "Backup file: $BACKUP_FILE"
echo ""
echo "WARNING: This will DROP the existing database and restore from backup!"
echo "         All current data will be LOST!"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Restore cancelled"
  exit 0
fi

echo ""
echo "Creating safety backup of current database..."
./scripts/backup-database.sh "pre_restore_$(date +%Y%m%d_%H%M%S)"

echo ""
echo "Restoring database..."

# Decompress if needed
if [[ "$BACKUP_FILE" == *.gz ]]; then
  TEMP_FILE="/tmp/db_restore_${BACKUP_NAME}.sql"
  gunzip -c "$BACKUP_FILE" > "$TEMP_FILE"
  RESTORE_FILE="$TEMP_FILE"
else
  RESTORE_FILE="$BACKUP_FILE"
fi

# Restore database
PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "postgres" \
  -f "$RESTORE_FILE" 2>&1 | grep -E "(CREATE|DROP|RESTORE)" || true

# Clean up temp file
if [ -n "$TEMP_FILE" ] && [ -f "$TEMP_FILE" ]; then
  rm -f "$TEMP_FILE"
fi

if [ $? -eq 0 ]; then
  echo ""
  echo "✓ Database restored successfully!"
  echo ""
  echo "Next steps:"
  echo "  1. Restart the server: pm2 restart server"
  echo "  2. Verify data in dashboard"
else
  echo ""
  echo "✗ Restore failed!"
  exit 1
fi
