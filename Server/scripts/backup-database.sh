#!/bin/bash

# ============================================================================
# Database Backup Script
# ============================================================================
# Creates a complete backup of the PostgreSQL database
# Usage: ./scripts/backup-database.sh [backup-name]
# ============================================================================

set -e

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
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="${1:-backup_${TIMESTAMP}}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "============================================"
echo "Database Backup"
echo "============================================"
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "Backup file: $BACKUP_FILE"
echo ""

# Create backup
echo "Creating backup..."
PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  --create \
  --verbose \
  -f "$BACKUP_FILE" 2>&1 | grep -E "(dumping|CREATE|SET)" || true

if [ $? -eq 0 ]; then
  # Compress backup
  echo ""
  echo "Compressing backup..."
  gzip -f "$BACKUP_FILE"
  BACKUP_FILE="${BACKUP_FILE}.gz"

  # Get file size
  FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

  echo ""
  echo "✓ Backup completed successfully!"
  echo "  File: $BACKUP_FILE"
  echo "  Size: $FILE_SIZE"
  echo ""
  echo "To restore this backup, run:"
  echo "  ./scripts/restore-database.sh $BACKUP_NAME"
else
  echo ""
  echo "✗ Backup failed!"
  exit 1
fi

# Clean up old backups (keep last 10)
echo "Cleaning up old backups (keeping last 10)..."
ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
echo "✓ Cleanup complete"
