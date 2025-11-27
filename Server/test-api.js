const fetch = require('node-fetch');

async function test() {
  try {
    console.log('Testing API on port 4000...\n');

    // 1. Login
    console.log('1. Logging in...');
    const loginResponse = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@mastertenant.com',
        password: 'Admin123!'
      })
    });

    const loginData = await loginResponse.json();
    console.log('Login response:', JSON.stringify(loginData, null, 2));

    const accessToken = loginData.data?.accessToken || loginData.accessToken;
    if (!accessToken) {
      console.error('No access token received!');
      return;
    }

    // 2. Get devices
    console.log('\n2. Fetching devices...');
    const devicesResponse = await fetch('http://localhost:4000/api/devices', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const devicesData = await devicesResponse.json();
    console.log('Devices response:', JSON.stringify(devicesData, null, 2));
    console.log(`\nFound ${Array.isArray(devicesData) ? devicesData.length : 0} devices`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
