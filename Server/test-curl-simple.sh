#!/bin/bash

echo "=== TESTING TENANT CREATION WITH CURL ==="
echo ""

# Step 1: Login
echo "STEP 1: Login"
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@mastertenant.com", "password": "Admin123!"}' \
  > /tmp/login.json

echo "Login response:"
cat /tmp/login.json | jq '.'
echo ""

TOKEN=$(cat /tmp/login.json | jq -r '.data.accessToken')
echo "Token: ${TOKEN:0:50}..."
echo ""

# Step 2: Create tenant
echo "STEP 2: Create tenant"
TENANT_NAME="Curl Test $(date +%s)"
curl -s -X POST http://localhost:4000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\": \"$TENANT_NAME\"}" \
  > /tmp/create.json

echo "Create response:"
cat /tmp/create.json | jq '.'
echo ""

# Step 3: List tenants
echo "STEP 3: List tenants"
curl -s -X GET http://localhost:4000/api/tenants \
  -H "Authorization: Bearer $TOKEN" \
  > /tmp/list.json

echo "List response:"
cat /tmp/list.json | jq '.'
echo ""

echo "Summary:"
echo "--------"
grep -q '"success":true' /tmp/login.json && echo "Login: SUCCESS" || echo "Login: FAILED"
grep -q '"success":true' /tmp/create.json && echo "Create: SUCCESS" || echo "Create: FAILED"
grep -q '"success":true' /tmp/list.json && echo "List: SUCCESS" || echo "List: FAILED"
