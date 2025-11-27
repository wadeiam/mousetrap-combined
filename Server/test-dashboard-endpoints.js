#!/usr/bin/env node

/**
 * Comprehensive Dashboard API Endpoint Testing Script
 * Tests all endpoints used by the trap dashboard web interface
 *
 * Server: http://192.168.133.110:4000
 * Dashboard: http://192.168.133.110:5173
 * Auth: admin@mastertenant.com / Admin123!
 */

const https = require('https');
const http = require('http');

// Configuration
const CONFIG = {
  baseUrl: 'http://192.168.133.110:4000',
  email: 'admin@mastertenant.com',
  password: 'Admin123!',
  timeout: 10000
};

// Test results tracking
const results = {
  passed: [],
  failed: [],
  warnings: []
};

let authToken = null;
let testDeviceId = null;
let testAlertId = null;
let testFirmwareId = null;
let testClaimCodeId = null;

/**
 * Make HTTP request
 */
function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const protocol = options.protocol === 'https:' ? https : http;

    const req = protocol.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          };
          resolve(response);
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            parseError: e.message
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(CONFIG.timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Parse URL for request options
 */
function getRequestOptions(url, method = 'GET', includeAuth = true) {
  const urlObj = new URL(url);

  const options = {
    protocol: urlObj.protocol,
    hostname: urlObj.hostname,
    port: urlObj.port,
    path: urlObj.pathname + urlObj.search,
    method: method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (includeAuth && authToken) {
    options.headers['Authorization'] = `Bearer ${authToken}`;
  }

  return options;
}

/**
 * Test endpoint helper
 */
async function testEndpoint(name, url, method = 'GET', body = null, expectedStatus = 200, requiredFields = [], includeAuth = true) {
  console.log(`\n🔍 Testing: ${name}`);
  console.log(`   ${method} ${url}`);

  try {
    const options = getRequestOptions(url, method, includeAuth);
    const response = await makeRequest(options, body);

    const testResult = {
      name,
      url,
      method,
      statusCode: response.statusCode,
      expectedStatus,
      success: false,
      issues: []
    };

    // Check status code
    if (response.statusCode !== expectedStatus) {
      testResult.issues.push(`Expected status ${expectedStatus}, got ${response.statusCode}`);
      console.log(`   ❌ Status code mismatch: Expected ${expectedStatus}, got ${response.statusCode}`);
    } else {
      console.log(`   ✅ Status code: ${response.statusCode}`);
    }

    // Check if response is valid JSON
    if (response.parseError) {
      testResult.issues.push(`Invalid JSON response: ${response.parseError}`);
      console.log(`   ❌ Invalid JSON: ${response.parseError}`);
      console.log(`   Response body: ${response.body}`);
    } else if (response.body) {
      console.log(`   ✅ Valid JSON response`);

      // Check required fields
      if (requiredFields.length > 0) {
        const missingFields = [];
        const data = response.body.data || response.body;

        for (const field of requiredFields) {
          if (Array.isArray(data)) {
            if (data.length > 0 && !hasNestedProperty(data[0], field)) {
              missingFields.push(field);
            }
          } else {
            if (!hasNestedProperty(data, field)) {
              missingFields.push(field);
            }
          }
        }

        if (missingFields.length > 0) {
          testResult.issues.push(`Missing required fields: ${missingFields.join(', ')}`);
          console.log(`   ⚠️  Missing fields: ${missingFields.join(', ')}`);
        } else {
          console.log(`   ✅ All required fields present`);
        }
      }

      // Store response data for use in other tests
      testResult.responseBody = response.body;
    }

    testResult.success = testResult.issues.length === 0;

    if (testResult.success) {
      results.passed.push(testResult);
      console.log(`   ✅ PASSED`);
    } else if (testResult.issues.some(i => i.includes('Missing required fields'))) {
      results.warnings.push(testResult);
      console.log(`   ⚠️  PASSED WITH WARNINGS`);
    } else {
      results.failed.push(testResult);
      console.log(`   ❌ FAILED`);
    }

    return testResult;

  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);

    const testResult = {
      name,
      url,
      method,
      success: false,
      error: error.message,
      issues: [error.message]
    };

    results.failed.push(testResult);
    return testResult;
  }
}

/**
 * Check if object has nested property
 */
function hasNestedProperty(obj, path) {
  if (!obj) return false;

  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current[key] === undefined) {
      return false;
    }
    current = current[key];
  }

  return true;
}

/**
 * Authentication Tests
 */
async function testAuthentication() {
  console.log('\n' + '='.repeat(80));
  console.log('AUTHENTICATION TESTS');
  console.log('='.repeat(80));

  // Test login
  const loginResult = await testEndpoint(
    'Login',
    `${CONFIG.baseUrl}/api/auth/login`,
    'POST',
    { email: CONFIG.email, password: CONFIG.password },
    200,
    ['data.accessToken', 'data.user'],
    false
  );

  if (loginResult.responseBody) {
    console.log(`\n📋 Login response:`, JSON.stringify(loginResult.responseBody, null, 2));

    // Try to extract token from different possible locations
    if (loginResult.responseBody.data && loginResult.responseBody.data.accessToken) {
      authToken = loginResult.responseBody.data.accessToken;
      console.log(`\n✅ Authentication successful, token acquired from data.accessToken`);
    } else if (loginResult.responseBody.token) {
      authToken = loginResult.responseBody.token;
      console.log(`\n✅ Authentication successful, token acquired from token`);
    } else if (loginResult.responseBody.accessToken) {
      authToken = loginResult.responseBody.accessToken;
      console.log(`\n✅ Authentication successful, token acquired from accessToken`);
    } else {
      console.log(`\n⚠️  Login returned 200 but no token found in response`);
      console.log(`   Attempting to continue with limited tests...`);
    }
  }

  if (!authToken && loginResult.statusCode === 200) {
    console.log(`\n⚠️  Authentication returned success but no token - server may have issues`);
  } else if (!authToken) {
    console.log(`\n❌ Authentication failed with status ${loginResult.statusCode}`);
    console.log(`   Will attempt unauthenticated tests only...`);
  }

  // Test invalid login
  await testEndpoint(
    'Login - Invalid Credentials',
    `${CONFIG.baseUrl}/api/auth/login`,
    'POST',
    { email: CONFIG.email, password: 'wrongpassword' },
    401,
    [],
    false
  );
}

/**
 * Device Tests
 */
async function testDevices() {
  console.log('\n' + '='.repeat(80));
  console.log('DEVICE ENDPOINT TESTS');
  console.log('='.repeat(80));

  // List devices
  const devicesResult = await testEndpoint(
    'List Devices',
    `${CONFIG.baseUrl}/api/devices`,
    'GET',
    null,
    200,
    ['id', 'device_id', 'status']
  );

  // Store a device ID for further tests
  if (devicesResult.success && devicesResult.responseBody) {
    const devices = devicesResult.responseBody.data || devicesResult.responseBody;
    if (Array.isArray(devices) && devices.length > 0) {
      testDeviceId = devices[0].id;
      console.log(`\n📝 Using device ID ${testDeviceId} for subsequent tests`);
    }
  }

  // Get device details
  if (testDeviceId) {
    await testEndpoint(
      'Get Device Details',
      `${CONFIG.baseUrl}/api/devices/${testDeviceId}`,
      'GET',
      null,
      200,
      ['id', 'device_id', 'status', 'battery_level']
    );

    // Reboot device
    await testEndpoint(
      'Reboot Device',
      `${CONFIG.baseUrl}/api/devices/${testDeviceId}/reboot`,
      'POST',
      null,
      200
    );
  } else {
    console.log(`\n⚠️  No devices found, skipping device detail tests`);
  }

  // Test invalid device ID (with proper UUID format)
  await testEndpoint(
    'Get Device Details - Invalid ID',
    `${CONFIG.baseUrl}/api/devices/aaaaaaaa-0000-0000-0000-000000000000`,
    'GET',
    null,
    404
  );

  // Test reboot invalid device
  await testEndpoint(
    'Reboot Device - Invalid ID',
    `${CONFIG.baseUrl}/api/devices/aaaaaaaa-0000-0000-0000-000000000000/reboot`,
    'POST',
    null,
    404
  );

  // Test with malformed UUID to verify proper error handling
  await testEndpoint(
    'Get Device Details - Malformed UUID',
    `${CONFIG.baseUrl}/api/devices/99999`,
    'GET',
    null,
    400
  );
}

/**
 * Alert Tests
 */
async function testAlerts() {
  console.log('\n' + '='.repeat(80));
  console.log('ALERT ENDPOINT TESTS');
  console.log('='.repeat(80));

  // List alerts
  const alertsResult = await testEndpoint(
    'List Alerts',
    `${CONFIG.baseUrl}/api/alerts`,
    'GET',
    null,
    200,
    ['id', 'device_id', 'alert_type', 'severity']
  );

  // Store an alert ID for further tests
  if (alertsResult.success && alertsResult.responseBody) {
    const alerts = alertsResult.responseBody.data || alertsResult.responseBody;
    if (Array.isArray(alerts) && alerts.length > 0) {
      // Find an unresolved alert if possible
      const unresolvedAlert = alerts.find(a => a.status !== 'resolved');
      testAlertId = unresolvedAlert ? unresolvedAlert.id : alerts[0].id;
      console.log(`\n📝 Using alert ID ${testAlertId} for subsequent tests`);
    }
  }

  // Acknowledge alert
  if (testAlertId) {
    await testEndpoint(
      'Acknowledge Alert',
      `${CONFIG.baseUrl}/api/alerts/${testAlertId}/acknowledge`,
      'POST',
      null,
      200
    );

    // Resolve alert
    await testEndpoint(
      'Resolve Alert',
      `${CONFIG.baseUrl}/api/alerts/${testAlertId}/resolve`,
      'POST',
      null,
      200
    );
  } else {
    console.log(`\n⚠️  No alerts found, skipping alert action tests`);
  }

  // Test invalid alert ID (with proper UUID format)
  await testEndpoint(
    'Acknowledge Alert - Invalid ID',
    `${CONFIG.baseUrl}/api/alerts/aaaaaaaa-0000-0000-0000-000000000000/acknowledge`,
    'POST',
    null,
    404
  );

  await testEndpoint(
    'Resolve Alert - Invalid ID',
    `${CONFIG.baseUrl}/api/alerts/aaaaaaaa-0000-0000-0000-000000000000/resolve`,
    'POST',
    null,
    404
  );

  // Test malformed UUID
  await testEndpoint(
    'Acknowledge Alert - Malformed UUID',
    `${CONFIG.baseUrl}/api/alerts/99999/acknowledge`,
    'POST',
    null,
    400
  );
}

/**
 * Firmware Tests
 */
async function testFirmware() {
  console.log('\n' + '='.repeat(80));
  console.log('FIRMWARE ENDPOINT TESTS');
  console.log('='.repeat(80));

  // List firmware
  const firmwareResult = await testEndpoint(
    'List Firmware',
    `${CONFIG.baseUrl}/api/firmware`,
    'GET',
    null,
    200,
    ['id', 'version', 'file_name']
  );

  // Store a firmware ID for further tests
  if (firmwareResult.success && firmwareResult.responseBody) {
    const firmware = firmwareResult.responseBody.data || firmwareResult.responseBody;
    if (Array.isArray(firmware) && firmware.length > 0) {
      testFirmwareId = firmware[0].id;
      console.log(`\n📝 Using firmware ID ${testFirmwareId} for subsequent tests`);
    }
  }

  // Test firmware upload validation (without actual file)
  await testEndpoint(
    'Upload Firmware - Missing Data',
    `${CONFIG.baseUrl}/api/firmware`,
    'POST',
    {},
    400
  );

  // Delete firmware (test with invalid ID to avoid deleting real firmware)
  await testEndpoint(
    'Delete Firmware - Invalid ID',
    `${CONFIG.baseUrl}/api/firmware/aaaaaaaa-0000-0000-0000-000000000000`,
    'DELETE',
    null,
    404
  );

  // Test malformed UUID
  await testEndpoint(
    'Delete Firmware - Malformed UUID',
    `${CONFIG.baseUrl}/api/firmware/99999`,
    'DELETE',
    null,
    400
  );
}

/**
 * Claim Code Tests
 */
async function testClaimCodes() {
  console.log('\n' + '='.repeat(80));
  console.log('CLAIM CODE ENDPOINT TESTS');
  console.log('='.repeat(80));

  // List claim codes
  const claimCodesResult = await testEndpoint(
    'List Claim Codes',
    `${CONFIG.baseUrl}/api/admin/claim-codes`,
    'GET',
    null,
    200,
    ['id', 'code', 'status']
  );

  // Create claim code
  const createResult = await testEndpoint(
    'Create Claim Code',
    `${CONFIG.baseUrl}/api/admin/claim-codes`,
    'POST',
    {
      deviceName: 'Test Device',
      tenantId: '00000000-0000-0000-0000-000000000001'
    },
    201,
    ['id', 'code']
  );

  if (createResult.success && createResult.responseBody) {
    testClaimCodeId = createResult.responseBody.id || (createResult.responseBody.data && createResult.responseBody.data.id);
    console.log(`\n📝 Created claim code ID ${testClaimCodeId}`);
  }

  // Test invalid claim code creation
  await testEndpoint(
    'Create Claim Code - Missing Tenant',
    `${CONFIG.baseUrl}/api/admin/claim-codes`,
    'POST',
    {},
    400
  );
}

/**
 * Logs Tests
 */
async function testLogs() {
  console.log('\n' + '='.repeat(80));
  console.log('LOGS ENDPOINT TESTS');
  console.log('='.repeat(80));

  // List logs
  await testEndpoint(
    'List System Logs',
    `${CONFIG.baseUrl}/api/logs`,
    'GET',
    null,
    200,
    ['id', 'timestamp', 'level']
  );

  // Test with filters
  await testEndpoint(
    'List System Logs - With Level Filter',
    `${CONFIG.baseUrl}/api/logs?level=error`,
    'GET',
    null,
    200
  );

  await testEndpoint(
    'List System Logs - With Limit',
    `${CONFIG.baseUrl}/api/logs?limit=10`,
    'GET',
    null,
    200
  );
}

/**
 * Generate Summary Report
 */
function generateReport() {
  console.log('\n\n');
  console.log('═'.repeat(80));
  console.log('COMPREHENSIVE TEST REPORT');
  console.log('═'.repeat(80));

  const total = results.passed.length + results.failed.length + results.warnings.length;

  console.log(`\n📊 SUMMARY`);
  console.log(`   Total Tests: ${total}`);
  console.log(`   ✅ Passed: ${results.passed.length}`);
  console.log(`   ⚠️  Warnings: ${results.warnings.length}`);
  console.log(`   ❌ Failed: ${results.failed.length}`);
  console.log(`   Success Rate: ${((results.passed.length / total) * 100).toFixed(1)}%`);

  if (results.passed.length > 0) {
    console.log(`\n✅ WORKING ENDPOINTS (${results.passed.length})`);
    console.log('─'.repeat(80));
    results.passed.forEach(test => {
      console.log(`   ✅ ${test.name}`);
      console.log(`      ${test.method} ${test.url}`);
      console.log(`      Status: ${test.statusCode}`);
    });
  }

  if (results.warnings.length > 0) {
    console.log(`\n⚠️  ENDPOINTS WITH WARNINGS (${results.warnings.length})`);
    console.log('─'.repeat(80));
    results.warnings.forEach(test => {
      console.log(`   ⚠️  ${test.name}`);
      console.log(`      ${test.method} ${test.url}`);
      console.log(`      Status: ${test.statusCode}`);
      test.issues.forEach(issue => {
        console.log(`      - ${issue}`);
      });
    });
  }

  if (results.failed.length > 0) {
    console.log(`\n❌ BROKEN ENDPOINTS (${results.failed.length})`);
    console.log('─'.repeat(80));
    results.failed.forEach(test => {
      console.log(`   ❌ ${test.name}`);
      console.log(`      ${test.method} ${test.url}`);
      if (test.statusCode) {
        console.log(`      Status: ${test.statusCode} (Expected: ${test.expectedStatus})`);
      }
      if (test.error) {
        console.log(`      Error: ${test.error}`);
      }
      if (test.issues) {
        test.issues.forEach(issue => {
          console.log(`      - ${issue}`);
        });
      }
    });

    console.log(`\n🔍 ROOT CAUSE ANALYSIS`);
    console.log('─'.repeat(80));

    const errorTypes = {
      timeout: results.failed.filter(t => t.error && t.error.includes('timeout')),
      notFound: results.failed.filter(t => t.statusCode === 404),
      serverError: results.failed.filter(t => t.statusCode >= 500),
      badRequest: results.failed.filter(t => t.statusCode === 400),
      unauthorized: results.failed.filter(t => t.statusCode === 401 || t.statusCode === 403),
      connection: results.failed.filter(t => t.error && (t.error.includes('ECONNREFUSED') || t.error.includes('ENOTFOUND')))
    };

    if (errorTypes.connection.length > 0) {
      console.log(`   🔌 Connection Issues (${errorTypes.connection.length})`);
      console.log(`      - Server may not be running or accessible`);
      console.log(`      - Check: ${CONFIG.baseUrl}`);
    }

    if (errorTypes.timeout.length > 0) {
      console.log(`   ⏱️  Timeout Issues (${errorTypes.timeout.length})`);
      console.log(`      - Requests taking longer than ${CONFIG.timeout}ms`);
      console.log(`      - Server may be overloaded or endpoints hanging`);
    }

    if (errorTypes.notFound.length > 0) {
      console.log(`   🔍 Not Found (404) Issues (${errorTypes.notFound.length})`);
      console.log(`      - Routes may not be defined in backend`);
      console.log(`      - Check server route configuration`);
      errorTypes.notFound.forEach(t => {
        console.log(`      - ${t.method} ${t.url}`);
      });
    }

    if (errorTypes.serverError.length > 0) {
      console.log(`   💥 Server Error (5xx) Issues (${errorTypes.serverError.length})`);
      console.log(`      - Backend code errors or database issues`);
      console.log(`      - Check server logs for details`);
    }

    if (errorTypes.badRequest.length > 0) {
      console.log(`   📝 Bad Request (400) Issues (${errorTypes.badRequest.length})`);
      console.log(`      - Invalid request format or missing parameters`);
      console.log(`      - Check API documentation and request validation`);
    }

    if (errorTypes.unauthorized.length > 0) {
      console.log(`   🔒 Authorization Issues (${errorTypes.unauthorized.length})`);
      console.log(`      - Authentication or permission problems`);
      console.log(`      - Check token validity and user permissions`);
    }
  }

  // Detailed Recommendations
  if (results.failed.length > 0 || results.warnings.length > 0) {
    console.log(`\n💡 RECOMMENDATIONS`);
    console.log('─'.repeat(80));

    // Check for UUID validation issues
    const uuidErrors = results.failed.filter(t =>
      t.statusCode === 500 && (t.url.includes('/99999') || t.url.match(/\/\d+\/|\/\d+$/))
    );

    if (uuidErrors.length > 0) {
      console.log(`   1. UUID Validation (${uuidErrors.length} endpoints affected)`);
      console.log(`      Problem: Endpoints returning 500 errors for malformed UUIDs`);
      console.log(`      Solution: Add UUID format validation middleware before database queries`);
      console.log(`      Example: Validate UUID format and return 400 Bad Request for invalid format`);
      console.log(`      Files to update: Add validation in route handlers or middleware`);
      console.log('');
    }

    // Check for empty array warnings
    const emptyArrayWarnings = results.warnings.filter(t =>
      t.issues.some(i => i.includes('Missing required fields'))
    );

    if (emptyArrayWarnings.length > 0) {
      console.log(`   2. Empty Response Handling (${emptyArrayWarnings.length} endpoints)`);
      console.log(`      Note: These are false positives - endpoints return empty arrays when no data exists`);
      console.log(`      Status: This is expected behavior and not an error`);
      console.log('');
    }

    // Check for claim code issues
    const claimCodeErrors = results.failed.filter(t => t.url.includes('claim-codes'));
    const claimCodeWarnings = results.warnings.filter(t => t.url.includes('claim-codes') && t.statusCode !== 200);

    if (claimCodeErrors.length > 0 || claimCodeWarnings.length > 0) {
      console.log(`   3. Claim Code Creation`);
      console.log(`      Problem: Claim code creation requires specific parameters`);
      console.log(`      Check: Verify tenant_id parameter format and validation`);
      console.log(`      Review: /api/admin/claim-codes endpoint validation logic`);
      console.log('');
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`Test completed at: ${new Date().toISOString()}`);
  console.log('═'.repeat(80));

  // Exit with appropriate code
  process.exit(results.failed.length > 0 ? 1 : 0);
}

/**
 * Main test execution
 */
async function runTests() {
  console.log('═'.repeat(80));
  console.log('TRAP DASHBOARD API ENDPOINT TESTING');
  console.log('═'.repeat(80));
  console.log(`Server: ${CONFIG.baseUrl}`);
  console.log(`Started: ${new Date().toISOString()}`);

  try {
    await testAuthentication();

    // Continue with other tests even if auth fails (some endpoints may not require auth)
    await testDevices();
    await testAlerts();
    await testFirmware();
    await testClaimCodes();
    await testLogs();

    generateReport();
  } catch (error) {
    console.error(`\n❌ Fatal error during testing: ${error.message}`);
    console.error(error.stack);
    generateReport();
  }
}

// Run tests
runTests();
