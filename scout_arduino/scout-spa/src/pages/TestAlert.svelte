<script>
  import { onMount, onDestroy } from 'svelte';
  import Card from '../components/Card.svelte';
  import { testAlert, triggerServo, resetAlarm, getStatus } from '../lib/api.js';

  let testAlertLoading = false;
  let testServoLoading = false;
  let message = '';
  let messageType = ''; // 'success' or 'error'
  let isAlertActive = false;
  let statusCheckInterval = null;

  async function checkAlertStatus() {
    try {
      const status = await getStatus();
      isAlertActive = status.detectionState || false;
    } catch (err) {
      console.error('Failed to check alert status:', err);
    }
  }

  async function handleTestAlert() {
    testAlertLoading = true;
    message = '';
    messageType = '';
    try {
      if (isAlertActive) {
        // Reset the alert
        await resetAlarm();
        message = '✅ Alert reset successfully';
        messageType = 'success';
        isAlertActive = false;
      } else {
        // Trigger test alert
        const result = await testAlert();
        message = result || '✅ Test alert started – check /gallery or /captures';
        messageType = 'success';
        isAlertActive = true;
      }
    } catch (err) {
      message = `Error: ${err.message || (isAlertActive ? 'Failed to reset alert' : 'Failed to trigger test alert')}`;
      messageType = 'error';
    } finally {
      testAlertLoading = false;
      // Recheck status after action
      checkAlertStatus();
    }
  }

  async function handleTestServo() {
    testServoLoading = true;
    message = '';
    messageType = '';
    try {
      await triggerServo();
      message = 'Servo triggered';
      messageType = 'success';
    } catch (err) {
      message = `Error: ${err.message || 'Failed to trigger servo'}`;
      messageType = 'error';
    } finally {
      testServoLoading = false;
    }
  }

  onMount(() => {
    // Check initial status
    checkAlertStatus();

    // Poll status every 2 seconds to keep button state in sync
    statusCheckInterval = setInterval(checkAlertStatus, 2000);
  });

  onDestroy(() => {
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
    }
  });
</script>

<div class="page">
  <h1>Test Alert</h1>

  <Card title="">
    <div class="content">
      <p class="description">Press a button to simulate an event or just fire the servo.</p>

      <div class="button-group">
        <button
          class="btn test-alert-btn"
          class:alert-active={isAlertActive}
          on:click={handleTestAlert}
          disabled={testAlertLoading}>
          {testAlertLoading ? '⏳' : (isAlertActive ? '🔄' : '🔔')} {isAlertActive ? 'Reset Alert' : 'Test Alert'}
        </button>

        <button
          class="btn test-servo-btn"
          on:click={handleTestServo}
          disabled={testServoLoading}>
          {testServoLoading ? '⏳' : '⚙️'} Test Servo
        </button>
      </div>

      {#if message}
        <div class="message" class:success={messageType === 'success'} class:error={messageType === 'error'}>
          {message}
        </div>
      {/if}
    </div>
  </Card>
</div>

<style>
  .page {
    padding: 20px;
    max-width: 800px;
    margin: 0 auto;
  }

  h1 {
    margin: 0 0 20px 0;
    color: #fff;
  }

  .content {
    padding: 20px;
  }

  .description {
    margin: 0 0 20px 0;
    color: #ccc;
    font-size: 16px;
  }

  .button-group {
    display: flex;
    gap: 15px;
    margin-bottom: 20px;
  }

  .btn {
    padding: 12px 24px;
    font-size: 18px;
    background: #444;
    color: #ddd;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn:hover:not(:disabled) {
    background: #555;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .test-alert-btn:hover:not(:disabled) {
    background: #f39c12;
  }

  .test-alert-btn.alert-active {
    background: #e74c3c;
    border: 2px solid #c0392b;
  }

  .test-alert-btn.alert-active:hover:not(:disabled) {
    background: #c0392b;
  }

  .test-servo-btn:hover:not(:disabled) {
    background: #3498db;
  }

  .message {
    padding: 12px;
    border-radius: 4px;
    margin-top: 15px;
  }

  .message.success {
    background: rgba(46, 204, 113, 0.2);
    color: #2ecc71;
    border: 1px solid #2ecc71;
  }

  .message.error {
    background: rgba(231, 76, 60, 0.2);
    color: #e74c3c;
    border: 1px solid #e74c3c;
  }
</style>
