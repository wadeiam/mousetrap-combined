<script>
  import Layout from './components/Layout.svelte';
  import { currentRoute } from './lib/router.js';

  // Import all page components
  import Dashboard from './pages/Dashboard.svelte';
  import Gallery from './pages/Gallery.svelte';
  import Calibration from './pages/Calibration.svelte';
  import ServoSettings from './pages/ServoSettings.svelte';
  import Settings from './pages/Settings.svelte';
  import Logs from './pages/Logs.svelte';
  import Firmware from './pages/Firmware.svelte';
  import TestAlert from './pages/TestAlert.svelte';
  import Setup from './pages/Setup.svelte';

  // Route matching
  $: component = getComponent($currentRoute);
  $: isSetupRoute = $currentRoute === '/setup' || $currentRoute === 'setup';

  function getComponent(path) {
    // Normalize path
    const route = path.startsWith('/') ? path : '/' + path;

    // Match routes
    if (route === '/' || route === '') return Dashboard;
    if (route === '/gallery') return Gallery;
    if (route === '/calibration') return Calibration;
    if (route === '/servo') return ServoSettings;
    if (route === '/settings') return Settings;
    if (route === '/logs') return Logs;
    if (route === '/status') return Logs; // Alias for logs
    if (route === '/firmware') return Firmware;
    if (route.startsWith('/reboot')) return Firmware; // Handle reboot on firmware page
    if (route === '/test') return TestAlert;
    if (route === '/setup') return Setup;

    // Default to Dashboard for unknown routes
    return Dashboard;
  }
</script>

<!-- Setup page is standalone (no Layout wrapper) for captive portal context -->
{#if isSetupRoute}
  <svelte:component this={component} />
{:else}
  <Layout>
    <svelte:component this={component} />
  </Layout>
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #111;
    color: #ddd;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    overflow-x: hidden; /* Hide horizontal scrollbar */
  }

  :global(html) {
    overflow-x: hidden; /* Hide horizontal scrollbar on html element */
  }

  /* Hide scrollbars but allow scrolling */
  :global(*::-webkit-scrollbar) {
    display: none; /* Chrome, Safari, Edge */
  }

  :global(*) {
    box-sizing: border-box; /* Ensure padding doesn't add to width */
    -ms-overflow-style: none; /* IE and Edge */
    scrollbar-width: none; /* Firefox */
  }

  :global(button) {
    font-family: inherit;
  }
</style>
