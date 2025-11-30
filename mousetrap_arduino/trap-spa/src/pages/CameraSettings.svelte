<script>
  import { onMount, onDestroy } from 'svelte';
  import { getCameraSettings, setCameraSettings, toggleLED, getLEDStatus } from '../lib/api.js';

  let loading = true;
  let saving = false;
  let error = null;
  let success = null;
  let hasChanges = false;

  // Preview
  let previewUrl = `/auto.jpg?t=${Date.now()}`;
  let previewError = false;
  let ledOn = false;

  // Current settings (what's applied to sensor)
  let videoMode = false;
  let framesize = 8;
  let quality = 12;
  let brightness = 0;
  let contrast = 0;
  let saturation = 0;
  let vflip = false;
  let hmirror = false;

  // Original settings (from NVS, for revert)
  let originalSettings = null;

  // Debounce timer for sliders
  let debounceTimer = null;

  // Framesize options
  const framesizeOptions = [
    { value: 5, label: 'QVGA 320x240' },
    { value: 6, label: 'CIF 400x296' },
    { value: 8, label: 'VGA 640x480' },
    { value: 9, label: 'SVGA 800x600' },
    { value: 10, label: 'XGA 1024x768' },
  ];

  onMount(async () => {
    await loadSettings();
    await fetchLEDStatus();
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    // Revert to original settings if not saved
    if (hasChanges && originalSettings) {
      revertSettings();
    }
  });

  async function loadSettings() {
    loading = true;
    error = null;

    try {
      const settings = await getCameraSettings();
      videoMode = settings.videoMode || false;
      framesize = settings.framesize ?? 8;
      quality = settings.quality ?? 12;
      brightness = settings.brightness ?? 0;
      contrast = settings.contrast ?? 0;
      saturation = settings.saturation ?? 0;
      vflip = settings.vflip ? true : false;
      hmirror = settings.hmirror ? true : false;

      // Store original for revert
      originalSettings = { ...settings };
      hasChanges = false;
    } catch (err) {
      console.error('Failed to load camera settings:', err);
      error = err.message || 'Failed to load settings';
    }

    loading = false;
    refreshPreview();
  }

  async function fetchLEDStatus() {
    try {
      const status = await getLEDStatus();
      ledOn = status.on || status.ledOn || false;
    } catch (err) {
      console.error('Failed to get LED status:', err);
    }
  }

  function refreshPreview() {
    previewUrl = `/auto.jpg?t=${Date.now()}`;
    previewError = false;
  }

  function handlePreviewError() {
    previewError = true;
  }

  async function handleToggleLED() {
    try {
      await toggleLED();
      ledOn = !ledOn;
      setTimeout(refreshPreview, 200);
    } catch (err) {
      console.error('Failed to toggle LED:', err);
    }
  }

  // Apply settings to sensor for preview (no persist)
  async function applyForPreview() {
    try {
      await setCameraSettings({
        videoMode,
        framesize,
        quality,
        brightness,
        contrast,
        saturation,
        vflip,
        hmirror,
        persist: false
      });
      hasChanges = true;
      refreshPreview();
    } catch (err) {
      console.error('Failed to apply settings:', err);
    }
  }

  // Debounced apply for sliders
  function debouncedApply() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyForPreview, 1000);
  }

  // Immediate apply for toggles/dropdowns
  function immediateApply() {
    if (debounceTimer) clearTimeout(debounceTimer);
    applyForPreview();
  }

  // Save settings to NVS
  async function saveSettings() {
    saving = true;
    error = null;
    success = null;

    try {
      await setCameraSettings({
        videoMode,
        framesize,
        quality,
        brightness,
        contrast,
        saturation,
        vflip,
        hmirror,
        persist: true
      });
      originalSettings = { videoMode, framesize, quality, brightness, contrast, saturation, vflip, hmirror };
      hasChanges = false;
      success = 'Settings saved';
      setTimeout(() => success = null, 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      error = err.message || 'Failed to save';
    }

    saving = false;
  }

  // Revert to original settings
  async function revertSettings() {
    if (!originalSettings) return;

    try {
      await setCameraSettings({
        ...originalSettings,
        persist: false
      });
    } catch (err) {
      console.error('Failed to revert settings:', err);
    }
  }

  // Reset to original (for Reset button)
  async function handleReset() {
    if (!originalSettings) return;

    videoMode = originalSettings.videoMode || false;
    framesize = originalSettings.framesize ?? 8;
    quality = originalSettings.quality ?? 12;
    brightness = originalSettings.brightness ?? 0;
    contrast = originalSettings.contrast ?? 0;
    saturation = originalSettings.saturation ?? 0;
    vflip = originalSettings.vflip ? true : false;
    hmirror = originalSettings.hmirror ? true : false;

    await applyForPreview();
    hasChanges = false;
  }

  function getQualityLabel(q) {
    if (q <= 10) return 'Best';
    if (q <= 20) return 'High';
    if (q <= 35) return 'Medium';
    return 'Low';
  }
</script>

<div class="page">
  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="layout">
      <!-- Left: Preview -->
      <div class="preview-section">
        <div class="preview-container">
          {#if previewError}
            <div class="preview-error">
              <p>Preview unavailable</p>
              <button on:click={refreshPreview}>Retry</button>
            </div>
          {:else}
            <img src={previewUrl} alt="Preview" on:error={handlePreviewError} />
          {/if}
        </div>
        <div class="preview-controls">
          <button on:click={refreshPreview}>Refresh</button>
          <button class:active={ledOn} on:click={handleToggleLED}>
            LED {ledOn ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <!-- Right: Controls -->
      <div class="controls-section">
        {#if error}
          <div class="error-msg">{error}</div>
        {/if}
        {#if success}
          <div class="success-msg">{success}</div>
        {/if}

        <div class="control-group">
          <label class="checkbox">
            <input type="checkbox" bind:checked={videoMode} on:change={immediateApply} />
            <span>Record video (10s) instead of photos</span>
          </label>
        </div>

        <div class="control-group">
          <label>Resolution</label>
          <select bind:value={framesize} on:change={immediateApply}>
            {#each framesizeOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <div class="control-group">
          <label>Quality: {quality} ({getQualityLabel(quality)})</label>
          <input type="range" min="4" max="50" bind:value={quality} on:input={debouncedApply} />
          <div class="range-hint"><span>Best</span><span>Low</span></div>
        </div>

        <div class="control-group">
          <label>Brightness: {brightness}</label>
          <input type="range" min="-2" max="2" bind:value={brightness} on:input={debouncedApply} />
          <div class="range-hint"><span>-2</span><span>+2</span></div>
        </div>

        <div class="control-group">
          <label>Contrast: {contrast}</label>
          <input type="range" min="-2" max="2" bind:value={contrast} on:input={debouncedApply} />
          <div class="range-hint"><span>-2</span><span>+2</span></div>
        </div>

        <div class="control-group">
          <label>Saturation: {saturation}</label>
          <input type="range" min="-2" max="2" bind:value={saturation} on:input={debouncedApply} />
          <div class="range-hint"><span>-2</span><span>+2</span></div>
        </div>

        <div class="control-group row">
          <label class="checkbox">
            <input type="checkbox" bind:checked={vflip} on:change={immediateApply} />
            <span>Flip V</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" bind:checked={hmirror} on:change={immediateApply} />
            <span>Mirror H</span>
          </label>
        </div>

        <div class="actions">
          <button class="btn-save" on:click={saveSettings} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button class="btn-reset" on:click={handleReset} disabled={saving}>
            Reset
          </button>
        </div>

        {#if hasChanges}
          <p class="unsaved-hint">Unsaved changes will be lost on exit</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    height: 100vh;
    overflow: hidden;
    background: #111;
    padding: 0.5rem;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #888;
  }

  .layout {
    display: flex;
    height: 100%;
    gap: 1rem;
  }

  .preview-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .preview-container {
    flex: 1;
    background: #000;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .preview-container img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .preview-error {
    text-align: center;
    color: #888;
  }

  .preview-error button {
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    background: #333;
    border: 1px solid #555;
    color: #ddd;
    border-radius: 4px;
    cursor: pointer;
  }

  .preview-controls {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .preview-controls button {
    flex: 1;
    padding: 0.5rem;
    background: #222;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .preview-controls button:hover {
    background: #333;
  }

  .preview-controls button.active {
    background: #f59e0b;
    border-color: #f59e0b;
    color: #000;
  }

  .controls-section {
    width: 280px;
    flex-shrink: 0;
    overflow-y: auto;
    padding-right: 0.5rem;
  }

  .control-group {
    margin-bottom: 0.75rem;
  }

  .control-group.row {
    display: flex;
    gap: 1rem;
  }

  .control-group label:not(.checkbox) {
    display: block;
    color: #aaa;
    font-size: 0.8rem;
    margin-bottom: 0.25rem;
  }

  .control-group select {
    width: 100%;
    padding: 0.5rem;
    background: #222;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .control-group input[type="range"] {
    width: 100%;
    height: 6px;
    background: #333;
    border-radius: 3px;
    -webkit-appearance: none;
  }

  .control-group input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    background: #4a9eff;
    border-radius: 50%;
    cursor: pointer;
  }

  .range-hint {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: #666;
    margin-top: 2px;
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    color: #ddd;
    font-size: 0.85rem;
  }

  .checkbox input {
    width: 16px;
    height: 16px;
    accent-color: #4a9eff;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .btn-save, .btn-reset {
    flex: 1;
    padding: 0.6rem;
    border: none;
    border-radius: 4px;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .btn-save {
    background: #4a9eff;
    color: #fff;
  }

  .btn-save:hover:not(:disabled) {
    background: #3a8eef;
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-reset {
    background: #333;
    color: #ddd;
    border: 1px solid #555;
  }

  .btn-reset:hover:not(:disabled) {
    background: #444;
  }

  .error-msg {
    background: #3a1515;
    border-left: 3px solid #ff6b6b;
    color: #ff6b6b;
    padding: 0.5rem;
    margin-bottom: 0.75rem;
    font-size: 0.85rem;
    border-radius: 4px;
  }

  .success-msg {
    background: #153a15;
    border-left: 3px solid #4ade80;
    color: #4ade80;
    padding: 0.5rem;
    margin-bottom: 0.75rem;
    font-size: 0.85rem;
    border-radius: 4px;
  }

  .unsaved-hint {
    color: #f59e0b;
    font-size: 0.75rem;
    text-align: center;
    margin-top: 0.5rem;
  }

  @media (max-width: 600px) {
    .layout {
      flex-direction: column;
    }

    .preview-section {
      flex: none;
      height: 45%;
    }

    .controls-section {
      width: 100%;
      flex: 1;
    }
  }
</style>
