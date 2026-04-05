<script>
  import { onMount, onDestroy } from 'svelte';
  import Card from '../components/Card.svelte';
  import * as api from '../lib/api.js';
  import { capturePhoto } from '../lib/api.js';

  let cameraImage = '/auto.jpg';
  let cameraError = false;
  let isLiveMode = false;
  let isZoomed = false;
  let liveInterval = null;
  let statusInterval = null;

  let status = {
    threshold: 0,
    sensorReading: 0,
    detectionState: false,
    uptime: '',
    heap: 0,
    anomalies: []
  };

  let claimStatus = {
    claimed: false,
    message: 'Checking...',
    deviceName: ''
  };

  let chart = null;
  let chartCanvas = null;
  let sensorHistory = [];
  const MAX_HISTORY = 20;

  async function refreshCamera() {
    // Refresh button ALWAYS uses /auto.jpg (with LED flash)
    try {
      cameraImage = `/auto.jpg?t=${Date.now()}`;
      cameraError = false;
    } catch (err) {
      console.error('Camera refresh error:', err);
      cameraError = true;
    }
  }

  function updateLiveFrame() {
    // Live mode uses /camera (no LED flash)
    try {
      cameraImage = `/camera?t=${Date.now()}`;
      cameraError = false;
    } catch (err) {
      console.error('Live frame error:', err);
      cameraError = true;
    }
  }

  function toggleLive() {
    isLiveMode = !isLiveMode;
    if (isLiveMode) {
      // Start live mode with /camera endpoint
      updateLiveFrame();
      liveInterval = setInterval(() => {
        updateLiveFrame();
      }, 100);
    } else {
      // Stop live mode
      if (liveInterval) {
        clearInterval(liveInterval);
        liveInterval = null;
      }
      // Return to static /auto.jpg image
      refreshCamera();
    }
  }

  async function handleToggleLED() {
    try {
      await api.toggleLED();
    } catch (err) {
      console.error('Toggle LED error:', err);
    }
  }

  async function handleResetAlarm() {
    try {
      await api.resetAlarm();
      await fetchStatus();
    } catch (err) {
      console.error('Reset alarm error:', err);
    }
  }

  async function handleFalseAlarm() {
    try {
      const response = await api.reportFalseAlarm();
      if (response && response.newThreshold !== undefined) {
        status.threshold = response.newThreshold;
      }
      await fetchStatus();
    } catch (err) {
      console.error('False alarm error:', err);
    }
  }

  async function handleSendHeartbeat() {
    try {
      await api.sendHeartbeat();
    } catch (err) {
      console.error('Send heartbeat error:', err);
    }
  }

  async function handleCaptureScreenshot() {
    try {
      const result = await capturePhoto();
      console.log('Photo captured:', result);
      // Refresh the camera to show the new image
      await refreshCamera();
    } catch (err) {
      console.error('Capture screenshot error:', err);
    }
  }

  async function fetchStatus() {
    try {
      const data = await api.getStatus();
      status = data;

      sensorHistory.push({
        time: new Date().toLocaleTimeString(),
        value: data.sensorReading
      });

      if (sensorHistory.length > MAX_HISTORY) {
        sensorHistory = sensorHistory.slice(-MAX_HISTORY);
      }

      updateChart();
    } catch (err) {
      console.error('Status fetch error:', err);
    }
  }

  function initChart() {
    if (!chartCanvas) return;

    const ctx = chartCanvas.getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Sensor Reading',
            data: [],
            borderColor: '#4CAF50',
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            tension: 0.4
          },
          {
            label: 'Threshold',
            data: [],
            borderColor: '#f44336',
            backgroundColor: 'transparent',
            borderDash: [5, 5],
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: '#ddd' },
            grid: { color: '#333' }
          },
          x: {
            ticks: { color: '#ddd' },
            grid: { color: '#333' }
          }
        },
        plugins: {
          legend: {
            labels: { color: '#ddd' }
          }
        }
      }
    });
  }

  function updateChart() {
    if (!chart) return;

    chart.data.labels = sensorHistory.map(h => h.time);
    chart.data.datasets[0].data = sensorHistory.map(h => h.value);
    chart.data.datasets[1].data = sensorHistory.map(() => status.threshold);
    chart.update();
  }

  function handleImageError() {
    cameraError = true;
    // Retry with appropriate endpoint based on current mode
    setTimeout(() => {
      if (isLiveMode) {
        updateLiveFrame();
      } else {
        refreshCamera();
      }
    }, 1000);
  }

  async function toggleZoom() {
    if (!isZoomed) {
      // Entering fullscreen
      try {
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
          await elem.webkitRequestFullscreen();
        }
        isZoomed = true;
      } catch (err) {
        console.error('Error entering fullscreen:', err);
        // Fallback to just zooming without fullscreen
        isZoomed = true;
      }
    } else {
      // Exiting fullscreen
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            await document.webkitExitFullscreen();
          }
        }
        isZoomed = false;
      } catch (err) {
        console.error('Error exiting fullscreen:', err);
        isZoomed = false;
      }
    }
  }

  // Listen for fullscreen changes (e.g., user presses ESC)
  function handleFullscreenChange() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      isZoomed = false;
    }
  }

  async function fetchClaimStatus() {
    try {
      const data = await api.getClaimStatus();
      claimStatus = {
        claimed: data.claimed || false,
        deviceName: data.deviceName || '',
        message: data.claimed
          ? `Claimed to ${data.deviceName || 'tenant'}`
          : (data.message || 'Device not claimed')
      };
    } catch (err) {
      console.error('Claim status fetch error:', err);
      claimStatus = {
        claimed: false,
        deviceName: '',
        message: 'Error loading claim status'
      };
    }
  }

  onMount(() => {
    if (typeof Chart !== 'undefined') {
      initChart();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = () => initChart();
      document.head.appendChild(script);
    }

    fetchStatus();
    fetchClaimStatus();
    statusInterval = setInterval(fetchStatus, 5000);

    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  });

  onDestroy(() => {
    if (liveInterval) {
      clearInterval(liveInterval);
    }
    if (statusInterval) {
      clearInterval(statusInterval);
    }
    if (chart) {
      chart.destroy();
    }
    // Remove fullscreen listeners
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
  });
</script>

<svelte:head>
  <title>Dashboard - {claimStatus.deviceName || 'MouseTrap'}</title>
</svelte:head>

<div class="dashboard">
  <h1>{claimStatus.deviceName || 'MouseTrap'}</h1>

  {#if status.detectionState}
    <div class="trap-alert">TRAP TRIGGERED!</div>
  {/if}

  <!-- Live Camera Feed - Full Width Above Grid -->
  <div class="camera-card-wrapper">
    <Card title="Live Camera Feed">
      <div class="camera-container" class:zoomed={isZoomed}>
        <img
          src={cameraImage}
          alt="Camera Feed"
          class:error={cameraError}
          class:zoomed={isZoomed}
          on:error={handleImageError}
          on:click={toggleZoom}
        />
        <div class="camera-controls">
          <button class="btn" on:click={refreshCamera}>Refresh</button>
          <button class="btn" class:active={isLiveMode} on:click={toggleLive}>
            Live {isLiveMode ? 'On' : 'Off'}
          </button>
          <button class="btn" on:click={handleToggleLED}>Toggle LED</button>
          <button class="btn" on:click={handleCaptureScreenshot}>Capture</button>
        </div>
      </div>
    </Card>
  </div>

  <!-- Other Cards in Grid -->
  <div class="grid">
    <Card title="Sensor Range">
      <div class="chart-container">
        <canvas bind:this={chartCanvas}></canvas>
      </div>
      <div class="sensor-info">
        <div>Current: <strong>{status.sensorReading}</strong></div>
        <div>Threshold: <strong>{status.threshold}</strong></div>
      </div>
    </Card>

    <Card title="System Status">
      <div class="status-info">
        <div class="status-row">
          <span>Uptime:</span>
          <span>{status.uptime}</span>
        </div>
        <div class="status-row">
          <span>Free Heap:</span>
          <span>{status.heap} bytes</span>
        </div>
        <div class="status-row">
          <span>Claim Status:</span>
          <span class="claimed-status" class:unclaimed={!claimStatus.claimed}>
            {claimStatus.message}
          </span>
        </div>
      </div>

      <div class="action-buttons">
        <button class="btn" on:click={handleResetAlarm}>Reset Alarm</button>
        <button class="btn" on:click={handleFalseAlarm}>False Alarm</button>
        <button class="btn" on:click={handleSendHeartbeat}>Send Heartbeat</button>
      </div>
    </Card>

    <Card title="Anomalous Events">
      {#if status.anomalies && status.anomalies.length > 0}
        <div class="anomalies-list">
          {#each status.anomalies as anomaly}
            <div class="anomaly-item">
              <span class="timestamp">{anomaly.timestamp}</span>
              <span class="distance">{anomaly.distance} cm</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="no-data">No anomalies detected</p>
      {/if}
    </Card>
  </div>
</div>

<style>
  .dashboard {
    padding: 4px; /* Minimal padding on mobile */
    max-width: 1400px;
    margin: 0 auto;
  }

  @media (min-width: 640px) {
    .dashboard {
      padding: 20px;
    }
  }

  h1 {
    color: #ddd;
    margin-bottom: 20px;
  }

  .trap-alert {
    background: #f44336;
    color: white;
    padding: 20px;
    text-align: center;
    font-size: 24px;
    font-weight: bold;
    margin-bottom: 20px;
    border-radius: 4px;
    animation: flash 1s infinite;
  }

  @keyframes flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .camera-card-wrapper {
    margin-bottom: 30px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
  }

  .camera-container {
    display: flex;
    flex-direction: column;
    gap: 15px;
    align-items: center;
  }

  .camera-container.zoomed {
    position: fixed;
    inset: 0; /* Fills viewport accounting for browser chrome */
    z-index: 9999;
    background: #000;
    margin: 0;
    padding: 0;
    gap: 0;
  }

  .camera-container img {
    width: 100%;
    max-width: 900px;
    height: auto;
    border-radius: 4px;
    background: #000;
    display: block;
    object-fit: contain; /* Preserve aspect ratio */
    cursor: pointer;
  }

  .camera-container img.zoomed {
    position: fixed;
    inset: 0; /* Fills viewport accounting for browser chrome */
    width: 100%;
    height: 100%;
    max-width: none;
    border-radius: 0;
    object-fit: contain; /* Fit to screen in both orientations */
    z-index: 10000;
  }

  .camera-container img.error {
    opacity: 0.5;
  }

  .camera-controls {
    display: flex;
    gap: 10px;
    flex-direction: row;
    justify-content: center;
    flex-wrap: wrap;
  }

  /* Position controls at bottom when zoomed */
  .camera-container.zoomed .camera-controls {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10001;
  }

  .btn {
    padding: 8px 16px;
    background: #1a1a1a;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .btn:hover {
    background: #2a2a2a;
    border-color: #666;
  }

  .btn.active {
    background: #4CAF50;
    border-color: #4CAF50;
    color: white;
  }

  .chart-container {
    max-width: 600px;
    height: 200px;
    margin-bottom: 15px;
  }

  .sensor-info {
    display: flex;
    gap: 20px;
    color: #ddd;
  }

  .sensor-info strong {
    color: #4CAF50;
  }

  .status-info {
    margin-bottom: 20px;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #333;
    color: #ddd;
  }

  .status-row:last-child {
    border-bottom: none;
  }

  .active-state {
    color: #f44336;
    font-weight: bold;
  }

  .action-buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .anomalies-list {
    max-height: 300px;
    overflow-y: auto;
  }

  .anomaly-item {
    display: flex;
    justify-content: space-between;
    padding: 10px;
    border-bottom: 1px solid #333;
    color: #ddd;
  }

  .anomaly-item:last-child {
    border-bottom: none;
  }

  .timestamp {
    color: #999;
    font-size: 14px;
  }

  .distance {
    color: #f44336;
    font-weight: bold;
  }

  .no-data {
    color: #999;
    font-style: italic;
    text-align: center;
    padding: 20px;
  }

  @media (max-width: 768px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
