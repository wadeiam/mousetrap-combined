# Login API Troubleshooting Guide

## Issue Summary

The login API at `http://192.168.133.110:4000/api/auth/login` was returning "Internal server error" when attempting to authenticate with:
- Email: `admin@mastertenant.com`
- Password: `Admin123!`

## Root Cause

The issue was **NOT** with the server, database, or authentication logic. The problem was with how the API request was being sent via curl.

### The Problem

When using curl with the password `Admin123!`, the exclamation mark (`!`) was being escaped by the shell, resulting in invalid JSON:

```bash
# INCORRECT - This fails with "Bad escaped character in JSON"
curl -X POST http://192.168.133.110:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mastertenant.com","password":"Admin123!"}'
```

The server received: `{"email":"admin@mastertenant.com","password":"Admin123\\!"}`

The `\\!` is not valid JSON, causing the body-parser middleware to throw a `SyntaxError: Bad escaped character in JSON at position 55`.

## Verification Results

✅ **Database Connection**: Working correctly
✅ **Users Table**: Exists with proper schema
✅ **Admin User**: Exists and is active
✅ **Password Hash**: Valid and matches `Admin123!`
✅ **Authentication Logic**: Working correctly
✅ **JWT Generation**: Working correctly

## Solutions

### Method 1: Use Double Quotes with Escaped Characters (Recommended for inline JSON)

```bash
curl -X POST http://192.168.133.110:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@mastertenant.com\",\"password\":\"Admin123!\"}"
```

### Method 2: Use a JSON File (Most Reliable)

```bash
# Create JSON file
cat > login-payload.json << 'EOF'
{
  "email": "admin@mastertenant.com",
  "password": "Admin123!"
}
EOF

# Send request
curl -X POST http://192.168.133.110:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d @login-payload.json
```

### Method 3: Disable History Expansion

```bash
# Temporarily disable history expansion
set +H

curl -X POST http://192.168.133.110:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mastertenant.com","password":"Admin123!"}'

# Re-enable history expansion
set -H
```

## Successful Response

When the request is formatted correctly, you will receive:

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "10000000-0000-0000-0000-000000000001",
      "email": "admin@mastertenant.com",
      "role": "admin",
      "tenantId": "00000000-0000-0000-0000-000000000001",
      "tenantName": "Master Tenant",
      "twoFactorEnabled": false
    }
  }
}
```

## Server Error Logs

The error logs showed:

```
[2025-11-11T16:55:11.381Z] [ERROR] Unhandled error in request
{"error":"Bad escaped character in JSON at position 55 (line 1 column 56)"}
body: '{"email":"admin@mastertenant.com","password":"Admin123\\!"}'
```

This clearly indicated the issue was with the JSON payload, not the server logic.

## Database Configuration

The server is correctly configured to connect to:
- Host: `localhost`
- Port: `5432`
- Database: `mousetrap_monitor`
- User: `postgres`
- Password: `postgres123` (from .env file)

## Admin User Details

The admin user in the database:
- ID: `10000000-0000-0000-0000-000000000001`
- Email: `admin@mastertenant.com`
- Role: `admin`
- Tenant: `Master Tenant` (ID: `00000000-0000-0000-0000-000000000001`)
- Active: `true`
- 2FA Enabled: `false`
- Password: `Admin123!` (bcrypt hash: `$2a$10$N9qo8uLOickgx2ZMRZoMye1XvnPTW3lxN47fRNz/9jW4Bkh/7d3/C`)

## Conclusion

**No code changes were required.** The authentication system is working correctly. The issue was entirely due to shell escaping in the curl command. Use one of the recommended methods above to properly send API requests with special characters in JSON payloads.

## Testing Scripts

Test scripts have been created to verify the login functionality:

1. `/Users/wadehargrove/Documents/server-deployment/server/test-db-connection.js` - Tests database connectivity and user existence
2. `/Users/wadehargrove/Documents/server-deployment/server/test-login-flow.js` - Simulates the complete login flow

Run these with:
```bash
cd /Users/wadehargrove/Documents/server-deployment/server
node test-db-connection.js
node test-login-flow.js
```
