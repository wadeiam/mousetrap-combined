# Documentation System Guide

**How to use the modular documentation system efficiently**

---

## The Problem This Solves

### Before (Old System):
- **HANDOFF_NOTES.md**: 900+ lines, everything in one file
- New sessions had to read 50k+ tokens of docs
- Only 150k tokens left for actual work
- Ran out of context frequently

### After (New System):
- **HANDOFF.md**: ~200 lines, session state + persistent info + links
- **Modular docs**: Read only what you need (5-10k tokens)
- **180k+ tokens** available for actual work
- **90% more context** for coding!

---

## Complete Documentation Index

### Root Level (`/Documents/MouseTrap/`)

| File | Purpose | When to Read |
|------|---------|--------------|
| **HANDOFF.md** | Session state, persistent operational info, current tasks | **ALWAYS READ FIRST** |
| DOCUMENTATION-SYSTEM-GUIDE.md | This file - explains the doc system | When confused about doc structure |
| DEVICE-CLAIMING-FLOW.md | Complete captive portal claiming flow | When working on device setup/claiming |

### Firmware Documentation (`/mousetrap_arduino/docs/`)

| File | Purpose | When to Read |
|------|---------|--------------|
| FIRMWARE-COMPILATION.md | How to compile firmware | When compiling or fixing build errors |
| OTA-DEPLOYMENT.md | Deploy firmware/filesystem OTA | When deploying updates to devices |
| SPA-DEVELOPMENT.md | Svelte SPA development | When working on device web UI |
| DEVICE-API.md | Device HTTP endpoints | When adding/modifying device API |
| DEVICE-CLAIMING.md | Firmware-side claiming | When working on claiming logic |
| BOARD-SETTINGS.md | ESP32-S3 configuration | When troubleshooting board issues |
| DEBUG-TOOLS.md | Debug dashboard and tools | When debugging device issues |
| TROUBLESHOOTING.md | Common device issues | When something isn't working |

### Server Documentation (`/Server/docs/`)

| File | Purpose | When to Read |
|------|---------|--------------|
| DEPLOYMENT.md | Server deployment procedures | When deploying server updates |
| API-REFERENCE.md | REST API endpoints | When working on API |
| MQTT-SETUP.md | Mosquitto configuration | When MQTT issues occur |
| DATABASE-SCHEMA.md | Database structure | When modifying database |
| CLAIM-CODES.md | Claim code management | When working on claiming |
| TESTING.md | Test procedures | When running tests |
| TROUBLESHOOTING.md | Server issues | When server isn't working |

### Legacy/Archive Files (Reference Only)

| File | Location | Notes |
|------|----------|-------|
| HANDOFF_NOTES.md | mousetrap_arduino/ | Old 900+ line handoff - archived |
| HANDOFF-OLD.md | Server/ | Old server handoff - archived |
| SPA_DEPLOYMENT.md | mousetrap_arduino/ | Merged into docs/SPA-DEVELOPMENT.md |
| ESP32_SETTINGS_REFERENCE.md | mousetrap_arduino/ | Merged into docs/BOARD-SETTINGS.md |
| FIRMWARE-DEVELOPMENT.md | mousetrap_arduino/ | Merged into docs/ files |

---

## The Documentation Flow

```
+-----------------------------------------------------------+
|  1. HANDOFF.md (start every session here)                 |
|     - Current session state                                |
|     - Persistent operational info (commands, credentials) |
|     - Current tasks and pending work                      |
|     - Links to specific docs                              |
+-----------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------+
|  2. This Guide (if needed)                                |
|     - Complete documentation index                        |
|     - "When to Read Which Doc" tables                     |
|     - Navigation help                                     |
+-----------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------+
|  3. Specific Doc (project/docs/XXXX.md)                   |
|     - ONE topic only                                      |
|     - 50-200 lines                                        |
|     - Read only if needed for current task                |
+-----------------------------------------------------------+
```

---

## Task-Based Navigation

### "I need to compile the firmware"
1. Read HANDOFF.md (check for any warnings)
2. Read mousetrap_arduino/docs/FIRMWARE-COMPILATION.md

### "I need to deploy firmware to a device"
1. Read HANDOFF.md (get device IPs, credentials)
2. Read mousetrap_arduino/docs/OTA-DEPLOYMENT.md

### "MQTT isn't working"
1. Read HANDOFF.md (check current state)
2. Read Server/docs/MQTT-SETUP.md
3. Check Server/docs/TROUBLESHOOTING.md if still stuck

### "I need to work on device claiming"
1. Read HANDOFF.md
2. Read DEVICE-CLAIMING-FLOW.md (complete flow)
3. Optionally: mousetrap_arduino/docs/DEVICE-CLAIMING.md (firmware details)

### "I need to work on the device SPA"
1. Read HANDOFF.md
2. Read mousetrap_arduino/docs/SPA-DEVELOPMENT.md
3. Read mousetrap_arduino/docs/OTA-DEPLOYMENT.md for deployment

### "I need to deploy server updates"
1. Read HANDOFF.md
2. Read Server/docs/DEPLOYMENT.md

### "Device shows connection issues"
1. Read HANDOFF.md
2. Read mousetrap_arduino/docs/TROUBLESHOOTING.md
3. Read Server/docs/MQTT-SETUP.md (for MQTT issues)

---

## Best Practices

### For Users (You)
1. **Start sessions with:** "Continue from previous session. Read HANDOFF.md first."
2. **End sessions:** Update HANDOFF.md if significant work was done
3. **Include context:** Tell the AI which specific task you're working on

### For Sessions (AI)
1. **Always read HANDOFF.md first**
2. **Use this guide** to find specific docs needed
3. **Read only what's needed** for current task
4. **Update HANDOFF.md** when session ends with significant changes

---

## Maintenance

### Updating HANDOFF.md
After completing significant work:
- Update "Latest Session" section
- Update "Current Tasks" if they changed
- Keep persistent operational info up to date

### Updating Specific Docs
When procedures change:
- Edit the relevant docs/XXXX.md file
- Keep docs focused on ONE topic
- Update cross-references if needed

---

## Success Metrics

### Before Reorganization
- **HANDOFF_NOTES.md**: 900+ lines, 50k+ tokens
- **Context available**: 150k tokens
- **Ran out of context**: Frequently

### After Reorganization
- **HANDOFF.md**: ~200 lines, ~3k tokens
- **Specific docs**: 50-200 lines, ~2-5k each
- **Total read per session**: ~8-15k tokens
- **Context available**: 180k+ tokens
- **90% more context for actual work!**

---

## Quick Reference Card

```
+============================================================+
|  Documentation System Quick Reference                       |
+============================================================+
|  Start Session: "Read HANDOFF.md first"                    |
|  Navigate: Use this guide's tables                         |
|  Read: Only the specific doc(s) needed                     |
|  End Session: Update HANDOFF.md if needed                  |
+------------------------------------------------------------+
|  Root Docs:   /Documents/MouseTrap/                        |
|  Firmware:    /Documents/MouseTrap/mousetrap_arduino/docs/ |
|  Server:      /Documents/MouseTrap/Server/docs/            |
+============================================================+
```

---

**Remember:** The whole system is designed to save context by reading only what's needed for the current task. Start with HANDOFF.md and let it guide you!
