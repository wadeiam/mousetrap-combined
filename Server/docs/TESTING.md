# Testing Guide

**Test procedures and reports**

---

## Run Tests

### Unit Tests
```bash
npm test
```

### API Integration Tests
```bash
npm run test:integration
```

### Manual Testing Checklist
See: [TEST-INDEX.md](../TEST-INDEX.md)

---

## Test Reports

### Latest Report
**[TEST-REPORT-2025-11-11.md](../TEST-REPORT-2025-11-11.md)**
- Full API endpoint testing
- Device claiming flow validation
- Firmware management testing
- Alert system verification
- **Status:** All tests passing ✅

---

## Testing Procedures

### Device Claiming Flow
1. Generate claim code via API
2. Submit code from device
3. Verify device record created
4. Verify MQTT credentials added
5. Verify device connects to MQTT
6. Verify dashboard shows device

### Firmware OTA Flow
1. Upload firmware via dashboard
2. Verify MQTT notification sent
3. Verify device downloads firmware
4. Verify device flashes and reboots
5. Verify new version reported

### Alert System
1. Device publishes alert to MQTT
2. Verify server receives and stores alert
3. Verify dashboard shows alert
4. Click "Resolve" in dashboard
5. Verify server sends alert_reset command
6. Verify device clears alert and confirms

---

## Test Environment

### Database
- Use separate test database
- Reset between test runs
- Seed with test data

### MQTT
- Mock MQTT broker for unit tests
- Use real Mosquitto for integration tests

---

**Related:** [API-REFERENCE.md](./API-REFERENCE.md), [DEPLOYMENT.md](./DEPLOYMENT.md)
