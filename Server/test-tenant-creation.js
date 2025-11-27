const fetch = require('node-fetch');

async function testTenantCreation() {
  try {
    console.log('=== TESTING TENANT CREATION FUNCTIONALITY ===\n');

    // Step 1: Login to get auth token
    console.log('STEP 1: Logging in as admin@mastertenant.com...');
    const loginResponse = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@mastertenant.com',
        password: 'Admin123!'
      })
    });

    console.log(`Status: ${loginResponse.status} ${loginResponse.statusText}`);
    const loginData = await loginResponse.json();
    console.log('Response:', JSON.stringify(loginData, null, 2));

    const accessToken = loginData.data?.accessToken || loginData.accessToken;
    if (!accessToken) {
      console.error('\n❌ FAILED: No access token received!');
      return;
    }
    console.log('\n✓ Login successful');
    console.log('Token:', accessToken.substring(0, 50) + '...\n');

    // Step 2: Decode JWT to check user info
    console.log('STEP 2: Decoding JWT token...');
    const tokenParts = accessToken.split('.');
    if (tokenParts.length === 3) {
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      console.log('Token payload:', JSON.stringify(payload, null, 2));
      console.log('\nUser ID:', payload.userId);
      console.log('Email:', payload.email);
      console.log('Tenant ID:', payload.tenantId);
      console.log('Role:', payload.role);
    }

    // Step 3: Check if user is superadmin
    console.log('\n\nSTEP 3: Checking superadmin status...');
    const userResponse = await fetch('http://localhost:4000/api/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Status: ${userResponse.status} ${userResponse.statusText}`);
    const userData = await userResponse.json();
    console.log('User data:', JSON.stringify(userData, null, 2));

    // Step 4: Try to create a tenant
    console.log('\n\nSTEP 4: Attempting to create a new tenant...');
    const tenantName = `Test Tenant ${Date.now()}`;
    console.log(`Tenant name: "${tenantName}"`);

    const createResponse = await fetch('http://localhost:4000/api/tenants', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: tenantName
      })
    });

    console.log(`\nStatus: ${createResponse.status} ${createResponse.statusText}`);
    console.log('Headers:', Object.fromEntries(createResponse.headers.entries()));

    const responseText = await createResponse.text();
    console.log('\nRaw response body:', responseText);

    let createData;
    try {
      createData = JSON.parse(responseText);
      console.log('\nParsed response:', JSON.stringify(createData, null, 2));
    } catch (e) {
      console.log('Could not parse as JSON');
    }

    // Step 5: Check for CORS issues
    console.log('\n\nSTEP 5: Checking CORS headers...');
    const corsHeaders = {
      'Access-Control-Allow-Origin': createResponse.headers.get('access-control-allow-origin'),
      'Access-Control-Allow-Credentials': createResponse.headers.get('access-control-allow-credentials'),
      'Access-Control-Allow-Methods': createResponse.headers.get('access-control-allow-methods'),
      'Access-Control-Allow-Headers': createResponse.headers.get('access-control-allow-headers'),
    };
    console.log('CORS headers:', JSON.stringify(corsHeaders, null, 2));

    // Step 6: List all tenants
    console.log('\n\nSTEP 6: Listing all tenants...');
    const listResponse = await fetch('http://localhost:4000/api/tenants', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Status: ${listResponse.status} ${listResponse.statusText}`);
    const listData = await listResponse.json();
    console.log('Tenants:', JSON.stringify(listData, null, 2));

    // Step 7: Try from the dashboard IP
    console.log('\n\nSTEP 7: Testing from dashboard IP (192.168.133.110)...');
    const dashboardResponse = await fetch('http://192.168.133.110:4000/api/tenants', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Origin': 'http://192.168.133.110:5173'
      },
      body: JSON.stringify({
        name: `Dashboard Test ${Date.now()}`
      })
    });

    console.log(`Status: ${dashboardResponse.status} ${dashboardResponse.statusText}`);
    const dashboardText = await dashboardResponse.text();
    console.log('Response:', dashboardText);

    // Summary
    console.log('\n\n=== SUMMARY ===');
    console.log(`Login: ${loginResponse.status === 200 ? '✓' : '✗'}`);
    console.log(`Tenant Creation: ${createResponse.status === 201 ? '✓' : '✗'} (Status: ${createResponse.status})`);
    console.log(`List Tenants: ${listResponse.status === 200 ? '✓' : '✗'}`);

    if (createResponse.status !== 201) {
      console.log('\n❌ TENANT CREATION FAILED');
      console.log(`Status Code: ${createResponse.status}`);
      console.log(`Error: ${createData?.error || 'Unknown error'}`);
    } else {
      console.log('\n✓ TENANT CREATION SUCCESSFUL');
    }

  } catch (error) {
    console.error('\n\n❌ EXCEPTION:', error.message);
    console.error('Stack:', error.stack);
  }
}

testTenantCreation();
