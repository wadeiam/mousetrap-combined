<script>
  import { menuOpen } from '../lib/stores.js';
  import { link, currentRoute } from '../lib/router.js';

  let cameraExpanded = false;
  let networkExpanded = false;
  let deviceExpanded = false;
  let systemExpanded = false;

  // Auto-expand based on current route
  $: {
    const path = $currentRoute;
    cameraExpanded = path.startsWith('/gallery') || path.startsWith('/camera-settings');
    networkExpanded = path.startsWith('/wifi') || path.startsWith('/claim');
    deviceExpanded = path.startsWith('/servo') || path.startsWith('/calibration');
    systemExpanded = path.startsWith('/logs') || path.startsWith('/firmware') || path.startsWith('/reboot') || path.startsWith('/test') || path.startsWith('/system-status');
  }

  function closeMenu() {
    menuOpen.set(false);
  }

  function toggleSubmenu(name) {
    if (name === 'camera') cameraExpanded = !cameraExpanded;
    if (name === 'network') networkExpanded = !networkExpanded;
    if (name === 'device') deviceExpanded = !deviceExpanded;
    if (name === 'system') systemExpanded = !systemExpanded;
  }
</script>

<div class="menu" class:open={$menuOpen}>
  <!-- Home/Dashboard -->
  <a href="#/" use:link on:click={closeMenu} class:active={$currentRoute === '/'}>
    Home
  </a>

  <!-- Camera -->
  <a href="#" on:click|preventDefault={() => toggleSubmenu('camera')} class="parent">
    Camera
    <span class="arrow" class:expanded={cameraExpanded}>▸</span>
  </a>
  {#if cameraExpanded}
    <div class="submenu">
      <a href="#/gallery" use:link on:click={closeMenu} class:active={$currentRoute === '/gallery'}>
        Gallery
      </a>
      <a href="#/camera-settings" use:link on:click={closeMenu} class:active={$currentRoute === '/camera-settings'}>
        Settings
      </a>
    </div>
  {/if}

  <!-- Network -->
  <a href="#" on:click|preventDefault={() => toggleSubmenu('network')} class="parent">
    Network
    <span class="arrow" class:expanded={networkExpanded}>▸</span>
  </a>
  {#if networkExpanded}
    <div class="submenu">
      <a href="#/wifi" use:link on:click={closeMenu} class:active={$currentRoute === '/wifi'}>
        WiFi
      </a>
      <a href="#/claim" use:link on:click={closeMenu} class:active={$currentRoute === '/claim'}>
        Registration
      </a>
    </div>
  {/if}

  <!-- Device -->
  <a href="#" on:click|preventDefault={() => toggleSubmenu('device')} class="parent">
    Device
    <span class="arrow" class:expanded={deviceExpanded}>▸</span>
  </a>
  {#if deviceExpanded}
    <div class="submenu">
      <a href="#/servo" use:link on:click={closeMenu} class:active={$currentRoute === '/servo'}>
        Servo
      </a>
      <a href="#/calibration" use:link on:click={closeMenu} class:active={$currentRoute === '/calibration'}>
        Sensor Calibration
      </a>
    </div>
  {/if}

  <!-- System -->
  <a href="#" on:click|preventDefault={() => toggleSubmenu('system')} class="parent">
    System
    <span class="arrow" class:expanded={systemExpanded}>▸</span>
  </a>
  {#if systemExpanded}
    <div class="submenu">
      <a href="#/system-status" use:link on:click={closeMenu} class:active={$currentRoute === '/system-status'}>
        Status
      </a>
      <a href="#/logs" use:link on:click={closeMenu} class:active={$currentRoute === '/logs'}>
        Logs
      </a>
      <a href="#/firmware" use:link on:click={closeMenu} class:active={$currentRoute === '/firmware'}>
        Firmware &amp; OTA
      </a>
      <a href="#/test" use:link on:click={closeMenu} class:active={$currentRoute === '/test'}>
        Test Alert
      </a>
    </div>
  {/if}
</div>

<!-- Backdrop (click to close) -->
{#if $menuOpen}
  <div class="backdrop" on:click={closeMenu}></div>
{/if}

<style>
  .menu {
    position: fixed;
    top: 0;
    left: 0;
    width: 250px;
    height: 100vh;
    background: #1a1a1a;
    border-right: 1px solid #333;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    z-index: 1000;
    overflow-y: auto;
    padding-top: 60px;
  }

  .menu.open {
    transform: translateX(0);
  }

  .menu a {
    display: block;
    padding: 12px 20px;
    color: #fff;
    text-decoration: none;
    transition: background 0.2s ease;
    position: relative;
    text-align: left;
  }

  .menu a:hover {
    background: #222;
  }

  .menu a.active {
    background: #2a2a2a;
    border-left: 3px solid #fff;
  }

  .menu a.parent {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .arrow {
    transition: transform 0.2s ease;
    display: inline-block;
  }

  .arrow.expanded {
    transform: rotate(90deg);
  }

  .submenu {
    background: #141414;
  }

  .submenu a {
    padding-left: 40px;
    font-size: 14px;
  }

  .backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999;
  }

  @media (min-width: 768px) {
    .menu {
      width: 280px;
    }
  }
</style>
