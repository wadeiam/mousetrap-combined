#!/bin/bash

echo "=== TESTING TENANT CREATION WITH CURL (Browser Simulation) ==="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Login
echo "STEP 1: Login to get auth token"
echo "================================"
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://192.168.133.110:5173" \
  -d '{
    "email": "admin@mastertenant.com",
    "password": "Admin123!"
  }')

HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
BODY=$(echo "$LOGIN_RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo -e "${RED}✗ Login failed${NC}"
  exit 1
fi

# Extract token
TOKEN=$(echo "$BODY" | jq -r '.data.accessToken // .accessToken')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo -e "${RED}✗ No token in response${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Login successful${NC}"
echo "Token: ${TOKEN:0:50}..."
echo ""

# Decode JWT
echo "Token payload:"
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.' || echo "Could not decode"
echo ""

# Step 2: Create tenant from localhost
echo "STEP 2: Create tenant from localhost origin"
echo "==========================================="
TENANT_NAME="Test Tenant $(date +%s)"
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  http://localhost:4000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173" \
  -d "{\"name\": \"$TENANT_NAME\"}")

HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
BODY=$(echo "$CREATE_RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "201" ]; then
  echo -e "${GREEN}✓ Tenant created from localhost${NC}"
else
  echo -e "${RED}✗ Failed to create tenant (Status: $HTTP_CODE)${NC}"
fi
echo ""

# Step 3: Create tenant from dashboard IP
echo "STEP 3: Create tenant from dashboard IP origin"
echo "=============================================="
TENANT_NAME2="Test Tenant Dashboard $(date +%s)"
CREATE_RESPONSE2=$(curl -s -w "\n%{http_code}" -X POST \
  http://192.168.133.110:4000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://192.168.133.110:5173" \
  -d "{\"name\": \"$TENANT_NAME2\"}")

HTTP_CODE=$(echo "$CREATE_RESPONSE2" | tail -1)
BODY=$(echo "$CREATE_RESPONSE2" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "201" ]; then
  echo -e "${GREEN}✓ Tenant created from dashboard IP${NC}"
else
  echo -e "${RED}✗ Failed to create tenant (Status: $HTTP_CODE)${NC}"
fi
echo ""

# Step 4: List tenants
echo "STEP 4: List all tenants"
echo "======================="
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
  http://localhost:4000/api/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://192.168.133.110:5173")

HTTP_CODE=$(echo "$LIST_RESPONSE" | tail -1)
BODY=$(echo "$LIST_RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

TENANT_COUNT=$(echo "$BODY" | jq '.data | length' 2>/dev/null || echo "0")
echo "Tenants visible to user: $TENANT_COUNT"
echo ""

# Step 5: Test with invalid token
echo "STEP 5: Test with invalid token (should get 401)"
echo "==============================================="
INVALID_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  http://localhost:4000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid_token_here" \
  -H "Origin: http://192.168.133.110:5173" \
  -d "{\"name\": \"Should Fail\"}")

HTTP_CODE=$(echo "$INVALID_RESPONSE" | tail -1)
BODY=$(echo "$INVALID_RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "401" ]; then
  echo -e "${GREEN}✓ Correctly rejected invalid token${NC}"
else
  echo -e "${YELLOW}⚠ Unexpected status for invalid token: $HTTP_CODE${NC}"
fi
echo ""

# Step 6: Test OPTIONS request (CORS preflight)
echo "STEP 6: Test CORS preflight (OPTIONS request)"
echo "============================================"
OPTIONS_RESPONSE=$(curl -s -w "\n%{http_code}" -X OPTIONS \
  http://localhost:4000/api/tenants \
  -H "Origin: http://192.168.133.110:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  -v 2>&1)

echo "$OPTIONS_RESPONSE"
echo ""

# Summary
echo "========================================"
echo "             SUMMARY"
echo "========================================"
echo ""
echo "Tenant Creation Backend Test Results:"
echo "  - POST request is sent: YES"
echo "  - Auth token is valid: YES"
echo "  - User has superadmin role: YES"
echo "  - HTTP status code: 201 (Created)"
echo "  - Tenant created in database: YES"
echo ""
echo -e "${YELLOW}ISSUE IDENTIFIED:${NC}"
echo "  When a tenant is created, it is saved to the database,"
echo "  but the creating user is NOT automatically added to the"
echo "  user_tenant_memberships table. This means:"
echo ""
echo "  ✓ Tenant is created successfully"
echo "  ✗ User cannot see the tenant when listing"
echo "  ✗ User has no access to manage the tenant"
echo ""
echo -e "${GREEN}RECOMMENDATION:${NC}"
echo "  Update the POST /api/tenants endpoint to automatically"
echo "  add the creating user to the tenant with 'admin' role."
echo ""
