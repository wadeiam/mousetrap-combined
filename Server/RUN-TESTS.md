# How to Run Tenant Creation Tests

All test files are located in: `/Users/wadehargrove/Documents/MouseTrap/Server/`

## Quick Start

```bash
cd /Users/wadehargrove/Documents/MouseTrap/Server

# Run the comprehensive test
node test-tenant-creation.js

# Check database state
node check-tenants-db.js
```

## Test Files

### 1. test-tenant-creation.js
**Comprehensive automated test**

```bash
node test-tenant-creation.js
```

This test:
- Logs in as admin@mastertenant.com
- Decodes and displays JWT token
- Checks superadmin status
- Creates a new tenant via POST /api/tenants
- Tests from both localhost and dashboard IP
- Lists all tenants
- Provides a detailed summary

**Expected Output:**
- Login: SUCCESS
- Create Tenant: 201 Created
- List Tenants: Shows only Master Tenant (the bug)

---

### 2. check-tenants-db.js
**Database verification script**

```bash
node check-tenants-db.js
```

This script:
- Lists all tenants in the database
- Lists all user-tenant memberships
- Checks if admin user is a superadmin

**What to look for:**
- Newly created tenants in the tenants table
- Missing memberships for those tenants

---

### 3. test-browser-simulation.html
**Interactive browser-based test**

```bash
# Serve the file with a simple HTTP server
open test-browser-simulation.html
# or
python3 -m http.server 8080
# then open http://localhost:8080/test-browser-simulation.html
```

This provides:
- Interactive UI to test from a browser
- Checks localStorage for auth tokens
- Step-by-step testing with visual feedback
- Full request/response inspection
- CORS header checking

**How to use:**
1. Open in browser
2. Click "Login" to get auth token
3. Click "Check Superadmin Status"
4. Enter a tenant name and click "Create Tenant"
5. Click "List All Tenants" to see what's visible

---

## Documentation Files

### TENANT-CREATION-SUMMARY.txt
Quick reference guide with all key findings

```bash
cat TENANT-CREATION-SUMMARY.txt
```

### TENANT-CREATION-TEST-REPORT.md
Detailed test report with complete analysis

```bash
cat TENANT-CREATION-TEST-REPORT.md
```

### TENANT-CREATION-FLOW-DIAGRAM.txt
Visual flow diagrams showing the bug and the fix

```bash
cat TENANT-CREATION-FLOW-DIAGRAM.txt
```

---

## Testing from the Dashboard

If you want to test from the actual dashboard:

1. Navigate to http://192.168.133.110:5173
2. Login as admin@mastertenant.com
3. Open browser DevTools (F12)
4. Go to Network tab
5. Try to create a tenant
6. Watch the POST /api/tenants request
7. Check the response (should be 201)
8. Notice the tenant doesn't appear in the list

---

## Verifying the Fix

After implementing the fix in `/Users/wadehargrove/Documents/MouseTrap/Server/src/routes/tenants.routes.ts`:

```bash
# Restart the server
# Then run the test again
node test-tenant-creation.js
```

**Expected results after fix:**
- Login: SUCCESS
- Create Tenant: 201 Created
- List Tenants: **Should include the newly created tenant**

---

## The Issue in a Nutshell

```
POST /api/tenants
  → Creates tenant in tenants table ✓
  → Returns 201 Created ✓
  → Does NOT create user_tenant_membership ✗

GET /api/tenants
  → Filters by user_tenant_memberships
  → New tenant has no membership
  → New tenant not in results ✗
```

**Fix:** Add one INSERT statement to create the membership when creating the tenant.

---

## All Test Commands

```bash
# Change to server directory
cd /Users/wadehargrove/Documents/MouseTrap/Server

# Run comprehensive test
node test-tenant-creation.js

# Check database state
node check-tenants-db.js

# View summary
cat TENANT-CREATION-SUMMARY.txt

# View detailed report
cat TENANT-CREATION-TEST-REPORT.md

# View flow diagram
cat TENANT-CREATION-FLOW-DIAGRAM.txt

# Open browser test tool
open test-browser-simulation.html
```

---

## Server Health Check

Before running tests, verify the server is healthy:

```bash
curl http://localhost:4000/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "mqtt": "connected",
  "timestamp": "2025-11-19T00:29:40.067Z"
}
```

---

## Environment

- **Server:** http://localhost:4000
- **Dashboard:** http://192.168.133.110:5173
- **Database:** PostgreSQL (mousetrap_monitor)
- **Test User:** admin@mastertenant.com
- **Password:** Admin123!
