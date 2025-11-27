#!/bin/bash

# ============================================================================
# Trap Dashboard API - Verification Commands
# ============================================================================
#
# This script contains curl commands to manually verify all API endpoints
# tested by the automated test suite.
#
# Usage:
#   1. Update the TOKEN variable below with a valid JWT token
#   2. Run individual commands or source this file: source VERIFICATION-COMMANDS.sh
#   3. Or run all tests: bash VERIFICATION-COMMANDS.sh
#
# Server: http://192.168.133.110:4000
# ============================================================================

BASE_URL="http://192.168.133.110:4000"
EMAIL="admin@mastertenant.com"
PASSWORD="Admin123!"

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================================================"
echo "TRAP DASHBOARD API VERIFICATION COMMANDS"
echo "============================================================================"
echo ""

# ============================================================================
# 1. AUTHENTICATION
# ============================================================================

echo -e "${YELLOW}1. AUTHENTICATION${NC}"
echo "----------------------------------------------------------------------------"

echo -e "\n${GREEN}✅ Test: Login (valid credentials)${NC}"
echo "Expected: 200 OK with accessToken and refreshToken"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$LOGIN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$LOGIN_RESPONSE"

# Extract token for subsequent requests
TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo -e "${RED}❌ Failed to get authentication token${NC}"
  exit 1
fi

echo -e "\n${GREEN}Token acquired successfully!${NC}"
echo "Token: ${TOKEN:0:50}..."

echo -e "\n${GREEN}✅ Test: Login (invalid credentials)${NC}"
echo "Expected: 401 Unauthorized"
curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mastertenant.com","password":"wrongpassword"}' | python3 -m json.tool

# ============================================================================
# 2. DEVICE MANAGEMENT
# ============================================================================

echo -e "\n\n${YELLOW}2. DEVICE MANAGEMENT${NC}"
echo "----------------------------------------------------------------------------"

echo -e "\n${GREEN}✅ Test: List all devices${NC}"
echo "Expected: 200 OK with paginated device list"
DEVICES_RESPONSE=$(curl -s "$BASE_URL/api/devices" \
  -H "Authorization: Bearer $TOKEN")
echo "$DEVICES_RESPONSE" | python3 -m json.tool

# Extract first device ID if exists
DEVICE_ID=$(echo "$DEVICES_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ ! -z "$DEVICE_ID" ]; then
  echo -e "\n${GREEN}✅ Test: Get device details (valid ID)${NC}"
  echo "Device ID: $DEVICE_ID"
  echo "Expected: 200 OK with device details"
  curl -s "$BASE_URL/api/devices/$DEVICE_ID" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

  echo -e "\n${GREEN}✅ Test: Reboot device${NC}"
  echo "Expected: 200 OK with reboot command confirmation"
  curl -s -X POST "$BASE_URL/api/devices/$DEVICE_ID/reboot" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
fi

echo -e "\n${GREEN}✅ Test: Get device (non-existent UUID)${NC}"
echo "Expected: 404 Not Found"
curl -s "$BASE_URL/api/devices/aaaaaaaa-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo -e "\n${RED}❌ Test: Get device (malformed UUID) - KNOWN BUG${NC}"
echo "Expected: 400 Bad Request"
echo "Actual: 500 Internal Server Error"
curl -s "$BASE_URL/api/devices/99999" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# ============================================================================
# 3. ALERT MANAGEMENT
# ============================================================================

echo -e "\n\n${YELLOW}3. ALERT MANAGEMENT${NC}"
echo "----------------------------------------------------------------------------"

echo -e "\n${GREEN}✅ Test: List all alerts${NC}"
echo "Expected: 200 OK with paginated alert list"
ALERTS_RESPONSE=$(curl -s "$BASE_URL/api/alerts" \
  -H "Authorization: Bearer $TOKEN")
echo "$ALERTS_RESPONSE" | python3 -m json.tool

# Extract first alert ID if exists
ALERT_ID=$(echo "$ALERTS_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ ! -z "$ALERT_ID" ]; then
  echo -e "\n${GREEN}✅ Test: Acknowledge alert${NC}"
  echo "Alert ID: $ALERT_ID"
  echo "Expected: 200 OK"
  curl -s -X POST "$BASE_URL/api/alerts/$ALERT_ID/acknowledge" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

  echo -e "\n${GREEN}✅ Test: Resolve alert${NC}"
  echo "Expected: 200 OK"
  curl -s -X POST "$BASE_URL/api/alerts/$ALERT_ID/resolve" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
fi

echo -e "\n${GREEN}✅ Test: Acknowledge alert (non-existent UUID)${NC}"
echo "Expected: 404 Not Found"
curl -s -X POST "$BASE_URL/api/alerts/aaaaaaaa-0000-0000-0000-000000000000/acknowledge" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo -e "\n${RED}❌ Test: Acknowledge alert (malformed UUID) - KNOWN BUG${NC}"
echo "Expected: 400 Bad Request"
echo "Actual: 500 Internal Server Error"
curl -s -X POST "$BASE_URL/api/alerts/99999/acknowledge" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# ============================================================================
# 4. FIRMWARE MANAGEMENT
# ============================================================================

echo -e "\n\n${YELLOW}4. FIRMWARE MANAGEMENT${NC}"
echo "----------------------------------------------------------------------------"

echo -e "\n${GREEN}✅ Test: List all firmware${NC}"
echo "Expected: 200 OK with firmware list"
FIRMWARE_RESPONSE=$(curl -s "$BASE_URL/api/firmware" \
  -H "Authorization: Bearer $TOKEN")
echo "$FIRMWARE_RESPONSE" | python3 -m json.tool

echo -e "\n${GREEN}✅ Test: Upload firmware (missing data)${NC}"
echo "Expected: 400 Bad Request"
curl -s -X POST "$BASE_URL/api/firmware" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

echo -e "\n${GREEN}✅ Test: Delete firmware (non-existent UUID)${NC}"
echo "Expected: 404 Not Found"
curl -s -X DELETE "$BASE_URL/api/firmware/aaaaaaaa-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo -e "\n${RED}❌ Test: Delete firmware (malformed UUID) - KNOWN BUG${NC}"
echo "Expected: 400 Bad Request"
echo "Actual: 500 Internal Server Error"
curl -s -X DELETE "$BASE_URL/api/firmware/99999" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# ============================================================================
# 5. CLAIM CODE MANAGEMENT
# ============================================================================

echo -e "\n\n${YELLOW}5. CLAIM CODE MANAGEMENT${NC}"
echo "----------------------------------------------------------------------------"

echo -e "\n${GREEN}✅ Test: List claim codes${NC}"
echo "Expected: 200 OK with claim code list"
curl -s "$BASE_URL/api/admin/claim-codes" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo -e "\n${GREEN}✅ Test: Create claim code${NC}"
echo "Expected: 201 Created (currently returns 200)"
curl -s -X POST "$BASE_URL/api/admin/claim-codes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceName":"Test Device","tenantId":"00000000-0000-0000-0000-000000000001"}' | python3 -m json.tool

echo -e "\n${GREEN}✅ Test: Create claim code (missing params)${NC}"
echo "Expected: 400 Bad Request"
curl -s -X POST "$BASE_URL/api/admin/claim-codes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

# ============================================================================
# 6. SYSTEM LOGS
# ============================================================================

echo -e "\n\n${YELLOW}6. SYSTEM LOGS${NC}"
echo "----------------------------------------------------------------------------"

echo -e "\n${GREEN}✅ Test: List logs${NC}"
echo "Expected: 200 OK with log entries"
curl -s "$BASE_URL/api/logs" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo -e "\n${GREEN}✅ Test: List logs with level filter${NC}"
echo "Expected: 200 OK with filtered logs"
curl -s "$BASE_URL/api/logs?level=error" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo -e "\n${GREEN}✅ Test: List logs with limit${NC}"
echo "Expected: 200 OK with limited results"
curl -s "$BASE_URL/api/logs?limit=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# ============================================================================
# SUMMARY
# ============================================================================

echo -e "\n\n${YELLOW}============================================================================${NC}"
echo -e "${YELLOW}TEST SUMMARY${NC}"
echo -e "${YELLOW}============================================================================${NC}"
echo ""
echo -e "${GREEN}✅ Working Endpoints:${NC}"
echo "   - Authentication (login, invalid credentials)"
echo "   - Device listing and details"
echo "   - Alert listing and management"
echo "   - Firmware listing and validation"
echo "   - Claim code management"
echo "   - System logs with filtering"
echo ""
echo -e "${RED}❌ Known Issues:${NC}"
echo "   - Malformed UUIDs return 500 instead of 400"
echo "   - Affected: /api/devices/:id, /api/alerts/:id/*, /api/firmware/:id"
echo "   - Fix: Add UUID validation middleware"
echo ""
echo -e "${YELLOW}⚠️  Minor Issues:${NC}"
echo "   - Claim code creation returns 200 instead of 201"
echo ""
echo "For detailed report, see: TEST-REPORT-2025-11-11.md"
echo "For fix example, see: uuid-validation-fix-example.js"
echo ""
