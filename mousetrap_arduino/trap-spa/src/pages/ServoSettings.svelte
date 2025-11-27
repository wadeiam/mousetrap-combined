<script>
  import { onMount } from 'svelte';
  import Card from '../components/Card.svelte';
  import * as api from '../lib/api.js';

  // Servo positions (microseconds)
  let startPos = 1500;
  let endPos = 1100;
  let disableServo = false;

  // Live control slider
  let livePosition = 1500;

  // Status
  let saving = false;
  let testing = false;
  let message = '';
  let messageType = ''; // 'success' | 'error'

  async function loadSettings() {
    try {
      const settings = await api.getServoSettings();
      if (settings.startUS !== undefined) startPos = settings.startUS;
      if (settings.endUS !== undefined) endPos = settings.endUS;

      // Load disableServo from localStorage (persisted from last save)
      const savedDisableServo = localStorage.getItem('disableServo');
      if (savedDisableServo !== null) {
        disableServo = savedDisableServo === 'true';
      } else if (settings.disabled !== undefined) {
        disableServo = settings.disabled;
      }

      livePosition = startPos; // Initialize slider to start position
    } catch (err) {
      console.warn('Failed to load servo settings:', err);
    }
  }

  async function setPosition(position, label) {
    if (disableServo) {
      message = 'Servo is disabled';
      messageType = 'error';
      setTimeout(() => { message = ''; }, 2000);
      return;
    }

    try {
      await fetch(`/servoSet?val=${position}`);
      message = `${label} set to ${position}µs`;
      messageType = 'success';
      setTimeout(() => { message = ''; }, 2000);
    } catch (err) {
      message = `Failed to set ${label}`;
      messageType = 'error';
      setTimeout(() => { message = ''; }, 3000);
    }
  }

  async function handleSave() {
    saving = true;
    message = '';
    try {
      await api.setServoSettings({
        startUS: startPos,
        endUS: endPos,
        disabled: disableServo
      });

      // Persist disableServo state to localStorage
      localStorage.setItem('disableServo', disableServo.toString());

      message = 'Settings saved successfully';
      messageType = 'success';
      setTimeout(() => { message = ''; }, 3000);
    } catch (err) {
      message = `Failed to save: ${err.message}`;
      messageType = 'error';
      setTimeout(() => { message = ''; }, 3000);
    } finally {
      saving = false;
    }
  }

  async function handleTestServo() {
    if (disableServo) {
      message = 'Servo is disabled';
      messageType = 'error';
      setTimeout(() => { message = ''; }, 2000);
      return;
    }

    testing = true;
    message = '';
    try {
      await api.triggerServo();
      message = 'Servo triggered';
      messageType = 'success';
      setTimeout(() => { message = ''; }, 2000);
    } catch (err) {
      message = `Failed to trigger servo: ${err.message}`;
      messageType = 'error';
      setTimeout(() => { message = ''; }, 3000);
    } finally {
      testing = false;
    }
  }

  function updateLivePosition() {
    if (disableServo) {
      message = 'Servo is disabled';
      messageType = 'error';
      setTimeout(() => { message = ''; }, 2000);
      return;
    }

    try {
      fetch(`/servoSet?val=${livePosition}`);
    } catch (err) {
      console.error('Failed to update live position:', err);
    }
  }

  onMount(() => {
    loadSettings();
  });
</script>

<div class="page">
  <h1>Servo Settings</h1>

  {#if message}
    <div class="message" class:success={messageType === 'success'} class:error={messageType === 'error'}>
      {message}
    </div>
  {/if}

  <Card title="">
    <div class="settings-content">
      <!-- Start Position -->
      <div class="position-row">
        <label for="start-pos">Start Position (µs):</label>
        <input
          id="start-pos"
          type="number"
          bind:value={startPos}
          min="500"
          max="2500"
          step="10"
        />
        <button
          class="btn btn-set"
          on:click={() => setPosition(startPos, 'Start position')}
          disabled={disableServo}>
          Set
        </button>
      </div>

      <!-- End Position -->
      <div class="position-row">
        <label for="end-pos">End Position (µs):</label>
        <input
          id="end-pos"
          type="number"
          bind:value={endPos}
          min="500"
          max="2500"
          step="10"
        />
        <button
          class="btn btn-set"
          on:click={() => setPosition(endPos, 'End position')}
          disabled={disableServo}>
          Set
        </button>
      </div>

      <!-- Disable Servo Checkbox -->
      <div class="checkbox-row">
        <input
          id="disable-servo"
          type="checkbox"
          bind:checked={disableServo}
        />
        <label for="disable-servo">Disable Servo</label>
      </div>

      <!-- Live Control -->
      <div class="live-control">
        <h3>Live Control</h3>
        <div class="slider-container">
          <input
            type="range"
            min="500"
            max="2500"
            step="10"
            bind:value={livePosition}
            on:input={updateLivePosition}
            disabled={disableServo}
            class="position-slider"
          />
          <div class="slider-value">{livePosition} µs</div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="button-group">
        <button
          class="btn btn-save"
          on:click={handleSave}
          disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          class="btn btn-test"
          on:click={handleTestServo}
          disabled={testing || disableServo}>
          {testing ? 'Testing...' : 'Test Servo'}
        </button>
      </div>
    </div>
  </Card>
</div>

<style>
  .page {
    padding: 20px;
    max-width: 600px;
    margin: 0 auto;
  }

  h1 {
    margin: 0 0 20px 0;
    color: #fff;
  }

  .message {
    padding: 12px;
    border-radius: 4px;
    margin-bottom: 16px;
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

  .settings-content {
    padding: 20px;
  }

  .position-row {
    display: grid;
    grid-template-columns: 180px 1fr auto;
    gap: 10px;
    align-items: center;
    margin-bottom: 15px;
  }

  .position-row label {
    color: #ddd;
    font-size: 16px;
  }

  .position-row input[type="number"] {
    padding: 8px 12px;
    background: #1a1a1a;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 16px;
  }

  .position-row input[type="number"]:focus {
    outline: none;
    border-color: #666;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 20px 0;
  }

  .checkbox-row input[type="checkbox"] {
    width: 20px;
    height: 20px;
    cursor: pointer;
  }

  .checkbox-row label {
    color: #ddd;
    font-size: 16px;
    cursor: pointer;
  }

  .live-control {
    margin: 30px 0;
  }

  .live-control h3 {
    margin: 0 0 15px 0;
    color: #fff;
    font-size: 20px;
  }

  .slider-container {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .position-slider {
    width: 100%;
    height: 8px;
    background: #333;
    border-radius: 4px;
    outline: none;
    -webkit-appearance: none;
  }

  .position-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 24px;
    height: 24px;
    background: #2196F3;
    border-radius: 50%;
    cursor: pointer;
  }

  .position-slider::-moz-range-thumb {
    width: 24px;
    height: 24px;
    background: #2196F3;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .position-slider:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .position-slider:disabled::-webkit-slider-thumb {
    background: #666;
    cursor: not-allowed;
  }

  .position-slider:disabled::-moz-range-thumb {
    background: #666;
    cursor: not-allowed;
  }

  .slider-value {
    text-align: center;
    color: #ddd;
    font-size: 18px;
    font-weight: bold;
  }

  .button-group {
    display: flex;
    gap: 15px;
    margin-top: 25px;
  }

  .btn {
    padding: 10px 24px;
    background: #444;
    color: #ddd;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    transition: background 0.2s;
  }

  .btn:hover:not(:disabled) {
    background: #555;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-set {
    padding: 8px 20px;
    font-size: 14px;
  }

  .btn-save {
    flex: 1;
  }

  .btn-test {
    flex: 1;
  }

  @media (max-width: 600px) {
    .position-row {
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .position-row label {
      grid-column: 1;
    }

    .position-row input {
      grid-column: 1;
    }

    .position-row button {
      grid-column: 1;
    }

    .button-group {
      flex-direction: column;
    }
  }
</style>
