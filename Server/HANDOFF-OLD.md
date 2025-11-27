# Server Documentation Index

> **DEPRECATED:** For session handoffs and operational info, see [/Documents/MouseTrap/HANDOFF.md](../HANDOFF.md).
> This file is kept for historical reference only.

This document serves as the main entry point for all server documentation. Use this to navigate to specific guides, troubleshooting reports, and deployment procedures.

**Last Updated**: 2025-11-16

---

## Quick Start

New to the project? Start here:

1. **[Deployment Guide](./DEPLOYMENT.md)** - Safe server update procedures and data preservation
2. Review the [Current System Status](#current-system-status) below
3. Check [Known Issues](#known-issues) section

---

## Documentation Categories

### 🚀 Deployment & Operations

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete guide to safely updating the server
  - Safe update procedure that preserves all data
  - Database backup and restore scripts
  - Migration system explained
  - Rollback procedures
  - Production best practices
  - **START HERE** if you need to update the server

### 🧪 Testing & Reports

- **[TEST-INDEX.md](./TEST-INDEX.md)** - Index of all test reports and testing procedures
  - Links to all test reports
  - Testing standards
  - How to run tests

- **[TEST-REPORT-2025-11-11.md](./TEST-REPORT-2025-11-11.md)** - Comprehensive system test results
  - Full API endpoint testing
  - Device claiming flow validation
  - Firmware management testing
  - Alert system verification

### 🐛 Debugging & Troubleshooting

- **[LOGIN_API_TROUBLESHOOTING.md](./LOGIN_API_TROUBLESHOOTING.md)** - Login and authentication issues
  - Common login problems and solutions
  - API response format issues
  - Multi-tenancy troubleshooting

- **[SNAPSHOT-DEBUG-REPORT.md](./SNAPSHOT-DEBUG-REPORT.md)** - Snapshot capture system debugging
  - Device snapshot capture flow
  - MQTT topic structure
  - WebSocket real-time updates
  - Known issues and solutions

---

## Current System Status

### Multi-Tenancy Implementation

**Status**: ✅ Fully Implemented

The system supports multiple tenants with role-based access control:

- **Roles**: `viewer` < `operator` < `admin` < `superadmin`
- **Features**:
  - Users can belong to multiple tenants
  - Each user-tenant relationship has a specific role
  - Role hierarchy properly enforced in middleware
  - JWT tokens include tenant and role information

**Key Files**:
- `src/middleware/auth.middleware.ts` - Authentication with multi-tenant support
- `migrations/005_create_user_tenant_memberships.sql` - Multi-tenant schema
- Database table: `user_tenant_memberships`

### Database Schema

**Current Migration Version**: 005

**Tables**:
- `devices` - IoT device registry
- `device_alerts` - Alert events
- `device_commands` - Command history
- `device_ota_logs` - Firmware update tracking
- `firmware_versions` - Available firmware releases
- `firmware_releases` - Firmware metadata
- `claim_codes` - Device provisioning codes
- `tenants` - Tenant organizations
- `users` - User accounts
- `user_tenant_memberships` - User-tenant-role mappings
- `user_sessions` - Active user sessions
- `audit_logs` - System audit trail
- `alerts` - System-wide alerts

### Backup System

**Status**: ✅ Production Ready

**Scripts**:
- `./scripts/backup-database.sh` - Create database backup
- `./scripts/restore-database.sh` - Restore from backup

**Backup Location**: `./backups/`

**Retention**: Last 10 backups kept automatically

---

## Known Issues

### 1. Snapshot Capture Not Working

**Issue**: Snapshot button in dashboard doesn't capture images
**Cause**: Various MQTT or device connectivity issues
**Solution**: See [SNAPSHOT-DEBUG-REPORT.md](./SNAPSHOT-DEBUG-REPORT.md)

---

## Recently Resolved Issues

### ✅ Devices Not Showing After Update (RESOLVED 2025-11-16)

**Issue**: Devices didn't appear in dashboard after server update
**Root Cause**: JWT tokens were missing `tenantId` and `role` claims
**Solution**: Modified `src/routes/auth.routes.ts:73-94` to include tenant and role information in JWT payload
**Verification**: Both Kitchen and Biggy devices now appear correctly via API

### ✅ Login Returns Old Format (RESOLVED 2025-11-16)

**Issue**: Login API returned old user structure without proper tenant information
**Root Cause**: JWT tokens only contained userId and email
**Solution**: Updated login endpoint to include tenant memberships and role in JWT
**File**: `src/routes/auth.routes.ts:31-124`

---

## Important Credentials & Configuration

### Default Admin Account

**Email**: `admin@mastertenant.com`
**Password**: `Admin123!`
**Tenant**: Master Tenant (superadmin role)

**Security Note**: Change this password in production!

### Database Connection

**Default Config** (from `.env`):
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mousetrap_monitor
DB_USER=postgres
DB_PASSWORD=postgres
```

### Server Ports

- **API Server**: 4000
- **Dashboard**: 5173 (dev), varies in production
- **MQTT Broker**: 1883
- **PostgreSQL**: 5432

---

## Common Commands

### Server Management

```bash
# Start server
pm2 start server

# Restart server
pm2 restart server

# View logs
pm2 logs server

# Stop server
pm2 stop server
```

### Database Operations

```bash
# Create backup
./scripts/backup-database.sh

# Restore backup
./scripts/restore-database.sh backup_20250116_103045

# Run migrations
npm run migrate:up

# Connect to database
psql -U postgres -d mousetrap_monitor
```

### Safe Update Procedure

```bash
# Complete safe update (preserves all data)
cd /Users/wadehargrove/Documents/server-deployment/server
./scripts/backup-database.sh pre_update_$(date +%Y%m%d_%H%M%S)
git pull
npm install
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mousetrap_monitor"
npm run migrate:up
npm run build
pm2 restart server
```

---

## Architecture Overview

### Backend Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with migrations
- **Real-time**: Socket.io for WebSocket
- **Message Broker**: MQTT (Mosquitto)
- **Auth**: JWT with bcrypt

### Frontend Stack

- **Framework**: React with TypeScript
- **State Management**: Zustand
- **Data Fetching**: React Query
- **Styling**: Tailwind CSS
- **Build Tool**: Vite

### Key Design Patterns

1. **Multi-Tenancy**: Row-level tenant isolation
2. **Role-Based Access Control**: Hierarchical permissions
3. **JWT Authentication**: Stateless auth with refresh tokens
4. **Database Migrations**: Version-controlled schema changes
5. **Event-Driven**: MQTT for device communication

---

## File Structure

```
server/
├── HANDOFF.md                          # This file - start here
├── DEPLOYMENT.md                       # Safe deployment guide
├── LOGIN_API_TROUBLESHOOTING.md       # Auth troubleshooting
├── SNAPSHOT-DEBUG-REPORT.md           # Snapshot debugging
├── TEST-INDEX.md                       # Test documentation index
├── TEST-REPORT-2025-11-11.md          # Test results
├── scripts/
│   ├── backup-database.sh              # Database backup
│   ├── restore-database.sh             # Database restore
│   └── test-login.js                   # Login testing script
├── migrations/
│   ├── 001_create_mqtt_tables.sql      # Core tables
│   ├── 002_create_claim_system.sql     # Device claiming
│   ├── 003_add_unclaimed_at.sql        # Unclaim tracking
│   ├── 004_create_firmware_table.sql   # Firmware management
│   └── 005_create_user_tenant_memberships.sql  # Multi-tenancy
├── src/
│   ├── server.ts                       # Main entry point
│   ├── middleware/
│   │   └── auth.middleware.ts          # JWT auth + multi-tenant
│   ├── routes/                         # API endpoints
│   ├── services/                       # Business logic
│   └── types/                          # TypeScript types
└── backups/                            # Database backups
```

---

## Development Workflow

### Making Schema Changes

1. Create new migration file: `npm run migrate:create my_change`
2. Write SQL in `migrations/XXX_my_change.sql`
3. Test migration: `npm run migrate:up`
4. If issues: `npm run migrate:down` (use carefully!)

### Adding New Features

1. Create backup: `./scripts/backup-database.sh`
2. Create migration if database changes needed
3. Update TypeScript types
4. Implement backend routes
5. Update frontend components
6. Test thoroughly
7. Document in appropriate .md file

### Debugging

1. Check server logs: `pm2 logs server`
2. Check database: `psql -U postgres -d mousetrap_monitor`
3. Review relevant troubleshooting doc (see [Debugging & Troubleshooting](#-debugging--troubleshooting))
4. Test with curl or Postman
5. Check browser console for frontend issues

---

## Support & Maintenance

### Regular Maintenance Tasks

**Daily**:
- Monitor server logs for errors
- Check disk space for backups

**Weekly**:
- Review audit logs
- Check database size
- Clean old backups (auto-managed)

**Monthly**:
- Review user accounts
- Update dependencies
- Security patches

### Getting Help

1. Check this HANDOFF.md for documentation links
2. Review specific troubleshooting guides
3. Check server logs: `pm2 logs server`
4. Search test reports for similar issues
5. Review git history for recent changes

### Emergency Procedures

**Server Down**:
```bash
pm2 restart server
pm2 logs server --lines 100
```

**Database Corruption**:
```bash
./scripts/restore-database.sh <latest-backup>
```

**Lost Admin Access**:
```bash
psql -U postgres -d mousetrap_monitor
# Manually reset user password or create new admin
```

---

## Version History

### v1.0.1 - JWT Token Fix (2025-11-16)
- **FIXED**: JWT tokens now include tenantId and role claims
- **FIXED**: Devices endpoint correctly filters by tenant
- **FIXED**: Login response includes complete tenant membership information
- **File Modified**: `src/routes/auth.routes.ts` (lines 73-94)
- **Impact**: Resolves devices not appearing in dashboard after login

### v1.0.0 - Initial Multi-Tenant Implementation
- Multi-tenant architecture
- Role-based access control
- Device claiming system
- Firmware management
- Alert system
- WebSocket real-time updates

### Database Migrations
- 001: Core MQTT tables (devices, alerts, commands, OTA, firmware)
- 002: Claim system (claim_codes, tenants, users)
- 003: Unclaimed device tracking
- 004: Firmware release management
- 005: Multi-tenant user memberships

---

## Contributing

When adding new features or fixing bugs:

1. **Document changes** in the appropriate .md file
2. **Create migrations** for database schema changes
3. **Update this HANDOFF.md** if adding new documentation
4. **Write tests** and update TEST-INDEX.md
5. **Create backup** before major changes

---

## Questions?

- **Deployment**: See [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Testing**: See [TEST-INDEX.md](./TEST-INDEX.md)
- **Login Issues**: See [LOGIN_API_TROUBLESHOOTING.md](./LOGIN_API_TROUBLESHOOTING.md)
- **Snapshot Issues**: See [SNAPSHOT-DEBUG-REPORT.md](./SNAPSHOT-DEBUG-REPORT.md)

Remember: **Always backup before making changes!**

```bash
./scripts/backup-database.sh
```
