#!/bin/bash

MQTT_HOST="192.168.133.110"
MQTT_PORT="1883"
MQTT_USER="server"
MQTT_PASS="Jt6EzDnKpQrW8vY2"
TENANT_ID="00000000-0000-0000-0000-000000000001"
DEVICE_MAC="94A990306028"

echo "=========================================="
echo "Testing MQTT Snapshot Command"
echo "=========================================="
echo ""
echo "Device: $DEVICE_MAC"
echo "Tenant: $TENANT_ID"
echo ""

# Test 1: Publish to /cmd/ (CORRECT topic based on fix)
echo "[1/2] Publishing capture_snapshot to /cmd/ topic..."
TOPIC_CMD="tenant/${TENANT_ID}/device/${DEVICE_MAC}/cmd/capture_snapshot"
MESSAGE='{"command":"capture_snapshot","timestamp":'$(date +%s000)'}'

echo "Topic: $TOPIC_CMD"
echo "Message: $MESSAGE"
echo ""

mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" \
  -u "$MQTT_USER" -P "$MQTT_PASS" \
  -t "$TOPIC_CMD" \
  -m "$MESSAGE" \
  -q 1

if [ $? -eq 0 ]; then
  echo "✓ Published successfully to /cmd/ topic"
else
  echo "✗ Failed to publish to /cmd/ topic"
fi

echo ""
echo "[2/2] Waiting 3 seconds for device response..."
sleep 3

echo ""
echo "=========================================="
echo "Check PM2 logs for:"
echo "  1. MQTT Published command message"
echo "  2. Device snapshot response"
echo "=========================================="
