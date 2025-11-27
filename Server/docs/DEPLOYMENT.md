# Server Deployment & Update Guide

This guide explains how to safely update your server while preserving all data (devices, users, firmware, tenants, etc.).

## Table of Contents

1. [Safe Update Procedure](#safe-update-procedure)
2. [Database Backup & Restore](#database-backup--restore)
3. [Database Migrations](#database-migrations)
4. [Rollback Procedure](#rollback-procedure)
5. [Production Best Practices](#production-best-practices)

## Safe Update Procedure

Follow these steps to update your server WITHOUT losing any data:

### 1. Backup Current Database

**ALWAYS create a backup before making any changes:**

```bash
cd /Users/wadehargrove/Documents/MouseTrap/Server
./scripts/backup-database.sh
```

This creates a timestamped backup in `./backups/` directory.

### 2. Pull Latest Code

```bash
git pull origin main
# OR if not using git:
# Copy updated files to server directory
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Database Migrations

Migrations are safe to run multiple times - they only apply changes that haven't been applied yet:

```bash
# Set up database connection string
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mousetrap_monitor"

# Run all pending migrations
npm run migrate:up
```

### 5. Rebuild TypeScript

```bash
npm run build
```

### 6. Restart Server

```bash
pm2 restart mqtt-server
# OR if not using pm2:
# npm run start:prod
```

### 7. Verify Everything Works

1. Check server health: `curl http://localhost:4000/health`
2. Login to dashboard and verify devices appear
3. Check logs: `pm2 logs mqtt-server`

## Database Backup & Restore

### Create Manual Backup

```bash
# Create backup with custom name
./scripts/backup-database.sh my_backup_name

# Create automatic timestamped backup
./scripts/backup-database.sh
```

Backups are stored in `./backups/` and automatically compressed with gzip.

### List Available Backups

```bash
ls -lh ./backups/
```

### Restore from Backup

```bash
# Restore specific backup
./scripts/restore-database.sh backup_20250116_103045

# The script will:
# 1. Create a safety backup of current database
# 2. Ask for confirmation
# 3. Restore the specified backup
# 4. Show next steps
```

## Database Migrations

### Understanding Migrations

The migration system tracks which database changes have been applied. Migration files are in `./migrations/`:

```
migrations/
├── 001_create_mqtt_tables.sql          # Core tables
├── 002_create_claim_system.sql         # Device claiming
├── 003_add_unclaimed_at.sql            # Unclaimed tracking
├── 004_create_firmware_table.sql       # Firmware management
└── 005_create_user_tenant_memberships.sql # Multi-tenancy
```

### Migration Commands

```bash
# Run all pending migrations
npm run migrate:up

# Roll back last migration (USE WITH CAUTION)
npm run migrate:down

# Create new migration file
npm run migrate:create my_new_migration
```

### Important: Migrations are Safe

- Migrations use `CREATE TABLE IF NOT EXISTS` - won't drop existing tables
- Migrations use conditional `ALTER TABLE` - won't fail if columns exist
- Running migrations multiple times is safe
- **Your data is preserved**

## Rollback Procedure

If something goes wrong during an update:

### 1. Stop the Server

```bash
pm2 stop mqtt-server
```

### 2. Restore Previous Database Backup

```bash
./scripts/restore-database.sh pre_update_YYYYMMDD_HHMMSS
```

### 3. Restore Previous Code

```bash
git checkout <previous-commit-hash>
# OR restore from backup
```

### 4. Rebuild and Restart

```bash
npm install
npm run build
pm2 restart mqtt-server
```

## Production Best Practices

### Before Every Update

1. **Create a backup** - Always, no exceptions
2. **Test in development** - If possible, test updates on a dev instance first
3. **Schedule maintenance window** - Inform users of brief downtime
4. **Have rollback plan ready** - Know how to restore previous state

### Monitoring After Update

```bash
# Watch server logs
pm2 logs mqtt-server --lines 100

# Check server health
curl http://localhost:4000/health

# Monitor database connections
psql -U postgres -d mousetrap_monitor -c "SELECT count(*) FROM pg_stat_activity;"
```

### Automated Backup Schedule

Consider setting up automated daily backups with cron:

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd /Users/wadehargrove/Documents/MouseTrap/Server && ./scripts/backup-database.sh daily_auto >> ./backups/backup.log 2>&1
```

### Database Maintenance

```bash
# Vacuum and analyze database (improves performance)
psql -U postgres -d mousetrap_monitor -c "VACUUM ANALYZE;"

# Check database size
psql -U postgres -d mousetrap_monitor -c "SELECT pg_size_pretty(pg_database_size('mousetrap_monitor'));"
```

## Common Issues

### Issue: Devices Not Showing in Dashboard

**Problem**: After update, devices don't appear in UI
**Cause**: Database still has devices, but UI isn't fetching them correctly
**Solution**:
1. Check database: `psql -U postgres -d mousetrap_monitor -c "SELECT id, name, mac_address FROM devices;"`
2. Check browser console for errors
3. Clear browser cache and reload
4. Verify API endpoint works: `curl http://localhost:4000/api/devices -H "Authorization: Bearer <your-token>"`

### Issue: Migration Fails

**Problem**: Migration command returns error
**Cause**: Usually a syntax error or missing dependency
**Solution**:
1. Check migration file for syntax errors
2. Ensure DATABASE_URL is set correctly
3. Check PostgreSQL is running
4. Review migration logs for specific error

### Issue: Login Doesn't Work After Update

**Problem**: Can't login with existing credentials
**Cause**: User table schema changed
**Solution**:
1. Restore from backup
2. Review user_tenant_memberships migration
3. Ensure migration ran successfully: `psql -U postgres -d mousetrap_monitor -c "\dt"`

## Quick Reference

```bash
# Complete safe update workflow
cd /Users/wadehargrove/Documents/MouseTrap/Server
./scripts/backup-database.sh pre_update_$(date +%Y%m%d_%H%M%S)
git pull
npm install
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mousetrap_monitor"
npm run migrate:up
npm run build
pm2 restart mqtt-server
pm2 logs mqtt-server --lines 50
```

## Support

If you encounter issues:

1. Check `pm2 logs mqtt-server` for errors
2. Review migration logs
3. Verify database connection
4. If all else fails, restore from backup and retry

Remember: **Backups are your safety net. Always create one before changes.**
