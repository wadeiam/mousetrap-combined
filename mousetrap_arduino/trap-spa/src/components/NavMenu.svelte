<script>
  import { menuOpen } from '../lib/stores.js';
  import { link, currentRoute } from '../lib/router.js';

  let settingsExpanded = false;
  let logsExpanded = false;
  let maintenanceExpanded = false;

  // Auto-expand based on current route
  $: {
    const path = $currentRoute;
    settingsExpanded = path.startsWith('/servo') || path.startsWith('/calibration') || path.startsWith('/settings') || path.startsWith('/wifi');
    logsExpanded = path.startsWith('/logs') || path.startsWith('/status') || path.startsWith('/gallery');
    maintenanceExpanded = path.startsWith('/claim') || path.startsWith('/test') || path.startsWith('/firmware') || path.startsWith('/reboot');
  }

  function closeMenu() {
    menuOpen.set(false);
  }

  function toggleSubmenu(name) {
    if (name === 'settings') settingsExpanded = !settingsExpanded;
    if (name === 'logs') logsExpanded = !logsExpanded;
    if (name === 'maintenance') maintenanceExpanded = !maintenanceExpanded;
  }
</script>

<div class="menu" class:open={$menuOpen}>
  <!-- Home/Dashboard -->
  <a href="#/" use:link on:click={closeMenu} class:active={$currentRoute === '/'}>
    Home
  </a>

  <!-- Settings -->
  <a href="#" on:click|preventDefault={() => toggleSubmenu('settings')} class="parent">
    Settings
    <span class="arrow" class:expanded={settingsExpanded}>▸</span>
  </a>
  {#if settingsExpanded}
    <div class="submenu">
      <a href="#/wifi" use:link on:click={closeMenu} class:active={$currentRoute === '/wifi'}>
        WiFi Settings
      </a>
      <a href="#/servo" use:link on:click={closeMenu} class:active={$currentRoute === '/servo'}>
        Servo Settings
      </a>
      <a href="#/calibration" use:link on:click={closeMenu} class:active={$currentRoute === '/calibration'}>
        Calibration
      </a>
      <a href="#/settings" use:link on:click={closeMenu} class:active={$currentRoute === '/settings'}>
        Options & Access
      </a>
    </div>
  {/if}

  <!-- Logs & Diagnostics -->
  <a href="#" on:click|preventDefault={() => toggleSubmenu('logs')} class="parent">
    Logs &amp; Diagnostics
    <span class="arrow" class:expanded={logsExpanded}>▸</span>
  </a>
  {#if logsExpanded}
    <div class="submenu">
      <a href="#/status" use:link on:click={closeMenu} class:active={$currentRoute === '/status'}>
        Status
      </a>
      <a href="#/logs" use:link on:click={closeMenu} class:active={$currentRoute === '/logs'}>
        System Logs
      </a>
      <a href="#/gallery" use:link on:click={closeMenu} class:active={$currentRoute === '/gallery'}>
        Gallery
      </a>
    </div>
  {/if}

  <!-- Maintenance -->
  <a href="#" on:click|preventDefault={() => toggleSubmenu('maintenance')} class="parent">
    Maintenance
    <span class="arrow" class:expanded={maintenanceExpanded}>▸</span>
  </a>
  {#if maintenanceExpanded}
    <div class="submenu">
      <a href="/claim" on:click={closeMenu}>
        Claim
      </a>
      <a href="#/test" use:link on:click={closeMenu} class:active={$currentRoute === '/test'}>
        Test Alert
      </a>
      <a href="#/firmware" use:link on:click={closeMenu} class:active={$currentRoute === '/firmware'}>
        Firmware / OTA
      </a>
      <a href="#/reboot" use:link on:click={closeMenu} class:active={$currentRoute.startsWith('/reboot')}>
        Reboot
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
