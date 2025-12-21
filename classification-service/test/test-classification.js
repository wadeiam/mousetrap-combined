#!/usr/bin/env node

/**
 * Test script for the classification service
 *
 * Usage:
 *   node test/test-classification.js [base_url]
 *
 * Examples:
 *   node test/test-classification.js                    # Uses localhost:3100
 *   node test/test-classification.js http://localhost:3100
 *   node test/test-classification.js http://192.168.133.110:3100
 */

const BASE_URL = process.argv[2] || 'http://localhost:3100';

// Test images - public domain images
const TEST_IMAGES = {
  mouse: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Mouse_white_background.jpg/1200px-Mouse_white_background.jpg',
  cat: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg',
  dog: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/YellowLabradorLooking_new.jpg/1200px-YellowLabradorLooking_new.jpg',
};

async function test(name, fn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await fn();
    console.log('✓ PASSED');
    return true;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log(`\nClassification Service Test Suite`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log('─'.repeat(50));

  let passed = 0;
  let failed = 0;

  // Test 1: Health check
  if (await test('Health endpoint', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('Status not ok');
  })) passed++; else failed++;

  // Test 2: Status endpoint
  if (await test('Status endpoint', async () => {
    const res = await fetch(`${BASE_URL}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (typeof data.modelLoaded !== 'boolean') throw new Error('Missing modelLoaded');
    console.log(`\n   Model loaded: ${data.modelLoaded}`);
    if (data.modelLoadTime) console.log(`   Load time: ${data.modelLoadTime}ms`);
    if (data.classificationCount) console.log(`   Classifications: ${data.classificationCount}`);
  })) passed++; else failed++;

  // Test 3: Load model (if not already loaded)
  if (await test('Load model endpoint', async () => {
    const res = await fetch(`${BASE_URL}/load-model`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Model load failed');
    console.log(`\n   Model load time: ${data.modelLoadTime}ms`);
  })) passed++; else failed++;

  // Test 4: Classify mouse image
  if (await test('Classify mouse image (should be rodent)', async () => {
    const res = await fetch(`${BASE_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: TEST_IMAGES.mouse })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Classification failed');
    console.log(`\n   Classification: ${data.classification}`);
    console.log(`   Top match: ${data.topMatch}`);
    console.log(`   Confidence: ${(data.confidence * 100).toFixed(1)}%`);
    console.log(`   Top 3 predictions:`);
    data.predictions.slice(0, 3).forEach((p, i) => {
      console.log(`     ${i + 1}. ${p.className}: ${(p.probability * 100).toFixed(1)}%`);
    });
  })) passed++; else failed++;

  // Test 5: Classify cat image
  if (await test('Classify cat image (should be pet)', async () => {
    const res = await fetch(`${BASE_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: TEST_IMAGES.cat })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Classification failed');
    console.log(`\n   Classification: ${data.classification}`);
    console.log(`   Top match: ${data.topMatch}`);
    console.log(`   Confidence: ${(data.confidence * 100).toFixed(1)}%`);
    if (data.classification !== 'pet') {
      console.log('   ⚠ Expected "pet" but got different classification');
    }
  })) passed++; else failed++;

  // Test 6: Classify dog image
  if (await test('Classify dog image (should be pet)', async () => {
    const res = await fetch(`${BASE_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: TEST_IMAGES.dog })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Classification failed');
    console.log(`\n   Classification: ${data.classification}`);
    console.log(`   Top match: ${data.topMatch}`);
    console.log(`   Confidence: ${(data.confidence * 100).toFixed(1)}%`);
    if (data.classification !== 'pet') {
      console.log('   ⚠ Expected "pet" but got different classification');
    }
  })) passed++; else failed++;

  // Test 7: Final status check
  if (await test('Final status check', async () => {
    const res = await fetch(`${BASE_URL}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(`\n   Total classifications: ${data.classificationCount}`);
    console.log(`   Memory used: ${Math.round(data.memoryUsage.heapUsed / 1024 / 1024)}MB`);
    console.log(`   TF tensors: ${data.tfMemory.numTensors}`);
  })) passed++; else failed++;

  // Summary
  console.log('\n' + '─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
