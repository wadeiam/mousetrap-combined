<script>
  import { onMount } from 'svelte';
  import Card from '../components/Card.svelte';
  import * as api from '../lib/api.js';

  // Display values (read-only)
  let falseAlarmOffset = 0;
  let currentThreshold = 0;

  // Input values
  let calibrationOffset = 0;
  let overrideThreshold = '';

  // Status
  let saving = false;
  let message = '';
  let messageType = ''; // 'success' | 'error'

  onMount(() => {
    loadStatus();
    // Load persisted calibrationOffset from localStorage
    const savedOffset = localStorage.getItem('calibrationOffset');
    if (savedOffset !== null) {
      calibrationOffset = parseInt(savedOffset);
    }
  });

  async function loadStatus() {
    try {
      const data = await api.getStatus();
      currentThreshold = data.threshold || 0;
      falseAlarmOffset = data.falseAlarmOffset || 0;

      // Update calibrationOffset from backend if available
      if (data.calibrationOffset !== undefined) {
        calibrationOffset = data.calibrationOffset;
        localStorage.setItem('calibrationOffset', calibrationOffset.toString());
      }

      // Update overrideThreshold from backend if set
      if (data.overrideThreshold !== undefined && data.overrideThreshold > 0) {
        overrideThreshold = data.overrideThreshold.toString();
      } else {
        // Explicitly keep field empty when no override is set
        overrideThreshold = '';
      }
    } catch (err) {
      console.warn('Failed to load status:', err);
    }
  }

  async function handleSave() {
    saving = true;
    message = '';
    try {
      // Save calibration offset
      await api.setCalibrationOffset(calibrationOffset);
      localStorage.setItem('calibrationOffset', calibrationOffset.toString());

      // Save override threshold if provided
      if (overrideThreshold && parseInt(overrideThreshold) > 0) {
        await api.setOverrideThreshold(parseInt(overrideThreshold));
        message = 'Calibration offset and override threshold saved';
      } else {
        message = 'Calibration offset saved';
      }

      messageType = 'success';
      setTimeout(() => { message = ''; loadStatus(); }, 2000);
    } catch (err) {
      message = `Failed to save: ${err.message || err}`;
      messageType = 'error';
      setTimeout(() => { message = ''; }, 3000);
    } finally {
      saving = false;
    }
  }

  async function handleSetOverride() {
    if (!overrideThreshold || overrideThreshold <= 0) {
      message = 'Please enter a valid threshold value';
      messageType = 'error';
      setTimeout(() => { message = ''; }, 2000);
      return;
    }

    saving = true;
    message = '';
    try {
      await api.setOverrideThreshold(parseInt(overrideThreshold));
      message = `Threshold override set to ${overrideThreshold} mm`;
      messageType = 'success';
      setTimeout(() => { message = ''; loadStatus(); }, 2000);
    } catch (err) {
      message = `Failed to set override: ${err.message || err}`;
      messageType = 'error';
      setTimeout(() => { message = ''; }, 3000);
    } finally {
      saving = false;
    }
  }

  async function handleClearOverride() {
    saving = true;
    message = '';
    try {
      await api.clearOverride();
      overrideThreshold = '';
      message = 'Override cleared';
      messageType = 'success';
      setTimeout(() => { message = ''; loadStatus(); }, 2000);
    } catch (err) {
      message = `Failed to clear override: ${err.message || err}`;
      messageType = 'error';
      setTimeout(() => { message = ''; }, 3000);
    } finally {
      saving = false;
    }
  }

  async function handleRecalibrate() {
    saving = true;
    message = '';
    try {
      await api.recalibrate();
      message = 'Re-calibration started';
      messageType = 'success';
      setTimeout(() => { message = ''; loadStatus(); }, 2000);
    } catch (err) {
      message = `Failed to recalibrate: ${err.message || err}`;
      messageType = 'error';
      setTimeout(() => { message = ''; }, 3000);
    } finally {
      saving = false;
    }
  }
</script>

<div class="page">
  <h1>Calibration Settings</h1>

  {#if message}
    <div class="message" class:success={messageType === 'success'} class:error={messageType === 'error'}>
      {message}
    </div>
  {/if}

  <Card title="">
    <div class="content">
      <!-- Read-only Display Values -->
      <div class="info-row">
        <label>False-Alarm Offset:</label>
        <span class="value">{falseAlarmOffset} mm</span>
      </div>

      <div class="info-row">
        <label>Current Threshold:</label>
        <span class="value">{currentThreshold} mm</span>
      </div>

      <!-- Calibration Offset Slider -->
      <div class="control-group">
        <label for="calib-offset">Calibration Offset:</label>
        <div class="slider-row">
          <input
            id="calib-offset"
            type="range"
            min="-100"
            max="100"
            step="1"
            bind:value={calibrationOffset}
            class="slider"
            disabled={saving}
          />
          <span class="slider-value">{calibrationOffset} mm</span>
        </div>
      </div>

      <!-- Override Threshold Input -->
      <div class="control-group">
        <label for="override-th">Override Threshold (mm):</label>
        <input
          id="override-th"
          type="number"
          bind:value={overrideThreshold}
          placeholder=""
          min="0"
          class="input-field"
          disabled={saving}
        />
      </div>

      <!-- Action Buttons -->
      <div class="button-group">
        <button
          class="btn btn-save"
          on:click={handleSave}
          disabled={saving}>
          💾 Save
        </button>
        <button
          class="btn btn-clear"
          on:click={handleClearOverride}
          disabled={saving}>
          🗑️ Clear Override
        </button>
        <button
          class="btn btn-recal"
          on:click={handleRecalibrate}
          disabled={saving}>
          🔄 Recalibrate
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

  .content {
    padding: 20px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid #333;
    color: #ddd;
  }

  .info-row label {
    font-size: 16px;
  }

  .info-row .value {
    font-size: 16px;
    font-weight: bold;
    font-family: 'Courier New', monospace;
  }

  .control-group {
    margin-top: 25px;
  }

  .control-group > label {
    display: block;
    color: #ddd;
    font-size: 16px;
    margin-bottom: 10px;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 15px;
  }

  .slider {
    flex: 1;
    height: 6px;
    background: #333;
    border-radius: 3px;
    outline: none;
    -webkit-appearance: none;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    background: #2196F3;
    border-radius: 50%;
    cursor: pointer;
  }

  .slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #2196F3;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .slider:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .slider-value {
    color: #ddd;
    font-size: 16px;
    font-weight: bold;
    min-width: 60px;
    text-align: right;
  }

  .input-field {
    width: 100%;
    padding: 10px 12px;
    background: #1a1a1a;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 16px;
  }

  .input-field:focus {
    outline: none;
    border-color: #666;
  }

  .input-field:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .button-group {
    display: flex;
    gap: 10px;
    margin-top: 30px;
  }

  .btn {
    flex: 1;
    padding: 12px 20px;
    background: #444;
    color: #ddd;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 15px;
    transition: background 0.2s;
  }

  .btn:hover:not(:disabled) {
    background: #555;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-save {
    background: #9C27B0;
  }

  .btn-save:hover:not(:disabled) {
    background: #7B1FA2;
  }

  .btn-clear {
    background: #FF5722;
  }

  .btn-clear:hover:not(:disabled) {
    background: #E64A19;
  }

  .btn-recal {
    background: #2196F3;
  }

  .btn-recal:hover:not(:disabled) {
    background: #1976D2;
  }

  @media (max-width: 600px) {
    .button-group {
      flex-direction: column;
    }
  }
</style>
