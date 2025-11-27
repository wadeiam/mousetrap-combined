# Device Claim Code Management

**Generate and manage device provisioning codes**

---

## Generate Claim Code

### Via Dashboard
1. Login to dashboard
2. Navigate to Admin → Claim Codes
3. Click "Generate New Code"
4. Enter device name
5. Select tenant
6. Click "Generate"

### Via API
```bash
curl -X POST http://localhost:4000/api/admin/claim-codes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceName": "Kitchen Trap",
    "tenantId": "uuid",
    "expiresInDays": 7
  }'
```

---

## Claim Code Format

- **Length:** 8 characters
- **Character set:** Alphanumeric (no ambiguous chars: 0, O, 1, I)
- **Example:** `ABC12XYZ`
- **Expiration:** 7 days default
- **Single-use:** Marked as 'claimed' after use

---

## Claim Flow

1. **Admin generates code** via dashboard/API
2. **User enters code** on device SPA
3. **Device sends** code + MAC to server
4. **Server validates** code (not expired, not claimed)
5. **Server creates** device record with MQTT credentials
6. **Server adds** credentials to Mosquitto password file
7. **Server sends** SIGHUP to Mosquitto (reload)
8. **Device saves** credentials to NVS
9. **Device connects** to MQTT broker
10. **Server marks** code as 'claimed'

---

## Troubleshooting

### Code Not Working
- Check expiration (7 days)
- Verify not already used
- Check server logs for validation errors

### Device Claims But Can't Connect MQTT
- See [MQTT-SETUP.md](./MQTT-SETUP.md) for CONNACK code 5 troubleshooting
- Mosquitto may need manual reload

---

**Related:** [MQTT-SETUP.md](./MQTT-SETUP.md), [API-REFERENCE.md](./API-REFERENCE.md)
