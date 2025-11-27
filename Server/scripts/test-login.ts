#!/usr/bin/env tsx

/**
 * Script to test login endpoint and see the full response
 * Usage: tsx scripts/test-login.ts <email> <password>
 */

async function testLogin(email: string, password: string) {
  const API_URL = process.env.API_URL || 'http://localhost:3000';

  console.log(`\n🔍 Testing login for: ${email}`);
  console.log(`📡 API URL: ${API_URL}/api/auth/login\n`);

  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    console.log('📊 Response Status:', response.status);
    console.log('📊 Response Status Text:', response.statusText);
    console.log('\n📦 Full Response Data:');
    console.log(JSON.stringify(data, null, 2));

    if (data.success && data.data) {
      console.log('\n✅ Login successful!');
      console.log('\n👤 User Info:');
      console.log('   ID:', data.data.user.id);
      console.log('   Email:', data.data.user.email);
      console.log('   2FA Enabled:', data.data.user.twoFactorEnabled);
      console.log('\n🏢 Tenant Memberships:');
      if (data.data.user.tenants && data.data.user.tenants.length > 0) {
        data.data.user.tenants.forEach((membership: any, index: number) => {
          console.log(`   ${index + 1}. ${membership.tenant_name}`);
          console.log(`      Tenant ID: ${membership.tenant_id}`);
          console.log(`      Role: ${membership.role}`);
        });
      } else {
        console.log('   ⚠️  No tenant memberships found!');
      }
    } else {
      console.log('\n❌ Login failed!');
      console.log('Error:', data.error || 'Unknown error');
    }

  } catch (error) {
    console.error('❌ Request failed:', error);
    process.exit(1);
  }
}

// Main execution
const email = process.argv[2] || 'admin@mastertenant.com';
const password = process.argv[3] || 'Admin123!';

console.log('🔐 Login Test Script');
console.log('===================');

testLogin(email, password);
