# MouseTrap Project - Claude Code Instructions

## Quick Directives

| Directive | Meaning |
|-----------|---------|
| `pics` | Look at the most recent image files on Desktop to see screenshots of the current issue(s) |

## FIRST STEP FOR EVERY SESSION

**Before doing any work, read `/Users/wadehargrove/Documents/MouseTrap/Server/HANDOFF.md`**

This document contains:
- Critical warnings that prevent bricking devices
- Current operational commands and credentials
- Latest session state and pending tasks
- Known issues and gotchas

## Documentation Responsibility

You are responsible for maintaining all project documentation:
- Update relevant `.md` files when you modify any component
- Update HANDOFF.md at the end of each session with significant changes
- See HANDOFF.md "Documentation Links" section for the full documentation structure

## Key Locations

- **Server:** `/Volumes/External2TB/Documents/MouseTrap/Server/`
- **Trap Firmware:** `/Volumes/External2TB/Documents/MouseTrap/mousetrap_arduino/`
- **Scout Firmware:** `/Volumes/External2TB/Documents/MouseTrap/scout_arduino/`
- **Dashboard:** `/Volumes/External2TB/Documents/server-deployment/trap-dashboard/`
- **Mobile App:** `/Volumes/External2TB/Documents/MouseTrap/mobile-app/`
- **Trap SPA:** `/Volumes/External2TB/Documents/MouseTrap/mousetrap_arduino/trap-spa/`
- **Scout SPA:** `/Volumes/External2TB/Documents/MouseTrap/scout_arduino/scout-spa/`

## How to Start Services

```bash
# MQTT Broker (Docker)
cd /Volumes/External2TB/Documents/MouseTrap/Server && docker compose up -d mosquitto

# API Server (PM2)
pm2 start /Volumes/External2TB/Documents/MouseTrap/Server/dist/server.js --name mqtt-server

# Dashboard (PM2)
cd /Volumes/External2TB/Documents/server-deployment/trap-dashboard && pm2 start "npx vite --host 0.0.0.0" --name trap-dashboard

# Classification Service (Docker)
cd /Volumes/External2TB/Documents/MouseTrap/classification-service && docker compose up -d

# Save PM2 so services survive reboot
pm2 save
```

## Network Info

| Service | Port | URL |
|---------|------|-----|
| API Server | 4000 | http://mtmon.wadehargrove.com:4000 |
| Dashboard | 5173 | http://mtmon.wadehargrove.com:5173 |
| MQTT Broker | 1883 | mqtt://mtmon.wadehargrove.com:1883 |
| Classification | 3100 | http://localhost:3100 |

**Mac WiFi IP:** 10.0.0.220 (DHCP reservation set)
**DNS:** mtmon.wadehargrove.com → 76.132.161.59 (public IP, port-forwarded to Mac)
