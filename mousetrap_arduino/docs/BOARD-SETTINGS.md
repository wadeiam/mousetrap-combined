# Board Settings Reference

**ESP32-S3 Dev Module Configuration**

---

## Hardware Specifications

- **Chip:** ESP32-S3 (dual-core Xtensa LX7)
- **Flash:** 16MB
- **PSRAM:** 8MB (Octal SPI)
- **WiFi:** 2.4GHz 802.11 b/g/n
- **Bluetooth:** Bluetooth 5 LE
- **Camera:** OV2640 (2MP)

---

## Arduino CLI FQBN

```
esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc
```

### Settings Breakdown

| Setting | Value | Description |
|---------|-------|-------------|
| FlashSize | 16M | 16MB flash storage |
| PSRAM | opi | 8MB Octal SPI PSRAM |
| PartitionScheme | custom | Uses `partitions.csv` |
| CPUFreq | 240 | 240MHz (max with WiFi) |
| FlashMode | qio | Quad I/O @ 80MHz |
| UploadSpeed | 921600 | Fast upload baud rate |
| DebugLevel | none | Production build |
| EraseFlash | none | Preserve data on upload |
| USBMode | hwcdc | Hardware CDC for serial |

---

## Custom Partition Scheme

File: `partitions.csv`

| Partition | Type | Offset | Size | Description |
|-----------|------|--------|------|-------------|
| nvs | data | 0x9000 | 20KB | Config storage |
| otadata | data | 0xE000 | 8KB | OTA metadata |
| app0 | app | 0x10000 | 2.5MB | Primary firmware |
| app1 | app | 0x290000 | 2.5MB | Secondary firmware (OTA) |
| littlefs | data | 0x510000 | 10.875MB | Filesystem (SPA/images) |
| coredump | data | 0xFF0000 | 64KB | Crash debugging |

### Why Dual App Partitions?

Enables safe OTA updates:
1. New firmware flashes to inactive partition
2. Boot partition switches
3. If new firmware crashes, can roll back to previous

### LittleFS Partition Note

Uses **SPIFFS SubType (0x82)** despite being LittleFS filesystem. This is required for OTA compatibility.

**Expected warning (safe to ignore):**
```
WARNING: Partition has name 'littlefs' which is a partition subtype,
but this partition has non-matching type 0x1 and subtype 0x82.
```

---

## USB Connection

### macOS Port Detection

ESP32-S3 appears as:
- `/dev/cu.usbmodem*` (USB CDC)
- `/dev/cu.usbserial-*` (external USB-UART)

Auto-detect:
```bash
arduino-cli board list
```

### Drivers

May need CH340 drivers:
```bash
brew install --cask wch-ch34x-usb-serial-driver
```

---

## Upload Methods

### Via Arduino CLI
```bash
arduino-cli upload \
  --fqbn "esp32:esp32:esp32s3:..." \
  -p /dev/cu.usbmodem* \
  .
```

### Via Makefile
```bash
make upload
```

### Via OTA
```bash
curl -u "ops:changeme" \
  -F "file=@build/mousetrap_arduino.ino.bin" \
  http://192.168.133.46/uploadfw
```

---

## Compilation Notes

### Required Arduino Core

- **Version:** ESP32 core 3.3.2+
- **Platform:** esp32:esp32

Install:
```bash
arduino-cli core install esp32:esp32
```

Upgrade:
```bash
arduino-cli core upgrade esp32:esp32
```

### Library Compatibility

**Async_TCP v3.4.9** (NOT AsyncTCP v1.1.4)
- Required for ESP-IDF 5.x compatibility
- Install via Arduino IDE Library Manager

### Memory Usage

Typical build:
- Flash: 1.4-1.5 MB (56-60% of 2.5MB partition)
- RAM: 45 KB (13-15% of dynamic memory)

---

## Device Access Methods

### Serial Monitor
```bash
make monitor
```

Or:
```bash
arduino-cli monitor -p /dev/cu.usbmodem* -c baudrate=115200
```

### Web Interface
- SPA: `http://<device-ip>/app/`
- Debug: `http://<device-ip>/debug`
- OTA: `http://<device-ip>/update`

### API
See [DEVICE-API.md](./DEVICE-API.md)

---

## Pin Configuration

(Defined in firmware)

| Function | GPIO | Notes |
|----------|------|-------|
| Camera | Various | OV2640 interface |
| Servo | GPIO 12 | PWM for servo control |
| VL6180X I2C | SDA/SCL | ToF sensor |
| LED | Built-in | Flash LED |

*Note: Full pin mapping in firmware source*

---

## Power Requirements

- **Voltage:** 5V via USB or external
- **Current:** ~500mA typical, 1A peak (camera + LED)
- **Source:** USB-C or 5V pin header

---

## Troubleshooting

### Upload Fails

**Try:**
1. Hold BOOT button while connecting
2. Press RESET before upload
3. Reduce upload speed to 115200
4. Close other serial monitors
5. Check USB cable supports data transfer

### Port Busy Error

```bash
lsof | grep cu.usbmodem
kill <PID>
```

### Device Not Detected

- Try different USB port
- Install CH340 drivers
- Check cable

---

**Related Documentation:**
- [FIRMWARE-COMPILATION.md](./FIRMWARE-COMPILATION.md) - Compilation guide
- [OTA-DEPLOYMENT.md](./OTA-DEPLOYMENT.md) - OTA updates
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues
