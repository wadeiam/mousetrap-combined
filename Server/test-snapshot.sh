#!/bin/bash

# Test script for debugging snapshot capture
set -e

SERVER="http://192.168.133.110:4000"
EMAIL="your@email.com"
PASSWORD="yourpassword"

echo "=========================================="
echo "Snapshot Capture Debug Test"
echo "=========================================="
echo ""

# Step 1: Login
echo "[1/5] Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "${SERVER}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

echo "Login response: $LOGIN_RESPONSE"

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get token"
  exit 1
fi

echo "Token: ${TOKEN:0:20}..."
echo ""

# Step 2: Get devices
echo "[2/5] Getting device list..."
DEVICES_RESPONSE=$(curl -s -X GET "${SERVER}/api/devices?limit=50" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$DEVICES_RESPONSE" | jq '.'
echo ""

# Find Kitchen device
KITCHEN_DEVICE=$(echo "$DEVICES_RESPONSE" | jq -r '.data.items[] | select(.location == "Kitchen" or .name == "Kitchen") | {id: .id, deviceId: .deviceId, name: .name, location: .location, status: .status}')

if [ -z "$KITCHEN_DEVICE" ]; then
  echo "ERROR: Kitchen device not found"
  exit 1
fi

echo "Kitchen device found:"
echo "$KITCHEN_DEVICE" | jq '.'
DEVICE_ID=$(echo "$KITCHEN_DEVICE" | jq -r '.id')
DEVICE_STATUS=$(echo "$KITCHEN_DEVICE" | jq -r '.status')
echo ""
echo "Device ID: $DEVICE_ID"
echo "Device Status: $DEVICE_STATUS"
echo ""

# Step 3: Request snapshot
echo "[3/5] Requesting snapshot..."
SNAPSHOT_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${SERVER}/api/devices/${DEVICE_ID}/request-snapshot" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json")

RESPONSE_BODY=$(echo "$SNAPSHOT_RESPONSE" | sed -e 's/HTTP_CODE:.*//')
HTTP_CODE=$(echo "$SNAPSHOT_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)

echo "HTTP Status: $HTTP_CODE"
echo "Response: $RESPONSE_BODY" | jq '.'
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Snapshot request failed with status $HTTP_CODE"
  exit 1
fi

# Step 4: Check media endpoint
echo "[4/5] Checking media endpoint (wait 2 seconds)..."
sleep 2

MEDIA_RESPONSE=$(curl -s -X GET "${SERVER}/api/devices/${DEVICE_ID}/media?limit=10" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$MEDIA_RESPONSE" | jq '.'
echo ""

# Step 5: Get device details again
echo "[5/5] Getting device details..."
DEVICE_RESPONSE=$(curl -s -X GET "${SERVER}/api/devices/${DEVICE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$DEVICE_RESPONSE" | jq '.'
echo ""

echo "=========================================="
echo "Debug Summary:"
echo "=========================================="
echo "Device ID: $DEVICE_ID"
echo "Device Status: $DEVICE_STATUS"
echo "Snapshot Request: $HTTP_CODE"
echo "Media Items: $(echo "$MEDIA_RESPONSE" | jq -r '.data.pagination.total // 0')"
echo ""
