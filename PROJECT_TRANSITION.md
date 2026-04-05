# XIAO ESP32-S3 Sense Migration

## Migration Overview

**From:** ESP32-S3-CAM (N16R8) — AI-Thinker style module, 16MB flash, OPI PSRAM
**To:** XIAO ESP32-S3 Sense — Seeed Studio, 8MB flash, 8MB OPI PSRAM, onboard camera (OV2640), onboard microphone

**Baseline tag:** `esp32s3-cam-trap-v1.0.0-scout-v0.1.3`
**Migration branch:** `xiao-migration`

---

## Rollback

To restore the exact pre-migration state:
```bash
git checkout esp32s3-cam-trap-v1.0.0-scout-v0.1.3
```

To abandon migration entirely:
```bash
git checkout main
git branch -D xiao-migration
```

---

## Key Differences: ESP32-S3-CAM vs XIAO ESP32-S3 Sense

| Feature | ESP32-S3-CAM (N16R8) | XIAO ESP32-S3 Sense |
|---------|---------------------|---------------------|
| Flash | 16MB | 8MB |
| PSRAM | 8MB OPI | 8MB OPI |
| Camera | OV2640 (external module) | OV2640 (onboard) |
| Microphone | None | MSM261D3526H1CPM (onboard) |
| SD Card | microSD slot (some boards) | microSD via expansion board |
| USB | USB-UART bridge (CH340/CP2102) | Native USB-C (CDC) |
| GPIO count | ~20 usable | 11 usable (compact form factor) |
| Form factor | ~40x27mm | 21x17.5mm |
| Power | 5V via USB or VIN | 5V via USB-C or battery connector |

### Critical Migration Items

1. **Flash size reduction (16MB -> 8MB):** Partition table must be redesigned. Current 16MB layout won't fit.
2. **Pin mapping:** `camera_pins.h` already has `CAMERA_MODEL_XIAO_ESP32S3` defined in both firmware dirs — verify pin assignments match actual hardware.
3. **USB interface:** XIAO uses native USB CDC, not a UART bridge. Upload mechanism and serial monitoring will differ.
4. **GPIO constraints:** Fewer GPIOs available — verify all sensor/actuator connections can be accommodated.
5. **Upload speed:** Native USB should support faster uploads than the current 115200 baud UART.

---

## Migration Checklist

### Phase 1: Partition Table & Build System
- [x] Design 8MB partition layout (firmware + LittleFS/SPIFFS)
- [x] Update `partitions.csv` for 8MB flash
- [x] Update Makefile FQBN for XIAO board variant
- [x] Verify `CAMERA_MODEL_XIAO_ESP32S3` pin definitions are correct
- [ ] Test basic compilation with new board settings

### Phase 2: Firmware Adaptation
- [x] Update `#define` board selection in firmware
- [x] Adjust any hardcoded flash size references
- [ ] Test camera initialization with onboard OV2640
- [ ] Verify WiFi connectivity
- [ ] Test MQTT communication with server
- [ ] Verify OTA update works with 8MB flash constraints

### Phase 3: SPA & Filesystem
- [ ] Optimize SPA build size if needed for smaller flash
- [ ] Verify LittleFS image fits in new partition layout
- [ ] Test SPA serving from device

### Phase 4: Integration Testing
- [ ] End-to-end test: device -> MQTT -> server -> mobile app
- [ ] OTA firmware update cycle
- [ ] OTA filesystem update cycle
- [ ] Camera capture and image upload
- [ ] Device claiming flow
- [ ] Push notification delivery

### Phase 5: Hardware Validation
- [ ] Servo control (trap mechanism)
- [ ] Motion detection
- [ ] Power consumption measurement
- [ ] Long-duration stability test (24h+)
- [ ] WiFi range/reliability comparison vs old board

---

## Files That Will Need Changes

### Trap Firmware (`mousetrap_arduino/`)
- `partitions.csv` — New 8MB layout
- `Makefile` — Updated FQBN, flash size, upload settings
- `mousetrap_arduino.ino` — Board selection define, any flash-size-dependent logic
- `camera_pins.h` — Verify XIAO pin definitions

### Scout Firmware (`scout_arduino/`)
- `partitions.csv` — New 8MB layout
- `Makefile` — Updated FQBN, flash size, upload settings
- `scout_arduino.ino` — Board selection define, any flash-size-dependent logic
- `camera_pins.h` — Verify XIAO pin definitions

### Server (potentially)
- `mqtt.types.ts` — May need new hardware version identifier
- Device registration — New board type recognition

---

## Notes

- The `camera_pins.h` files in both `mousetrap_arduino/` and `scout_arduino/` already contain `CAMERA_MODEL_XIAO_ESP32S3` pin definitions. This was added proactively during the original development.
- No PCB/KiCad files exist in the repo. Wiring documentation will need to be created for the XIAO form factor.
- The XIAO's compact size and onboard camera simplify the physical design but limit GPIO availability.
