# Database Schema Reference

**PostgreSQL database structure and migrations**

---

## Quick Reference

### Connection
```bash
psql -U wadehargrove -d mousetrap_db
```

### Migrations
```bash
# Run pending migrations
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Create new migration
npm run migrate:create <name>
```

---

## Current Schema (Migration 006)

### Core Tables

**devices**
- `id` UUID PK
- `tenant_id` UUID FK → tenants
- `name` VARCHAR
- `mac_address` VARCHAR UNIQUE
- `mqtt_client_id` VARCHAR
- `mqtt_username` VARCHAR
- `mqtt_password` VARCHAR
- `mqtt_password_plain` VARCHAR
- `claimed_at` TIMESTAMP
- `unclaimed_at` TIMESTAMP
- `last_seen` TIMESTAMP
- `online` BOOLEAN

**claim_codes**
- `claim_code` VARCHAR(8) PK
- `tenant_id` UUID FK
- `device_name` VARCHAR
- `status` VARCHAR (active/claimed/expired)
- `expires_at` TIMESTAMP
- `claimed_by_device_id` UUID

**device_claiming_queue** (NEW - Migration 006)
- `id` SERIAL PK
- `mac_address` VARCHAR(17) UNIQUE NOT NULL
- `serial_number` VARCHAR(50)
- `ip_address` VARCHAR(45)
- `expires_at` TIMESTAMP NOT NULL
- `created_at` TIMESTAMP DEFAULT NOW()
- **Purpose:** Tracks devices in claiming mode (10-minute window)
- **Cleanup:** Automatic via `cleanup_expired_claiming_devices()` function
- **Used by:** Seamless claiming system with button activation

**firmware_versions**
- `id` UUID PK
- `version` VARCHAR
- `type` VARCHAR (firmware/filesystem)
- `file_path` VARCHAR
- `file_url` VARCHAR
- `sha256` VARCHAR
- `changelog` TEXT
- `required` BOOLEAN
- `global` BOOLEAN
- `tenant_id` UUID (nullable if global)

**device_alerts**
- `id` UUID PK
- `device_id` UUID FK
- `tenant_id` UUID FK
- `alert_type` VARCHAR
- `alert_status` VARCHAR (new/acknowledged/resolved)
- `severity` VARCHAR
- `message` TEXT
- `triggered_at` TIMESTAMP
- `resolved_at` TIMESTAMP

### Multi-Tenancy

**tenants**
- `id` UUID PK
- `name` VARCHAR
- `created_at` TIMESTAMP

**users**
- `id` UUID PK
- `email` VARCHAR UNIQUE
- `password_hash` VARCHAR
- `created_at` TIMESTAMP

**user_tenant_memberships**
- `user_id` UUID FK
- `tenant_id` UUID FK
- `role` VARCHAR (viewer/operator/admin/superadmin)
- `joined_at` TIMESTAMP

---

## Migration System

### Directory
`/migrations/`

### Files
- `001_initial_schema.sql`
- `002_add_ota_support.sql`
- `003_add_claim_codes.sql`
- `004_add_multi_tenancy.sql`
- `005_create_user_tenant_memberships.sql`
- `006_create_device_claiming_queue.sql` (NEW - Seamless claiming system)

### How It Works
1. Migrations tracked in `schema_migrations` table
2. Each migration has UP and DOWN sections
3. Safe to run multiple times
4. Only applies pending migrations

---

## Backup & Restore

### Backup
```bash
./scripts/backup-database.sh
```

Creates: `backups/backup_YYYYMMDD_HHMMSS.sql.gz`

### Restore
```bash
./scripts/restore-database.sh backup_20251116_103045
```

---

**Related:** [DEPLOYMENT.md](./DEPLOYMENT.md)
