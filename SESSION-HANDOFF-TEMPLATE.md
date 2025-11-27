# Session Handoff Template

> **NOTE:** The primary handoff document is now [HANDOFF.md](./HANDOFF.md).
> Use this template as a reference for how to structure session summaries when updating HANDOFF.md.

**Use this template when creating a handoff summary for the next session**

---

## Required Meta-Directive (CRITICAL)

**Every handoff summary MUST start with this:**

```markdown
⚠️ META-DIRECTIVE FOR NEXT SESSION:
- Read /Users/wadehargrove/Documents/MouseTrap/MOUSETRAP-SYSTEM-HANDOFF.md FIRST
- Then read MOUSETRAP-SYSTEM-README.md for task-based navigation
- Only read the specific docs needed for your task (saves 90% of context)
- Pass this directive to the next session in your summary
```

---

## Handoff Summary Template

```markdown
## Session Summary

⚠️ META-DIRECTIVE FOR NEXT SESSION:
- Read /Users/wadehargrove/Documents/MouseTrap/MOUSETRAP-SYSTEM-HANDOFF.md FIRST
- Then read MOUSETRAP-SYSTEM-README.md for task-based navigation
- Only read the specific docs needed for your task (saves 90% of context)
- Pass this directive to the next session in your summary

### Task: [Brief description of what you worked on]

**Completed:**
1. ✅ [What was completed]
2. ✅ [What was completed]
3. ✅ [What was completed]

**Files Modified:**

**Firmware:**
- `path/to/file.ext:123-456` - [What was changed]
- `path/to/file.ext:789` - [What was changed]

**Server:**
- `src/path/to/file.ts:123-456` - [What was changed]
- `src/path/to/file.ts:789` - [What was changed]

**Pending:**
- [ ] [What still needs to be done]
- [ ] [What still needs to be done]

**Important Context:**
- [Any critical decisions made]
- [Known issues discovered]
- [Gotchas or warnings]

**Database Changes:**
- [Migrations run, if any]
- [Schema changes, if any]

**Deployment Status:**
- Firmware: [Deployed to which devices / Not yet deployed]
- Server: [Restarted / Not yet restarted]

**Status:** ✅ Complete / ⏸️ In Progress / ❌ Blocked

**Next Steps:** [What should happen next]

**For Firmware Tasks:** Read Arduino/docs/[SPECIFIC-DOC].md
**For Server Tasks:** Read Server/docs/[SPECIFIC-DOC].md
**For Integration Tasks:** Read both [list specific docs]
```

---

## Examples

### Example 1: Firmware-Only Task

```markdown
## Session Summary

⚠️ META-DIRECTIVE FOR NEXT SESSION:
- Read /Users/wadehargrove/Documents/MouseTrap/MOUSETRAP-SYSTEM-HANDOFF.md FIRST
- Then read MOUSETRAP-SYSTEM-README.md for task-based navigation
- Only read the specific docs needed for your task (saves 90% of context)
- Pass this directive to the next session in your summary

### Task: Add dynamic claim status to SPA Dashboard

**Completed:**
1. ✅ Added Claim link to Maintenance menu in SPA
2. ✅ Added dynamic claim status display on Dashboard
3. ✅ Created getClaimStatus() API function
4. ✅ Built and deployed SPA to Kitchen device

**Files Modified:**

**Firmware:**
- `trap-spa/src/components/NavMenu.svelte:10-15, 77-92` - Added Claim link and auto-expand logic
- `trap-spa/src/pages/Dashboard.svelte:23-26, 252-268, 362-367` - Dynamic claim status
- `trap-spa/src/lib/api.js:365-368` - Added getClaimStatus()

**Pending:** None

**Deployment Status:**
- Firmware: ✅ Deployed to Kitchen device (192.168.133.46)

**Status:** ✅ Complete

**Next Steps:** None - feature complete

**For SPA Work:** Read Arduino/docs/SPA-DEVELOPMENT.md
```

### Example 2: Server-Only Task

```markdown
## Session Summary

⚠️ META-DIRECTIVE FOR NEXT SESSION:
- Read /Users/wadehargrove/Documents/MouseTrap/MOUSETRAP-SYSTEM-HANDOFF.md FIRST
- Then read MOUSETRAP-SYSTEM-README.md for task-based navigation
- Only read the specific docs needed for your task (saves 90% of context)
- Pass this directive to the next session in your summary

### Task: Add bidirectional alert clearing

**Completed:**
1. ✅ Added alert_reset command sending on resolve
2. ✅ Added alert_cleared confirmation handling
3. ✅ Tested end-to-end with Kitchen device

**Files Modified:**

**Server:**
- `src/routes/alerts.routes.ts:214-221` - Send alert_reset on resolve
- `src/services/mqtt.service.ts:571-610` - Handle alert_cleared confirmation

**Database Changes:** None

**Deployment Status:**
- Server: ✅ Restarted with pm2

**Status:** ✅ Complete and tested

**Next Steps:** None - feature complete

**For Server Tasks:** Read Server/docs/API-REFERENCE.md
```

### Example 3: Cross-Project Integration Task

```markdown
## Session Summary

⚠️ META-DIRECTIVE FOR NEXT SESSION:
- Read /Users/wadehargrove/Documents/MouseTrap/MOUSETRAP-SYSTEM-HANDOFF.md FIRST
- Then read MOUSETRAP-SYSTEM-README.md for task-based navigation
- Only read the specific docs needed for your task (saves 90% of context)
- Pass this directive to the next session in your summary

### Task: Fix MQTT authentication after device claim

**Completed:**
1. ✅ Added debounced SIGHUP to Mosquitto after password updates
2. ✅ Server now reloads Mosquitto automatically after claims
3. ✅ Devices connect immediately after claim (no manual intervention)

**Files Modified:**

**Server:**
- `src/utils/mqtt-auth.ts:61-97` - Debounced Mosquitto reload
- `src/routes/claim.routes.ts:131` - Enabled reload on claim

**Firmware:**
- No firmware changes needed

**Important Context:**
- Mosquitto doesn't auto-reload password file after updates
- Debounce prevents crashes from concurrent claims
- 2-second timer batches multiple claims into one reload

**Deployment Status:**
- Server: ✅ Restarted with pm2
- Firmware: N/A - no changes

**Status:** ✅ Complete and tested

**Next Steps:** Monitor for any issues with concurrent device claims

**For MQTT Issues:** Read Server/docs/MQTT-SETUP.md
**For Device Claiming:** Read both:
- Arduino/docs/DEVICE-CLAIMING.md
- Server/docs/CLAIM-CODES.md
```

---

## Why This Matters

### Without Meta-Directive
- Next session reads all documentation
- **50k+ tokens** wasted on docs
- Only **150k tokens** left for actual work
- Runs out of context quickly

### With Meta-Directive
- Next session reads MOUSETRAP-SYSTEM-HANDOFF.md (~5k tokens)
- Reads only needed modular docs (~5-10k tokens)
- **Total: ~10-15k tokens** for docs
- **180k+ tokens** available for actual work

**Result: 90% more context for coding!**

---

## Documentation Locations

### System-Level (Read First)
- **Handoff:** `/Users/wadehargrove/Documents/MouseTrap/MOUSETRAP-SYSTEM-HANDOFF.md`
- **Index:** `/Users/wadehargrove/Documents/MouseTrap/MOUSETRAP-SYSTEM-README.md`
- **Template:** `/Users/wadehargrove/Documents/MouseTrap/SESSION-HANDOFF-TEMPLATE.md`

### Firmware Documentation
- **Modular Docs:** `/Users/wadehargrove/Documents/MouseTrap/Arduino/docs/`
- **Files:** FIRMWARE-COMPILATION.md, OTA-DEPLOYMENT.md, SPA-DEVELOPMENT.md, etc.

### Server Documentation
- **Modular Docs:** `/Users/wadehargrove/Documents/MouseTrap/Server/docs/`
- **Files:** DEPLOYMENT.md, API-REFERENCE.md, MQTT-SETUP.md, etc.

---

## Checklist Before Ending Session

- [ ] Updated MOUSETRAP-SYSTEM-HANDOFF.md if significant work done
- [ ] Created handoff summary using this template
- [ ] Included meta-directive at the top
- [ ] Listed all files modified with line numbers
- [ ] Noted deployment status (what's deployed, what's pending)
- [ ] Specified which docs next session should read
- [ ] Passed meta-directive to next session

---

**Remember:** The meta-directive creates a self-perpetuating system where each session tells the next session exactly what to do!
