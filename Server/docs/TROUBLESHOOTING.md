# Server Troubleshooting Guide

**Common issues and solutions**

---

## Server Won't Start

### Check PM2 Status
```bash
pm2 status
pm2 logs server
```

### Common Causes
1. **Port 4000 already in use**
   ```bash
   lsof -i :4000
   kill <PID>
   ```

2. **Database not running**
   ```bash
   brew services start postgresql
   ```

3. **Environment variables missing**
   - Check `.env` file exists
   - Verify all required vars present

---

## Database Issues

### Can't Connect to Database
```bash
# Check PostgreSQL running
brew services list | grep postgresql

# Start if needed
brew services start postgresql

# Test connection
psql -U wadehargrove -d mousetrap_db
```

### Migration Failures
```bash
# Check current migration version
psql -U wadehargrove -d mousetrap_db -c "SELECT * FROM schema_migrations;"

# Rollback and retry
npm run migrate:down
npm run migrate:up
```

---

## MQTT Issues

### Devices Can't Connect (rc=5)
**See [MQTT-SETUP.md](./MQTT-SETUP.md)** for complete CONNACK code 5 troubleshooting.

Quick fix:
```bash
# Update password file
mosquitto_passwd -b /opt/homebrew/etc/mosquitto/passwd <MAC> <PASSWORD>

# Restart mosquitto
brew services restart mosquitto
```

### Mosquitto Not Running
```bash
brew services start mosquitto
tail -f /opt/homebrew/var/log/mosquitto.log
```

---

## API Issues

### 401 Unauthorized
- JWT token expired - login again
- Wrong credentials
- User not in correct tenant

### 500 Internal Server Error
```bash
# Check server logs
pm2 logs server

# Check database connection
psql -U wadehargrove -d mousetrap_db
```

### CORS Errors
- Check `API_BASE_URL` in `.env`
- Must use actual IP, not `localhost`
- Frontend must match server URL

---

## Dashboard Issues

### Login Fails
1. Check server running: `pm2 status`
2. Verify credentials: `admin@mastertenant.com` / `Admin123!`
3. Check server logs: `pm2 logs server`
4. See [LOGIN_API_TROUBLESHOOTING.md](../LOGIN_API_TROUBLESHOOTING.md)

### Devices Not Showing
1. Check device claimed
2. Verify tenant_id matches
3. Check `unclaimed_at IS NULL` filter

---

## Deployment Issues

### Build Fails
```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

### PM2 Won't Restart
```bash
pm2 delete server
pm2 start ecosystem.config.js
```

---

**Related:** [MQTT-SETUP.md](./MQTT-SETUP.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [DATABASE-SCHEMA.md](./DATABASE-SCHEMA.md)
