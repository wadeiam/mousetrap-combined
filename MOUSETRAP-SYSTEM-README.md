# MouseTrap IoT System Documentation

> **NOTE:** For session handoffs and operational info, see [HANDOFF.md](./HANDOFF.md).
> For documentation navigation, see [DOCUMENTATION-SYSTEM-GUIDE.md](./DOCUMENTATION-SYSTEM-GUIDE.md).

**Multi-tenant IoT device management platform**
**Last Updated:** 2025-11-16

---

## Quick Start

### Compile & Deploy Firmware
```bash
cd /Users/wadehargrove/Documents/MouseTrap/Arduino
make compile
curl -u "ops:changeme" -F "file=@build/mousetrap_arduino.ino.bin" http://192.168.133.46/uploadfw
```

### Deploy Server Updates
```bash
cd /Users/wadehargrove/Documents/MouseTrap/Server
./scripts/backup-database.sh
git pull && npm install && npm run build
pm2 restart server
```

### Check System Health
```bash
# Device
curl http://192.168.133.46/api/status

# Server
curl http://localhost:4000/health

# MQTT
tail -f /opt/homebrew/var/log/mosquitto.log
```

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     MouseTrap IoT System                      │
└──────────────────────────────────────────────────────────────┘

┌─────────────────┐         MQTT          ┌──────────────┐
│  ESP32 Devices  │◄─────────────────────►│  Mosquitto   │
│   (Firmware)    │    Port 1883          │   Broker     │
│                 │                        │              │
│ • Camera (OV26) │                        │ • Password   │
│ • ToF Sensor    │                        │   Auth       │
│ • Servo Control │                        │ • Retained   │
│ • Local SPA     │                        │   Messages   │
└─────────────────┘                        └──────────────┘
         │                                          │
         │ HTTP (Device API)                        │ MQTT
         │                                          │
         ▼                                          ▼
┌─────────────────┐                        ┌──────────────┐
│  Device SPA     │                        │   Server     │
│  (Svelte)       │◄──────────────────────►│  (Node.js)   │
│                 │    HTTP (Server API)   │              │
│ • Dashboard     │                        │ • REST API   │
│ • Settings      │                        │ • MQTT       │
│ • Calibration   │                        │ • Auth       │
│ • OTA Updates   │                        │ • Multi-Tenant│
└─────────────────┘                        └──────────────┘
                                                   │
                                                   │ SQL
                                                   ▼
                                           ┌──────────────┐
                                           │  PostgreSQL  │
                                           │   Database   │
                                           │              │
                                           │ • Devices    │
                                           │ • Users      │
                                           │ • Firmware   │
                                           │ • Alerts     │
                                           └──────────────┘
                                                   │
                                                   │ HTTP
                                                   ▼
                                           ┌──────────────┐
                                           │  Dashboard   │
                                           │   (React)    │
                                           │              │
                                           │ • Vite       │
                                           │ • React Query│
                                           │ • TypeScript │
                                           └──────────────┘
```

---

## When to Read Which Doc

**Use this table to quickly find the documentation you need:**

### Firmware Tasks

| Task | Read This Doc |
|------|---------------|
| Starting new session | [MOUSETRAP-SYSTEM-HANDOFF.md](./MOUSETRAP-SYSTEM-HANDOFF.md) |
| Compiling firmware | `Arduino/docs/FIRMWARE-COMPILATION.md` |
| Deploying firmware OTA | `Arduino/docs/OTA-DEPLOYMENT.md` |
| Working on device SPA | `Arduino/docs/SPA-DEVELOPMENT.md` |
| Device API endpoints | `Arduino/docs/DEVICE-API.md` |
| Device claiming (firmware) | `Arduino/docs/DEVICE-CLAIMING.md` |
| ESP32-S3 board config | `Arduino/docs/BOARD-SETTINGS.md` |
| Debug tools & dashboard | `Arduino/docs/DEBUG-TOOLS.md` |
| Device troubleshooting | `Arduino/docs/TROUBLESHOOTING.md` |

### Server Tasks

| Task | Read This Doc |
|------|---------------|
| Starting new session | [MOUSETRAP-SYSTEM-HANDOFF.md](./MOUSETRAP-SYSTEM-HANDOFF.md) |
| Deploying server updates | `Server/docs/DEPLOYMENT.md` |
| Server API endpoints | `Server/docs/API-REFERENCE.md` |
| MQTT/Mosquitto setup | `Server/docs/MQTT-SETUP.md` |
| Database schema & migrations | `Server/docs/DATABASE-SCHEMA.md` |
| Claim code management | `Server/docs/CLAIM-CODES.md` |
| Device revocation system | `Server/DEVICE-REVOCATION-IMPLEMENTATION.md` |
| Testing procedures | `Server/docs/TESTING.md` |
| Server troubleshooting | `Server/docs/TROUBLESHOOTING.md` |

### Cross-Project Tasks

| Task | Read These Docs |
|------|-----------------|
| **Device claiming (NEW captive portal flow)** | **[DEVICE-CLAIMING-FLOW.md](./DEVICE-CLAIMING-FLOW.md)** |
| Device claiming (legacy manual flow) | Firmware `DEVICE-CLAIMING.md` + Server `CLAIM-CODES.md` |
| Device revocation (full flow) | Server `DEVICE-REVOCATION-IMPLEMENTATION.md` + Firmware source |
| MQTT troubleshooting | Server `MQTT-SETUP.md` + Firmware `TROUBLESHOOTING.md` |
| OTA deployment (full flow) | Firmware `OTA-DEPLOYMENT.md` + Server `API-REFERENCE.md` |
| Alert system | Firmware `DEVICE-API.md` + Server `API-REFERENCE.md` |

---

## File Structure

### Firmware Project
```
/Users/wadehargrove/Documents/MouseTrap/Arduino/
├── mousetrap_arduino.ino        # Main firmware source
├── partitions.csv               # Partition table (DO NOT MODIFY)
├── Makefile                     # Build automation
│
├── build/                       # Compiled binaries
│   ├── mousetrap_arduino.ino.bin
│   └── littlefs.bin
│
├── data/                        # LittleFS filesystem data
│   └── app/                     # Svelte SPA files
│
├── trap-spa/                    # Svelte SPA source
│   ├── src/
│   ├── dist/                    # Built SPA
│   └── package.json
│
└── docs/                        # Modular documentation
    ├── FIRMWARE-COMPILATION.md
    ├── OTA-DEPLOYMENT.md
    ├── SPA-DEVELOPMENT.md
    ├── DEVICE-API.md
    ├── DEVICE-CLAIMING.md
    ├── BOARD-SETTINGS.md
    ├── DEBUG-TOOLS.md
    └── TROUBLESHOOTING.md
```

### Server Project
```
/Users/wadehargrove/Documents/MouseTrap/Server/
├── src/                         # TypeScript source
│   ├── routes/                  # API route handlers
│   ├── services/                # Business logic (MQTT, etc.)
│   ├── middleware/              # Auth, validation
│   └── utils/                   # Helpers (mqtt-auth, etc.)
│
├── migrations/                  # Database migrations
├── scripts/                     # Deployment scripts
│   ├── backup-database.sh
│   ├── restore-database.sh
│   └── run-migrations.sh
│
├── dist/                        # Compiled JavaScript
│
├── docs/                        # Modular documentation
│   ├── DEPLOYMENT.md
│   ├── API-REFERENCE.md
│   ├── MQTT-SETUP.md
│   ├── DATABASE-SCHEMA.md
│   ├── CLAIM-CODES.md
│   ├── TESTING.md
│   └── TROUBLESHOOTING.md
│
└── DEVICE-REVOCATION-IMPLEMENTATION.md  # Device revocation system docs
```

### System-Level Documentation
```
/Users/wadehargrove/Documents/MouseTrap/
├── MOUSETRAP-SYSTEM-HANDOFF.md      # THIS IS READ FIRST
├── MOUSETRAP-SYSTEM-README.md       # This file - complete index
├── SESSION-HANDOFF-TEMPLATE.md      # Template for handoff summaries
├── DOCUMENTATION-SYSTEM-GUIDE.md    # How the doc system works
│
├── Arduino/                          # Firmware project
└── Server/                           # Server project
```

---

## Technology Stack

### Firmware (ESP32-S3)
- **Language:** C++ (Arduino framework)
- **Board:** ESP32-S3 with 16MB Flash, 8MB PSRAM
- **Camera:** OV2640 (2MP)
- **Sensor:** VL6180X ToF
- **Filesystem:** LittleFS (10.875MB partition)
- **OTA:** Dual app partitions (app0/app1)
- **Local UI:** Svelte SPA served from LittleFS

### Server (Node.js)
- **Language:** TypeScript
- **Runtime:** Node.js
- **Framework:** Express
- **Database:** PostgreSQL with migrations
- **MQTT:** Mosquitto broker
- **Process Manager:** PM2
- **Auth:** JWT with multi-tenancy

### Dashboard (React)
- **Language:** TypeScript
- **Framework:** React
- **Build Tool:** Vite
- **State:** React Query
- **Location:** `MouseTrap/Server/trap-dashboard/` (if exists, otherwise separate deployment)

### MQTT Broker
- **Software:** Mosquitto
- **Install:** Homebrew on macOS
- **Port:** 1883
- **Auth:** Password-based, no anonymous

---

## System Credentials

### Dashboard (React)
- **URL:** http://192.168.133.110:5173
- **Email:** admin@mastertenant.com
- **Password:** Admin123!

### Device Access
- **Web UI:** http://192.168.133.46/app/
- **Debug:** http://192.168.133.46/debug
- **Username:** ops
- **Password:** changeme

### Database
- **Host:** localhost
- **Port:** 5432
- **Database:** mousetrap_db
- **User:** wadehargrove
- **Command:** `psql -U wadehargrove -d mousetrap_db`

### MQTT Broker
- **Host:** 192.168.133.110
- **Port:** 1883
- **Client:** mqtt_client
- **Password:** mqtt_password123
- **Config:** `/opt/homebrew/etc/mosquitto/mosquitto.conf`
- **Passwords:** `/opt/homebrew/etc/mosquitto/passwd`
- **Logs:** `/opt/homebrew/var/log/mosquitto.log`

---

## Device Information

### Kitchen Device (ESP32-S3)
- **IP:** 192.168.133.46
- **MAC:** 94A990306028
- **Status:** Claimed to Master Tenant
- **Firmware:** v1.3.7
- **SPA:** v2.0.39+

### Biggy Device
- **MAC:** (TBD)
- **IP:** (TBD)
- **Status:** (TBD)

---

## Critical Warnings

### ⚠️ DO NOT MODIFY
- **`partitions.csv`** - User manages, can brick devices
- **Mosquitto config** - Changes require restart

### ⚠️ ALWAYS BACKUP FIRST
```bash
# Before server updates
cd /Users/wadehargrove/Documents/MouseTrap/Server
./scripts/backup-database.sh
```

### ⚠️ COMPILATION COMMAND
```bash
# CORRECT
make compile

# WRONG - Don't use
arduino-cli compile --fqbn esp32:esp32:esp32cam
```

### ⚠️ VERSION MANAGEMENT
- Firmware version must match dashboard upload version
- Never read version.json after OTA (use NVS Preferences)
- Filesystem OTA may cause device unclaim (known issue)

---

## Common Command Reference

### Firmware
```bash
# Compile
cd /Users/wadehargrove/Documents/MouseTrap/Arduino
make compile

# Deploy firmware
curl -u "ops:changeme" -F "file=@build/mousetrap_arduino.ino.bin" http://192.168.133.46/uploadfw

# Build & deploy SPA
./build-littlefs.sh
curl -u "ops:changeme" -F "file=@build/littlefs.bin" http://192.168.133.46/uploadfs

# View logs
curl -u "ops:changeme" http://192.168.133.46/api/system-logs
```

### Server
```bash
# Manage server
pm2 restart server
pm2 logs server
pm2 status

# Database
./scripts/backup-database.sh
npm run migrate:up
psql -U wadehargrove -d mousetrap_db

# Build
npm run build
```

### MQTT
```bash
# Control mosquitto
brew services restart mosquitto
brew services list | grep mosquitto

# View logs
tail -f /opt/homebrew/var/log/mosquitto.log

# Add device credentials
mosquitto_passwd -b /opt/homebrew/etc/mosquitto/passwd <MAC> <PASSWORD>
```

---

## Support & Troubleshooting

### Where to Get Help

**For device issues:**
1. Check device debug dashboard: http://192.168.133.46/debug
2. Review device logs: `curl -u ops:changeme http://192.168.133.46/api/system-logs`
3. See: `Arduino/docs/TROUBLESHOOTING.md`

**For server issues:**
1. Check server logs: `pm2 logs server`
2. Check database: `psql -U wadehargrove -d mousetrap_db`
3. See: `Server/docs/TROUBLESHOOTING.md`

**For MQTT issues:**
1. Check Mosquitto logs: `tail -f /opt/homebrew/var/log/mosquitto.log`
2. Look for CONNACK code 5 (authentication failure)
3. See: `Server/docs/MQTT-SETUP.md` (has complete CONNACK code 5 troubleshooting)

**For cross-project issues:**
1. Read system handoff: [MOUSETRAP-SYSTEM-HANDOFF.md](./MOUSETRAP-SYSTEM-HANDOFF.md)
2. Check "Cross-Project Issues" section
3. Read relevant docs from both projects

---

## Development Workflow

### Working on Firmware
1. Read: [MOUSETRAP-SYSTEM-HANDOFF.md](./MOUSETRAP-SYSTEM-HANDOFF.md)
2. Navigate to task via this README
3. Read only needed firmware docs
4. Make changes, compile, deploy
5. Update handoff if significant work done

### Working on Server
1. Read: [MOUSETRAP-SYSTEM-HANDOFF.md](./MOUSETRAP-SYSTEM-HANDOFF.md)
2. Navigate to task via this README
3. Read only needed server docs
4. Make changes, test, deploy
5. Update handoff if significant work done

### Working on Integration
1. Read: [MOUSETRAP-SYSTEM-HANDOFF.md](./MOUSETRAP-SYSTEM-HANDOFF.md)
2. Identify both firmware and server components
3. Read relevant docs from both projects
4. Make coordinated changes
5. Test end-to-end
6. Update handoff with integration notes

---

## Next Steps

**For new sessions:**
1. Read [MOUSETRAP-SYSTEM-HANDOFF.md](./MOUSETRAP-SYSTEM-HANDOFF.md) first
2. Use this README to navigate to specific docs
3. Read only what you need for your task

**For ending sessions:**
1. Use [SESSION-HANDOFF-TEMPLATE.md](./SESSION-HANDOFF-TEMPLATE.md)
2. Update [MOUSETRAP-SYSTEM-HANDOFF.md](./MOUSETRAP-SYSTEM-HANDOFF.md) if significant work done
3. Include meta-directive in handoff summary

---

**Project Type:** Multi-tenant IoT device management platform
**Components:** ESP32 firmware, Node.js server, React dashboard, PostgreSQL database, Mosquitto MQTT broker
