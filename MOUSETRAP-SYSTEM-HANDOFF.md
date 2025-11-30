# MouseTrap Session Handoff

**Last Updated:** 2025-11-30
**Latest Session:** Dashboard device settings fix & location display

---

## READ THIS FIRST

**IMPORTANT FOR NEW SESSIONS:** Always read this entire document before beginning any work. This document contains critical information that prevents costly mistakes.

**AI ASSISTANTS:** You are responsible for maintaining all project documentation. When you make changes to any component, update the corresponding `.md` file in the relevant `docs/` folder. Update this HANDOFF.md at the end of each session with significant changes. See "End of Session Checklist" and "Documentation Links" below for the full documentation structure.

This is the primary handoff document for MouseTrap development sessions. It contains:
1. **Persistent operational info** - Commands, credentials, critical warnings
2. **Current session state** - Latest work and pending tasks
3. **Links to detailed documentation** - For specific topics

**For documentation navigation:** See [DOCUMENTATION-SYSTEM-GUIDE.md](./DOCUMENTATION-SYSTEM-GUIDE.md)

---

## CRITICAL WARNINGS

### DO NOT MODIFY `partitions.csv`
- User manages this file
- Modifying can brick devices
- Requires USB access to recover

### ALWAYS USE MAKEFILE FOR COMPILATION
```bash
cd /Users/wadehargrove/Documents/MouseTrap/mousetrap_arduino
make compile    # Compiles with correct ESP32-S3 board
make build-fs   # Builds LittleFS from trap-spa
```

**Output location:** `build/mousetrap_arduino.ino.bin` and `build/littlefs.bin`

### NEVER USE WRONG BOARD
```bash
# WRONG - DO NOT USE - causes OTA failures and wrong binary format!
arduino-cli compile --fqbn esp32:esp32:esp32cam   # <-- WRONG BOARD

# This is the production device board (ESP32-S3, 16MB flash, PSRAM)
# Only the Makefile knows the correct FQBN - always use `make compile`
```

### LITTLEFS OFFSET IS 0x510000
- Always use `make upload-fs` for filesystem uploads
- DO NOT use 0x370000 or any other address

---

## Persistent Operational Info

### Firmware Compilation

**Correct FQBN:**
```
esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc
```

**Commands:**
```bash
cd /Users/wadehargrove/Documents/MouseTrap/mousetrap_arduino

# Compile firmware (outputs to build/mousetrap_arduino.ino.bin)
make compile

# Upload firmware via serial (auto-detect port, 921600 baud)
make upload

# Upload with lower baud rate (more reliable)
arduino-cli upload -p /dev/cu.usbserial-10 --fqbn "esp32:esp32:esp32s3:..." -UploadSpeed=115200 .

# Deploy firmware OTA (ALWAYS use build/ folder)
curl -u "ops:changeme" -F "file=@build/mousetrap_arduino.ino.bin" http://192.168.133.46/update
```

### Serial Monitoring

**Baud Rate:** 115200

```bash
# Via Makefile
make monitor

# Via arduino-cli
arduino-cli monitor -p /dev/cu.usbserial-10 -c baudrate=115200
```

### LittleFS (SPA) Deployment

```bash
# Build LittleFS image from trap-spa
make build-fs

# Upload to device via serial at 0x510000
make upload-fs

# Build and upload in one command
make deploy-fs

# Deploy firmware + LittleFS together
make deploy-all

# OTA upload
curl -u "ops:changeme" -F "file=@build/littlefs.bin" http://192.168.133.46/uploadfs
```

### Device Access Credentials

| Resource | Username | Password |
|----------|----------|----------|
| Device OTA/API | ops | changeme |
| Dashboard | admin@mastertenant.com | Admin123! |
| MQTT Client | mqtt_client | mqtt_password123 |

### Network Addresses

| Resource | Address |
|----------|---------|
| Server API | http://192.168.133.110:4000 |
| Dashboard | http://192.168.133.110:5173 |
| MQTT Broker | 192.168.133.110:1883 |
| Kitchen Device | 192.168.133.46 |
| Biggy Device Serial | /dev/cu.usbserial-10 |

### Database

```bash
# Connect to database (NOTE: actual db name is mousetrap_monitor)
/opt/homebrew/opt/postgresql@15/bin/psql -U wadehargrove -d mousetrap_monitor

# Backup before changes
cd /Users/wadehargrove/Documents/MouseTrap/Server
./scripts/backup-database.sh
```

### Server Management

```bash
# Restart server
pm2 restart mqtt-server

# View logs
pm2 logs mqtt-server

# Rebuild after changes
cd /Users/wadehargrove/Documents/MouseTrap/Server
npm run build
pm2 restart mqtt-server
```

### MQTT (Mosquitto)

**Current Mode:** Dynamic Security (Docker)

```bash
# Restart broker
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml restart mosquitto

# View logs
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml logs -f mosquitto

# Config files
/Users/wadehargrove/Documents/MouseTrap/Server/mosquitto/config/mosquitto.conf
/Users/wadehargrove/Documents/MouseTrap/Server/mosquitto/config/dynamic-security.json
```

**Dynamic Security Credentials:**
| User | Role | Purpose |
|------|------|---------|
| server_admin | admin | Manage credentials via `$CONTROL/dynamic-security/#` |
| mqtt_client | server | Server pub/sub to all topics |
| {MAC_ADDRESS} | device | Device pub/sub to `tenant/#` and `global/#` |

**Fallback to Homebrew (if needed):**
```bash
# Stop Docker, start Homebrew
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml down
brew services start mosquitto

# Update .env: MQTT_AUTH_MODE=password_file
# Rebuild and restart server
```

---

## System Architecture

```
+------------------+      MQTT (1883)      +---------------+
|  ESP32 Devices   |<-------------------->|   Mosquitto   |
|  (Firmware)      |                       |   Broker      |
+------------------+                       +---------------+
         |                                         |
         | HTTP API                                | MQTT
         v                                         v
+------------------+                       +---------------+
|  Device SPA      |                       |   Server      |
|  (Svelte)        |<--------------------->|   (Node.js)   |
+------------------+      HTTP API         +---------------+
                                                   |
                                                   v
                                           +---------------+
                                           |  PostgreSQL   |
                                           +---------------+
                                                   ^
                                                   |
                                           +-------+-------+
                                           |               |
                                   +---------------+  +---------------+
                                   |  Dashboard    |  |  Mobile App   |
                                   |  (React)      |  |(React Native) |
                                   +---------------+  +---------------+
                                                              |
                                                              v
                                                      +---------------+
                                                      |  Expo Push    |
                                                      | Notifications |
                                                      +---------------+
```

### Multi-Tenant Access Model

| Role | Scope | Access |
|------|-------|--------|
| **superadmin** | Master Tenant | Implicit access to ALL tenants and devices |
| **admin** | Specific tenant | Full access within their tenant |
| **operator** | Specific tenant | Device management within tenant |
| **viewer** | Specific tenant | Read-only access within tenant |

- Superadmin status is determined by `role = 'superadmin'` membership in Master Tenant (`00000000-0000-0000-0000-000000000001`)
- Superadmins do NOT appear in other tenants' user lists
- Regular users require explicit `user_tenant_memberships` records

---

## Device Information

### Kitchen Device (Production)
- **IP:** 192.168.133.46
- **MAC:** 94A990306028
- **Status:** Claimed to Master Tenant
- **Firmware:** v1.3.7
- **Credentials:** ops:changeme

### Biggy Device (Development)
- **MAC:** D0CF13155060
- **Serial Port:** /dev/cu.usbserial-10
- **Status:** Development/testing device
- **AP SSID (unclaimed):** MouseTrap-5060

---

## Mobile App

### Location
`/Users/wadehargrove/Documents/MouseTrap/mobile-app/`

### Technology Stack
- **Framework:** React Native with Expo SDK 54
- **Architecture:** New Architecture enabled (Fabric + TurboModules)
- **Language:** TypeScript
- **Navigation:** React Navigation (tabs)
- **Build System:** EAS Build
- **Push Notifications:** expo-notifications

### Quick Start

```bash
# Install dependencies
cd /Users/wadehargrove/Documents/MouseTrap/mobile-app
npm install

# Start development server
npx expo start

# Options:
# - Press 'i' for iOS simulator
# - Press 'a' for Android emulator
# - Scan QR code with Expo Go for quick testing
```

### Current Status

**Working in Expo Go:**
- Login with MouseTrap credentials
- Device list with status, battery, trap state
- Alerts screen with acknowledge/resolve actions
- Settings screen with notification preferences
- Dark theme matching brand colors (#1a1a2e)

**Requires Dev Build (not in Expo Go):**
- Push notifications (uses native modules)
- Full notification registration flow

### Key Features

1. **Authentication**
   - Login with existing MouseTrap server credentials
   - JWT token storage in SecureStore
   - Auto-refresh on app launch

2. **Device Management**
   - Real-time device list with status badges (online/offline/alerting)
   - Battery level indicators
   - Trap state (set/triggered)
   - Device detail view with network info, uptime, firmware version
   - **Camera Snapshot Viewer** - Request and view snapshots from device cameras
   - **Clear Alerts** - Clear all alerts for a device, sends reset to hardware
   - **Test Alert** - Trigger test alert with full notification flow

3. **Alert Management**
   - Alert list grouped by device
   - Acknowledge and resolve actions
   - Alert type badges (motion/battery/offline)
   - Timestamp display

4. **Push Notifications**
   - Registration on login (if permissions granted)
   - Expo Push Notification tokens stored on server
   - Notification preferences (trap alerts, offline, battery)
   - Quiet hours support
   - Multi-device support per user

5. **Settings**
   - Notification preferences toggle
   - Quiet hours configuration
   - Logout

### Project Structure

```
mobile-app/
├── app.json                    # Expo config, app metadata
├── eas.json                    # EAS Build configuration
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── App.tsx                     # Root component
└── src/
    ├── navigation/
    │   └── AppNavigator.tsx    # Tab navigation setup
    ├── screens/
    │   ├── LoginScreen.tsx     # Login form
    │   ├── DevicesScreen.tsx   # Device list
    │   ├── DeviceDetailScreen.tsx  # Single device view
    │   ├── AlertsScreen.tsx    # Alerts list with actions
    │   └── SettingsScreen.tsx  # Notification preferences
    ├── context/
    │   └── AuthContext.tsx     # Auth state management
    ├── services/
    │   ├── api.ts              # API client with interceptors
    │   └── notifications.ts    # Expo push notification service
    └── types/
        └── index.ts            # TypeScript definitions
```

### Important Files

| File | Purpose |
|------|---------|
| `app.json` | Expo configuration, app name, icons, splash screen |
| `eas.json` | EAS Build profiles for dev/preview/production |
| `src/services/api.ts` | Axios client, base URL, auth interceptors |
| `src/services/notifications.ts` | Push token registration, permission handling |
| `src/context/AuthContext.tsx` | Global auth state, login/logout logic |
| `src/navigation/AppNavigator.tsx` | Tab navigation, auth routing |

### Configuration

**API Base URL** (in `src/services/api.ts`):
```typescript
const API_BASE_URL = 'http://192.168.133.110:4000/api';
```

**Expo Project** (in `app.json`):
```json
{
  "expo": {
    "name": "MouseTrap",
    "slug": "mousetrap",
    "extra": {
      "eas": {
        "projectId": "YOUR_PROJECT_ID"  // To be configured
      }
    }
  }
}
```

### Next Steps

1. **Configure EAS Project**
   ```bash
   cd /Users/wadehargrove/Documents/MouseTrap/mobile-app
   eas init  # Creates project and sets projectId
   ```

2. **Build for Physical Devices**
   ```bash
   # iOS development build
   eas build --profile development --platform ios

   # Android development build
   eas build --profile development --platform android
   ```

3. **Test Push Notifications**
   - Install dev build on physical device
   - Login to trigger token registration
   - Create device alert to test notification delivery
   - Use server's `POST /api/push/test` endpoint for manual tests

4. **TestFlight and Play Store**
   ```bash
   # iOS preview build (for TestFlight)
   eas build --profile preview --platform ios
   eas submit --platform ios

   # Android preview build (for internal testing)
   eas build --profile preview --platform android
   eas submit --platform android
   ```

5. **Future Enhancements**
   - Pull-to-refresh on device and alert lists
   - Real-time updates via WebSocket
   - Trap arming/disarming controls
   - Multi-tenant support (if needed)

### Known Limitations

- Push notifications do NOT work in Expo Go (requires dev build)
- API base URL is hardcoded (consider environment variables for prod)
- No real-time updates (polling-based)
- No offline support

### Testing

**Without Dev Build (Expo Go):**
- Login and authentication
- Device list and detail screens
- Alert management (acknowledge/resolve)
- Settings UI
- Navigation flow

**Requires Dev Build:**
- Push notification registration
- Receiving push notifications
- Notification permission prompts

---

## Current Session Notes (2025-11-30)

### Latest Work: Dashboard Device Settings & Location Display

**Status:** Complete - Fixed location save and improved device detail page

**What Was Implemented:**

1. **Fixed Device Settings Location Save (devices.routes.ts)**
   - **Problem:** Location field in Device Settings wouldn't save for superadmins
   - **Cause:** PATCH `/devices/:id` filtered by `tenant_id = req.user.tenantId`
   - When superadmin (Master Tenant) edits device in a subtenant, tenant IDs don't match
   - **Fix:** Added superadmin bypass - superadmins can now update any device regardless of tenant
   - Same pattern already used in GET endpoint, now consistent across PATCH

2. **Location as Snapshot Card Title (DeviceDetail.tsx)**
   - Card now shows device location (e.g., "Loading Dock, Warehouse Floor") as title
   - Falls back to "Camera Snapshot" if no location is set
   - Encourages users to set meaningful locations for their devices

**Files Modified:**
- `Server/src/routes/devices.routes.ts` - Added superadmin handling to PATCH endpoint
- `trap-dashboard/src/pages/DeviceDetail.tsx` - Dynamic card title from device.location

---

### Previous Work: Mobile App Device Actions & Bug Fixes

**Status:** Complete - Clear Alerts and Test Alert buttons added to mobile app

**What Was Implemented:**

1. **Mobile App Device Actions (DeviceDetailScreen.tsx)**
   - Added "Actions" section at bottom of device detail screen
   - **Clear Alerts** button - Clears all active alerts for device, sends MQTT reset to device
   - **Test Alert** button - Creates test alert, sends push notifications and immediate email to emergency contacts
   - Confirmation dialogs before both actions
   - Loading states while actions in progress
   - Test Alert disabled when device offline

2. **Server Endpoints (devices.routes.ts)**
   - `POST /api/devices/:id/clear-alerts` - Clears alerts, sends `alert_reset` MQTT command
   - `POST /api/devices/:id/test-alert` - Creates test alert with full notification flow
   - Both endpoints support admin and superadmin roles
   - Superadmin can clear alerts for any device (cross-tenant)

3. **Fixed: Trap State Display ("? unknown")**
   - **Problem:** Mobile app showed "Trap: ? unknown" for all devices
   - **Cause:** Server wasn't returning `trapState` field
   - **Fix:** Added `trapState` computed field to device list and detail queries
   - Calculated as `triggered` (has unresolved alerts) or `set` (no alerts)

4. **Fixed: MQTT Alert Reset Not Reaching Device**
   - **Problem:** `alert_reset` command sent but device didn't reset
   - **Cause:** Command sent to `D0:CF:13:15:50:60` (mac_address with colons)
   - **Device subscribes to:** `D0CF13155060` (mqtt_client_id without colons)
   - **Fix:** Changed clear-alerts to query `mqtt_client_id` and use that for MQTT command

5. **Immediate Email on Alert Creation (mqtt.service.ts)**
   - Added `notifyEmergencyContactsImmediately()` method
   - When alert is created, immediately sends email to all emergency contacts
   - No longer requires waiting for escalation cron job

6. **Improved Logging (server.ts)**
   - Changed request logging from `req.path` to `req.originalUrl`
   - Now shows full API path for easier debugging

**Files Modified:**
- `mobile-app/src/screens/DeviceDetailScreen.tsx` - Added Actions section with buttons
- `mobile-app/src/services/api.ts` - Added `clearAlerts()` and `triggerTestAlert()` methods
- `Server/src/routes/devices.routes.ts` - Added endpoints, fixed trapState, fixed mqtt_client_id
- `Server/src/services/mqtt.service.ts` - Added immediate emergency contact notification
- `Server/src/server.ts` - Improved request logging

**API Methods Added (mobile-app/src/services/api.ts):**
```typescript
clearAlerts(deviceId: string): Promise<ApiResponse<{ message: string; clearedCount: number }>>
triggerTestAlert(deviceId: string): Promise<ApiResponse<{ alertId: string; message: string; deviceName: string }>>
```

---

## Previous Session Notes (2025-11-29)

### Previous Work: Escalating Notification System (Phase 4 - SMS/Email)

**Status:** Complete - SMS (Twilio) and Email (Nodemailer) integration for emergency contacts

**What Was Implemented:**

1. **SMS Service (`sms.service.ts`)**
   - Full Twilio SDK integration via `twilio` npm package
   - Rate limiting: Max 5 SMS per hour per phone number (prevents spam)
   - E.164 phone number formatting (auto-adds country code if missing)
   - `sendTrapAlert()` method with urgency levels:
     - L4: "URGENT MOUSETRAP ALERT"
     - L5: "EMERGENCY MOUSETRAP ALERT"
   - Personalized messages with contact name if provided
   - Singleton pattern with `initSmsService()` and `getSmsService()`

2. **Email Service (`email.service.ts`)**
   - Nodemailer SMTP integration
   - Rate limiting: Max 10 emails per hour per address
   - HTML and plain text email templates
   - Styled email with urgency colors (orange for L4, red for L5)
   - `sendTrapAlert()` method with:
     - Urgency prefix (emoji)
     - Device name and elapsed time
     - Contact personalization
     - Call-to-action messaging
   - Singleton pattern with `initEmailService()` and `getEmailService()`

3. **Escalation Service Updates (`escalation.service.ts`)**
   - Updated `sendSmsAlert()` to use real SMS service
   - Updated `sendEmailAlert()` to use real email service
   - Both methods now:
     - Check if service is configured before attempting send
     - Log success/failure with relevant details
     - Return true/false for contact notification tracking

4. **Server Initialization (`server.ts`)**
   - Added imports for SMS and email services
   - Services initialized at startup (after push service)
   - Console output shows if services are enabled or disabled

5. **Environment Variables (`.env.example`)**
   - Added Twilio configuration:
     - `TWILIO_ACCOUNT_SID`
     - `TWILIO_AUTH_TOKEN`
     - `TWILIO_PHONE_NUMBER`
   - Updated SMTP configuration:
     - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`
     - `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

**Files Created:**
- `Server/src/services/sms.service.ts` - Twilio SMS service
- `Server/src/services/email.service.ts` - Nodemailer email service

**Files Modified:**
- `Server/src/services/escalation.service.ts` - Integrated SMS/email services
- `Server/src/server.ts` - Initialize services at startup
- `Server/.env.example` - Added SMS and updated email config

**Dependencies Added:**
- `twilio` - Twilio SDK for SMS
- `nodemailer` - SMTP email sending
- `@types/nodemailer` - TypeScript types

**How Emergency Contact Escalation Works:**

1. When an alert reaches Level 4+ (CRITICAL or EMERGENCY)
2. Escalation service queries emergency contacts for that level
3. For each contact that hasn't been notified at this level:
   - **app_user**: Sends push notification to app user
   - **sms**: Calls SMS service → Twilio API → SMS to phone
   - **email**: Calls email service → SMTP → Email inbox
4. Contact is marked as notified at this level
5. Won't be re-notified unless alert escalates to higher level

**Rate Limiting:**
- SMS: Max 5 per hour per phone number (prevents Twilio cost explosion)
- Email: Max 10 per hour per address (prevents spam)
- Both services track sends in-memory with 1-hour rolling window

---

### Previous Work: Escalating Notification System (Phase 2 - Firmware)

**Status:** Complete - Device-side autonomous alert escalation with NVS persistence

**What Was Implemented:**

1. **Alert State Types (lines 444-507 in `mousetrap_arduino.ino`)**
   - `AlertLevel` enum: `ALERT_LEVEL_NONE` through `ALERT_LEVEL_5`
   - `AlertEscalationState` struct: tracks trigger time, level, server acknowledgment
   - `EscalationPreset` struct: timing thresholds for level transitions
   - 3 preset constants: `PRESET_RELAXED`, `PRESET_NORMAL`, `PRESET_AGGRESSIVE`

2. **Escalation Functions (lines 7086-7439)**
   - `saveAlertStateToNVS()` / `loadAlertStateFromNVS()` / `clearAlertStateFromNVS()` - NVS persistence
   - `calculateAlertLevel()` - Determines level based on elapsed minutes and active preset
   - `updateBuzzerForLevel()` - Buzzer patterns per level:
     - L1: Off
     - L2: 1 beep/minute (800Hz)
     - L3: 3 beeps/minute (1000Hz)
     - L4: Continuous short beeps every 2s (1200Hz)
     - L5: Warbling tone (alternating 1000/1500Hz)
   - `updateLEDForLevel()` - LED patterns per level:
     - L1: Solid red
     - L2: Slow blink (1Hz)
     - L3: Fast blink (2Hz)
     - L4: Rapid blink (4Hz)
     - L5: Solid with flash bursts
   - `updateAlertEscalation()` - Main state machine, called from loop()
   - `handleEscalationCommand()` - MQTT handler for preset/timing updates from server
   - `handleAlertClearCommand()` - MQTT handler for alert acknowledgment
   - `syncAlertStateWithServer()` - Syncs state after MQTT reconnect

3. **Integration Points**
   - `alertFunction()` now initializes escalation state when trap triggers (line 7073)
   - `setup()` calls `loadAlertStateFromNVS()` for power loss recovery (line 11710)
   - `loop()` calls `updateAlertEscalation()` every iteration (line 12837)
   - MQTT reconnect calls `syncAlertStateWithServer()` (line 2960)
   - MQTT commands: `alert_reset`, `alert_clear`, `escalation` (lines 2610-2615)

4. **MQTT Topics Added**
   - Device publishes: `tenant/{id}/device/{id}/escalation_update` (level changes)
   - Device publishes: `tenant/{id}/device/{id}/alert_sync` (reconnect sync)
   - Device publishes: `tenant/{id}/device/{id}/alert_cleared` (confirmation)
   - Server sends: `command/escalation` (preset changes, force level)
   - Server sends: `command/alert_clear` (acknowledge/resolve)

**Files Modified:**
- `mousetrap_arduino/mousetrap_arduino.ino` - Added entire escalation system

---

### Previous Work: Escalating Notification System (Phase 3 - Mobile App UI)

**Status:** Complete - Mobile app now has full escalation settings and emergency contacts management

**What Was Implemented:**

1. **Types (`types/index.ts`)**
   - Added `EscalationPreset` type (`'relaxed' | 'normal' | 'aggressive' | 'custom'`)
   - Added `CustomEscalation` interface for custom timing
   - Added `EscalationPresetConfig` for preset descriptions
   - Added `EmergencyContact` and `CreateEmergencyContact` interfaces
   - Added `EmergencyContactType` (`'app_user' | 'sms' | 'email'`)
   - Extended `NotificationPreferences` with escalation fields

2. **API Service (`services/api.ts`)**
   - `getEscalationPresets()` - Fetch available presets
   - `getEscalationSettings()` - Get user's escalation config
   - `updateEscalationSettings()` - Update preset, timing, DND override
   - `getEmergencyContacts()` - List user's emergency contacts
   - `addEmergencyContact()` - Add new contact (SMS, email, app user)
   - `updateEmergencyContact()` - Update existing contact
   - `deleteEmergencyContact()` - Remove contact

3. **Settings Screen (`screens/SettingsScreen.tsx`)**
   - **Alert Escalation Section:**
     - Escalation Speed selector (Relaxed, Normal, Aggressive, Custom)
     - Modal showing all presets with timing details (L2, L3, L4, L5)
     - DND Override toggle with warning modal
   - **Emergency Contacts Section:**
     - List of contacts with type icons (person, SMS, email)
     - Add Contact modal with type selector, value input, name, level
     - Delete contact with confirmation
     - Empty state when no contacts
   - **DND Warning Modal:**
     - Warning about mouse welfare (12h survival)
     - "Keep Enabled" (primary) and "Disable Anyway" (secondary) buttons

4. **Dependencies:**
   - Installed `@expo/vector-icons` for Ionicons

**Files Modified:**
- `mobile-app/src/types/index.ts` - Added escalation and contact types
- `mobile-app/src/services/api.ts` - Added escalation and contact API methods
- `mobile-app/src/screens/SettingsScreen.tsx` - Complete rewrite with escalation UI

---

### Previous Work: Escalating Notification System (Phase 1 - Server)

**Status:** Complete - Server infrastructure for escalating alerts based on mouse welfare timeline

**What Was Implemented:**

1. **Database Migration `013_escalation_system.sql`**
   - `emergency_contacts` table - SMS, email, app user contacts for emergency escalation
   - `alert_escalation_state` table - tracks escalation level, notification timing per alert
   - Added to `notification_preferences`: `escalation_preset`, `custom_escalation`, `critical_override_dnd`, `dnd_override_acknowledged`
   - Added `escalation_level` and `contact_type` columns to `notification_log`

2. **Escalation Service (`escalation.service.ts`)**
   - **5 escalation levels** based on mouse welfare (12-24h survival window):
     - L1 (0-1h): Single notification, standard sound
     - L2 (1-2h): Repeat every 30 min
     - L3 (2-4h): Repeat every 15 min, device buzzer starts
     - L4 (4-8h): Repeat every 10 min, override DND, escalate contacts
     - L5 (8h+): Repeat every 5 min, all methods
   - **3 presets**: Relaxed, Normal (default), Aggressive + Custom timing
   - **Scalable query**: Only processes alerts due for notification (indexed)
   - **MQTT commands**: Sends buzzer/LED patterns to device
   - **Emergency contact notifications**: Placeholders for SMS (Twilio) and email

3. **New API Endpoints** (in `push.routes.ts`)
   - `GET /api/push/escalation/presets` - Available presets
   - `GET /api/push/escalation/settings` - User's escalation config
   - `PUT /api/push/escalation/settings` - Update escalation config
   - `GET /api/push/emergency-contacts` - List emergency contacts
   - `POST /api/push/emergency-contacts` - Add contact
   - `PUT /api/push/emergency-contacts/:id` - Update contact
   - `DELETE /api/push/emergency-contacts/:id` - Remove contact

4. **Cron Job** (`server.ts`)
   - Runs every 60 seconds via `setInterval`
   - Only processes alerts where `next_notification_at <= NOW()` (efficient)
   - Sends escalated notifications and device commands

5. **Alert Acknowledge Integration** (`alerts.routes.ts`)
   - Updated acknowledge endpoint to use escalation service
   - Stops escalation and sends `alert_clear` MQTT command to device

6. **MQTT Types Updated** (`mqtt.types.ts`)
   - Added `escalation` and `alert_clear` command types
   - Added escalation-specific fields (level, buzzer, buzzerPattern, led)

**Files Modified:**
- `Server/migrations/013_escalation_system.sql` - New migration
- `Server/src/services/escalation.service.ts` - New service
- `Server/src/services/mqtt.service.ts` - Added getMqttService singleton
- `Server/src/routes/push.routes.ts` - Escalation and emergency contact endpoints
- `Server/src/routes/alerts.routes.ts` - Acknowledge with escalation integration
- `Server/src/types/mqtt.types.ts` - New command types
- `Server/src/server.ts` - Initialize escalation service, cron job

**Remaining Phases:**
- Phase 2: Firmware implementation (buzzer/LED state machine, NVS persistence)
- Phase 3: Mobile app UI for escalation settings
- Phase 4: SMS (Twilio) and email integration

**Plan File:** `/Users/wadehargrove/.claude/plans/groovy-sprouting-eich.md`

---

### Previous Work: Timezone Auto-Detection & Snapshot Age Overlay

**Status:** Complete - Timezone stored per-device, stale snapshot indicator in mobile app

**What Was Implemented:**

1. **Timezone Auto-Detection During Setup**
   - Setup wizard (`Setup.svelte`) auto-detects timezone using `Intl.DateTimeFormat().resolvedOptions().timeZone`
   - IANA timezone string (e.g., "America/Los_Angeles") sent to device during registration
   - Firmware stores timezone in `pendingSetupTimezone` and sends to server

2. **Database Timezone Storage**
   - Migration `012_add_device_timezone.sql`: Added `timezone VARCHAR(64)` column to devices table
   - Server `setup.routes.ts` stores timezone on device creation and reclaim
   - Device detail API returns timezone in response

3. **Snapshot Timestamp Fixes**
   - Fixed "Invalid Date" display by converting PostgreSQL EXTRACT result from string to number
   - Fixed 8-hour timezone offset by using `AT TIME ZONE 'UTC'` when storing timestamps
   - Server now correctly stores and retrieves UTC timestamps

4. **Stale Snapshot Overlay in Mobile App**
   - When snapshot is >2 minutes old, orange badge appears on image showing age
   - Displays "X min ago", "X hours ago", or "X days ago"
   - Prevents users from mistaking old snapshots for current/empty state

**Files Modified:**
- `Server/migrations/012_add_device_timezone.sql` - New migration
- `Server/src/routes/setup.routes.ts` - Accept and store timezone
- `Server/src/routes/devices.routes.ts` - Return timezone in API, fix timestamp extraction
- `Server/src/services/mqtt.service.ts` - Store timestamps with correct UTC handling
- `mousetrap_arduino/mousetrap_arduino.ino` - Accept timezone in setup endpoints
- `mousetrap_arduino/trap-spa/src/pages/Setup.svelte` - Auto-detect and send timezone
- `mobile-app/src/screens/DeviceDetailScreen.tsx` - Stale snapshot overlay
- `mobile-app/src/services/api.ts` - Map timezone, convert timestamp to number
- `mobile-app/src/types/index.ts` - Add timezone to Device type

**Firmware/SPA Build Status:**
- Firmware compiled: `build/mousetrap_arduino.ino.bin`
- SPA built: `build/littlefs.bin`
- Ready for OTA deployment from dashboard

---

### Previous Work: Mobile App Snapshot Feature & Server Rebuild Fix

**Status:** Complete - Snapshot viewer working end-to-end in mobile app

**What Was Implemented:**

1. **Camera Snapshot Feature in Mobile App**
   - Device detail screen (`DeviceDetailScreen.tsx`) now includes snapshot viewer
   - "Request Snapshot" button sends command to device via server API
   - Device captures photo, sends via MQTT to server
   - Server stores snapshot in database (base64 JPEG in `devices.last_snapshot`)
   - App polls API and displays image when available
   - Timestamp shown below image
   - Button disabled when device offline, shows spinner while waiting

2. **Database Migration for Snapshot Storage**
   - Migration `011_add_device_snapshot.sql`:
     - Added `last_snapshot` TEXT column to devices table
     - Added `last_snapshot_at` TIMESTAMP column
     - Added index on `last_snapshot_at`
   - Server stores snapshots in database instead of just forwarding via WebSocket
   - Enables persistent snapshot retrieval via REST API

3. **Server-Side Snapshot Handling**
   - `mqtt.service.ts`: `handleCameraSnapshot()` now stores image in database
   - `devices.routes.ts`: Device detail endpoint returns `lastSnapshot` and `lastSnapshotTimestamp`
   - Mobile app API service maps these fields to `last_snapshot` and `last_snapshot_timestamp`

4. **Critical Fix: Server TypeScript Rebuild**
   - Issue: TypeScript changes weren't being compiled before pm2 restart
   - Server was running old JavaScript without snapshot storage logic
   - Fix: Always run `npm run build` before `pm2 restart mqtt-server`

**Files Modified:**
- `Server/migrations/011_add_device_snapshot.sql` - New migration
- `Server/src/services/mqtt.service.ts` - Store snapshots in database
- `Server/src/routes/devices.routes.ts` - Return snapshot in device detail
- `mobile-app/src/screens/DeviceDetailScreen.tsx` - Snapshot UI with polling
- `mobile-app/src/services/api.ts` - Map snapshot fields from server

---

### Previous Work: Push Notifications & Mobile App Foundation

**Status:** Complete - Server infrastructure ready, Expo mobile app created

**What Was Implemented:**

1. **Server Push Notification Infrastructure**
   - Database migration `010_create_push_notifications.sql`:
     - `push_tokens` table for user device tokens (iOS, Android, web)
     - `notification_preferences` table for per-user settings
     - `notification_log` table for tracking sent notifications
   - `push.service.ts` with full Expo SDK integration:
     - Token registration/removal
     - Preference management (trap alerts, device offline, low battery)
     - Quiet hours support
     - Multi-device support per user
   - `push.routes.ts` API endpoints:
     - `POST /api/push/register-token` - Register push token
     - `DELETE /api/push/token` - Remove push token
     - `GET /api/push/preferences` - Get/update notification preferences
     - `POST /api/push/test` - Send test notification
   - MQTT alert integration sends push notifications to all tenant users

2. **React Native Mobile App**
   - Location: `/Users/wadehargrove/Documents/MouseTrap/mobile-app/`
   - Built with Expo SDK 54, TypeScript, New Architecture
   - Full authentication and device/alert management
   - Push notification infrastructure (requires dev build for testing)
   - See "Mobile App" section above for complete details

**Next Steps:**
- Configure EAS project ID for push notifications (requires Apple Developer account)
- Build for physical devices and test push notifications
- Set up TestFlight and Play Store internal testing

---

## Previous Session Notes (2025-11-29 - Earlier)

### Device Claim Recovery & Superadmin Snapshot Fix

**Status:** Complete - Both Kitchen and Biggy devices working

**What Was Implemented:**

1. **Device Claim Recovery** (`setup.routes.ts`, `mousetrap_arduino.ino`)
   - New `/api/setup/recover-claim` endpoint allows devices to recover credentials after NVS loss
   - After WiFi connects during setup, device checks if already claimed on server
   - If claimed: Recovers MQTT credentials, skips account setup, connects immediately
   - If not claimed: Proceeds to normal account creation/sign-in flow
   - **Security model:** Devices can only pub/sub to their own MQTT topics, MAC is hardware-burned
   - Device stays in original tenant on recovery (prevents "stealing")

2. **Factory Reset Preserves Server Claim** (`mousetrap_arduino.ino:3936-3940`)
   - Physical factory reset (10s button hold) now only clears LOCAL NVS
   - Does NOT notify server - claim record preserved for recovery
   - Users who want to truly unclaim should use the dashboard
   - Prevents devices getting stranded when NVS is cleared

3. **Superadmin Cross-Tenant Snapshot Fix** (`devices.routes.ts`, `server.ts`)
   - Superadmins can now request snapshots from devices in any tenant
   - Fixed: `request-snapshot` endpoint now allows superadmin access to all devices
   - Fixed: Uses device's actual `tenant_id` for MQTT command (not user's tenant)
   - Fixed: Snapshots from non-Master tenants also forwarded to Master Tenant WebSocket room
   - Allows superadmins in Master Tenant to see snapshots from all devices

4. **AP Channel Optimization at Boot** (`mousetrap_arduino.ino`)
   - Added `channel` field to `CachedNetwork` struct
   - Early boot scan captures WiFi channel info
   - AP starts on strongest network's channel (prevents phone disconnection during setup)
   - Removed channel-change code from WiFi test phase

5. **AP Disabled After Claim Recovery** (`mousetrap_arduino.ino:11749-11759`)
   - After successful claim recovery, device immediately:
     - Connects to MQTT
     - Disables AP mode (`WiFi.softAPdisconnect(true)`)
     - Switches to STA-only mode
   - No reboot required

**Files Modified:**
- `Server/src/routes/setup.routes.ts` - Added `/recover-claim` endpoint
- `Server/src/routes/devices.routes.ts` - Superadmin cross-tenant snapshot access
- `Server/src/server.ts` - Forward snapshots to Master Tenant room for superadmins
- `mousetrap_arduino/mousetrap_arduino.ino` - Recovery logic, factory reset fix, channel optimization

---

## Previous Session Notes (2025-11-29 - Earlier)

### Two-Phase Setup Wizard - WORKING

**Status:** Setup wizard working

**What Was Implemented:**

1. **Two-Phase Setup Flow** (`mousetrap_arduino.ino`, `trap-spa/src/pages/Setup.svelte`, `trap-spa/src/lib/api.js`)
   - **Phase 1:** Test WiFi connection before asking for account info
     - New `/api/setup/test-wifi` endpoint connects to WiFi in AP+STA mode
     - Device scans for target network channel, starts AP on same channel
     - If WiFi fails → User can retry immediately with different credentials
     - If WiFi succeeds → Proceeds to account step
   - **Phase 2:** Register with server (WiFi already connected)
     - New `/api/setup/register` endpoint for registration only
     - WiFi connection already established, more reliable
   - **Channel matching:** Both AP and STA interfaces must be on same channel (ESP32-S3 hardware limitation)

2. **Critical AP Mode Fix** (`mousetrap_arduino.ino:11608-11649`)
   - **Root cause of phone disconnection:** Was switching to `WIFI_STA` mode during network scan, dropping the AP
   - **Fix:** Stay in `WIFI_AP_STA` mode during scan, only restart AP if channel needs to change
   - Phone now stays connected through WiFi test

3. **WiFi Connection Improvements**
   - Reduced WiFi connection timeout from 15s to 10s
   - Added `WiFi.disconnect(true)` before retry to clear stale connection state
   - WiFi retry now works correctly after failed attempt

4. **Server Stability Fix** (`server.ts:84-91`)
   - Added MQTT error handler to prevent Node.js crash on unhandled `error` events
   - Also fixed: Added `rotation_ack` to `ParsedTopic` type union

**Completed: Forgot Password UX** (`trap-spa/src/pages/Setup.svelte`)
- Added "Forgot password?" link below password field on Step 3 (Sign In tab only)
- Tapping shows info box with instructions:
  1. Connect to your home WiFi network
  2. Visit dashboard.mousetrap.com/forgot-password
  3. Reset your password via email
  4. Return here to complete setup
- Info box is dismissible (X button)
- SPA rebuilt and ready for deployment

**Future Enhancement: Register First, Claim Later**
- Deferred for better UX: Device registers without account, user claims from dashboard later
- Would eliminate password issues entirely during captive portal setup
- Queue alerts until device is claimed

---

## Previous Session Notes (2025-11-28)

### Dashboard UX Improvements & Firmware Fixes

**Status:** Complete

**What Was Implemented:**

1. **Dashboard Device Card Click Navigation** (`trap-dashboard/src/components/devices/DeviceCard.tsx`)
   - Entire device card is now clickable to navigate to device details
   - Removed "View Details" button from card footer
   - Action buttons (delete, move) still work independently via `e.stopPropagation()`

2. **Auto-Capture Snapshot on Modal Open** (`trap-dashboard/src/components/SnapshotViewer.tsx`)
   - Added `autoCapture` prop to SnapshotViewer component
   - When clicking "Capture Snapshot" button, modal opens and immediately requests snapshot
   - Uses `useCallback` and `useRef` for proper React hook handling
   - "Capture New" button remains for taking additional snapshots

3. **Firmware: Fixed "Rejected revocation - missing token" Log Spam** (`mousetrap_arduino.ino`)
   - Empty retained MQTT messages on `/revoke` topics were triggering revocation handler
   - Added check to silently ignore empty/null payloads on revoke topic
   - Caused by `clearRetainedRevokeMessage()` which publishes empty retained messages

4. **Firmware: ACK-based Credential Rotation Support** (`mousetrap_arduino.ino`)
   - Device now publishes ACK to `rotation_ack` topic after saving new credentials to NVS
   - ACK is published BEFORE disconnecting so server can update broker
   - Firmware compiled and ready for OTA deployment

5. **APSTA Mode Setup with Real-Time Progress** (`mousetrap_arduino.ino`, `trap-spa/src/pages/Setup.svelte`)
   - ESP32-S3 now uses `WiFi.mode(WIFI_AP_STA)` during setup - AP stays running while connecting to WiFi
   - SPA polls `/api/setup/progress` every 500ms for real-time feedback
   - Added `/api/setup/reset` endpoint to retry setup without reboot
   - Added `/api/setup/reboot` endpoint for user-triggered reboot after success
   - Contextual error messages with specific help (wrong password, WiFi not found, etc.)
   - Deployed to Biggy via serial upload (115200 baud)

**Previous Work (Same Day):**
- Device stranding prevention mitigations (ACK-based rotation, recovery endpoint, scripts)
- Migrated to Docker Mosquitto with Dynamic Security (LIVE)
- Re-claimed both devices (Kitchen, Biggy)

**Previous Sessions:**
- RBAC standardization and role enforcement
- Superadmin multi-tenant access implementation
- Documentation organization and consolidation
- AP+STA mode implementation for captive portal
- Two-generation log rotation (prevLogs.txt, prevLogs2.txt)
- Standalone mode for WiFi-only setup

### Current Tasks

**Completed:**
- [x] Set up Docker Mosquitto with Dynamic Security
- [x] Implement credential rotation endpoint
- [x] Add rotate_credentials firmware command
- [x] Update mqtt-auth.ts for dual-mode support
- [x] Test credential rotation with Biggy device
- [x] Add migration sync to rotation endpoint
- [x] Fixed device connection issues (rc=5) by re-claiming both devices
- [x] Documented parallel rotation migration approach in MQTT-SETUP.md
- [x] **Migrated to Docker Mosquitto with Dynamic Security (LIVE)**
- [x] Re-claimed Kitchen (94A990306028) and Biggy (D0CF13155060) devices
- [x] **Implemented device stranding prevention mitigations**
- [x] Added ACK-based credential rotation
- [x] Added `/device/recover-credentials` endpoint
- [x] Created `rebuild-dynsec-from-db.ts` script
- [x] Created `check-credential-sync.ts` health check script
- [x] Documented stranding scenarios in `docs/DEVICE-STRANDING-SCENARIOS.md`
- [x] Add firmware support for `rotation_ack` MQTT message - **DEPLOYED**
- [x] Fixed "Rejected revocation - missing token" log spam in firmware
- [x] Dashboard: Device cards now clickable to navigate to details
- [x] Dashboard: Capture Snapshot auto-requests on modal open
- [x] Implemented APSTA mode setup with real-time progress polling
- [x] Deployed APSTA firmware to Biggy via serial - **VERIFIED WORKING**
- [x] Deployed APSTA firmware to Kitchen via OTA - **VERIFIED WORKING**
- [x] Implemented device claim recovery (`/api/setup/recover-claim` endpoint)
- [x] Fixed factory reset to preserve server claim for recovery
- [x] Fixed superadmin cross-tenant snapshot access
- [x] Fixed WebSocket snapshot forwarding for cross-tenant devices
- [x] **Implemented push notification server infrastructure**
- [x] **Created React Native mobile app** (`/Users/wadehargrove/Documents/MouseTrap/mobile-app/`)
- [x] Mobile app: Login, device list, alerts, settings, push notification setup
- [x] Mobile app: Working in Expo Go (minus push notifications)
- [x] Mobile app: EAS Build configured for dev/preview/production builds
- [x] Mobile app: Device detail screen with snapshot viewer - **WORKING**
- [x] Server: Snapshot storage in database (migration 011)
- [x] **Timezone auto-detection & storage** (migration 012, Setup.svelte, setup.routes.ts)
- [x] **Snapshot timestamp fixes** (Invalid Date, 8-hour offset)
- [x] **Stale snapshot overlay** in mobile app (shows "X min/hours ago" badge)
- [x] **Escalating notification system planned** - see `/Users/wadehargrove/.claude/plans/groovy-sprouting-eich.md`
- [x] **Escalating notification system Phase 1 (Server)** - migration, service, API endpoints, cron job
- [x] **Escalating notification system Phase 2 (Firmware)** - alert state machine, buzzer/LED patterns, NVS persistence, MQTT handlers
- [x] **Escalating notification system Phase 3 (Mobile App)** - escalation settings UI, emergency contacts management
- [x] **Escalating notification system Phase 4 (SMS/Email)** - Twilio SMS, Nodemailer email, rate limiting
- [x] **Mobile app device actions** - Clear Alerts and Test Alert buttons
- [x] **Fixed trapState display** - Server now returns `trapState` field computed from alerts
- [x] **Fixed MQTT alert_reset** - Now uses `mqtt_client_id` (no colons) instead of `mac_address`
- [x] **Immediate email on alert** - Emergency contacts notified immediately, not just via cron
- [x] **Fixed Device Settings location save** - Superadmin PATCH endpoint now bypasses tenant filter
- [x] **Location as snapshot card title** - Device detail shows location in card header

**Pending:**
- [ ] Deploy updated firmware to Biggy (escalation system compiled but not uploaded)
- [ ] Configure Twilio credentials in `.env` for production SMS
- [ ] Implement new button handler (click=reset alarm, 2s=reboot, 10s=factory reset)
- [ ] Mobile app: Configure EAS project ID (`eas init`) - requires Apple Developer account
- [ ] Mobile app: Build for physical devices and test push notifications
- [ ] Mobile app: Set up TestFlight and Play Store internal testing

### Known Issues

**FIXED: Server MQTT Connack Timeout Crashes:**
- ~~Server crashes repeatedly with `Error: connack timeout`~~
- ~~Over 4731 restarts observed in pm2~~
- **Root cause:** Unhandled `error` event from MqttService EventEmitter
- **Fix applied:** Added error handler in `server.ts:84-91`
- Server now handles MQTT errors gracefully without crashing

**WiFi Scanning in AP_STA Mode:**
- `WiFi.scanNetworks()` returns 0 when ESP32-S3 is in AP_STA mode
- **Solution:** Temporarily switch to STA mode during scan, then back to AP_STA
- Status: Fixed in two-phase setup

**AP+STA Mode Channel Requirement:**
- Both AP and STA interfaces must operate on the same WiFi channel
- Firmware now scans for target network channel before starting AP
- Status: Fixed

**Filesystem OTA May Cause Unclaim:**
- After littlefs.bin upload, device may unclaim
- Workaround: Re-claim device if needed

---

## MQTT Topics Reference

### Device to Server
- `tenant/{tenantId}/device/{clientId}/status` - Device status
- `tenant/{tenantId}/device/{MAC}/alert` - Alert notifications
- `tenant/{tenantId}/device/{MAC}/alert_cleared` - Alert cleared confirmation
- `tenant/{tenantId}/device/{clientId}/rotation_ack` - Credential rotation ACK
- `tenant/{tenantId}/device/{clientId}/escalation_update` - Alert level changed
- `tenant/{tenantId}/device/{clientId}/alert_sync` - Alert state sync on reconnect

### Server to Device
- `tenant/{tenantId}/device/{clientId}/command/reboot` - Reboot command
- `tenant/{tenantId}/device/{clientId}/command/alert_reset` - Clear alert (legacy)
- `tenant/{tenantId}/device/{clientId}/command/alert_clear` - Clear alert with reason/alertId
- `tenant/{tenantId}/device/{clientId}/command/escalation` - Update preset/timing, force level
- `tenant/{tenantId}/device/{clientId}/command/rotate_credentials` - Credential rotation
- `global/firmware/latest` - Global firmware updates
- `global/filesystem/latest` - Global filesystem updates

---

## Quick Troubleshooting

### MQTT Connection Failed (rc=5)
1. Check Mosquitto logs: `tail -f /opt/homebrew/var/log/mosquitto.log`
2. Verify credentials in password file
3. Restart Mosquitto: `brew services restart mosquitto`
4. See [Server/docs/MQTT-SETUP.md](./Server/docs/MQTT-SETUP.md) for details

### Device Not Responding
1. Check device is on network: `ping 192.168.133.46`
2. Check device logs: `curl -u ops:changeme http://192.168.133.46/api/system-logs`
3. Access debug dashboard: `http://192.168.133.46/debug`

### Compilation Errors
1. Ensure using correct FQBN (see Persistent Operational Info above)
2. Use `make compile` not manual arduino-cli with wrong board
3. See [mousetrap_arduino/docs/FIRMWARE-COMPILATION.md](./mousetrap_arduino/docs/FIRMWARE-COMPILATION.md)

### Shell Escaping with Passwords (zsh)
The `!` character in passwords like `Admin123!` gets escaped as `\!` in zsh, causing JSON parse errors.

**Wrong:**
```bash
curl -d '{"password":"Admin123!"}'  # ! gets escaped to \!
```

**Right - use heredoc:**
```bash
cat << 'ENDJSON' > /tmp/request.json
{"email":"admin@mastertenant.com","password":"Admin123!"}
ENDJSON
curl -d @/tmp/request.json ...
```

---

## Documentation Links

| Topic | Document |
|-------|----------|
| Documentation navigation | [DOCUMENTATION-SYSTEM-GUIDE.md](./DOCUMENTATION-SYSTEM-GUIDE.md) |
| Device claiming flow | [DEVICE-CLAIMING-FLOW.md](./DEVICE-CLAIMING-FLOW.md) |
| **Device stranding & recovery** | **[Server/docs/DEVICE-STRANDING-SCENARIOS.md](./Server/docs/DEVICE-STRANDING-SCENARIOS.md)** |
| Firmware compilation | [mousetrap_arduino/docs/FIRMWARE-COMPILATION.md](./mousetrap_arduino/docs/FIRMWARE-COMPILATION.md) |
| OTA deployment | [mousetrap_arduino/docs/OTA-DEPLOYMENT.md](./mousetrap_arduino/docs/OTA-DEPLOYMENT.md) |
| SPA development | [mousetrap_arduino/docs/SPA-DEVELOPMENT.md](./mousetrap_arduino/docs/SPA-DEVELOPMENT.md) |
| Board settings | [mousetrap_arduino/docs/BOARD-SETTINGS.md](./mousetrap_arduino/docs/BOARD-SETTINGS.md) |
| Device API | [mousetrap_arduino/docs/DEVICE-API.md](./mousetrap_arduino/docs/DEVICE-API.md) |
| Server API | [Server/docs/API-REFERENCE.md](./Server/docs/API-REFERENCE.md) |
| MQTT setup | [Server/docs/MQTT-SETUP.md](./Server/docs/MQTT-SETUP.md) |
| Server deployment | [Server/docs/DEPLOYMENT.md](./Server/docs/DEPLOYMENT.md) |
| **Mobile App** | **See "Mobile App" section above** |

---

## End of Session Checklist

When ending a session with significant changes:
- [ ] Update "Latest Work" section above
- [ ] Update "Current Tasks" if they changed
- [ ] Note any new warnings or gotchas
- [ ] Update specific docs if procedures changed

---

**End of Handoff**
