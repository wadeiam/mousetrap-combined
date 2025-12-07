<script>
  import Home from './pages/Home.svelte';
  import Gallery from './pages/Gallery.svelte';
  import Settings from './pages/Settings.svelte';
  import Setup from './pages/Setup.svelte';

  let currentPage = 'home';
  let status = null;
  let needsSetup = false;

  // Check device status on load
  async function checkStatus() {
    try {
      const res = await fetch('/api/status');
      status = await res.json();
      needsSetup = !status.claimed && !status.standalone;
    } catch (e) {
      console.error('Failed to get status:', e);
    }
  }

  checkStatus();

  function navigate(page) {
    currentPage = page;
  }
</script>

<div class="app">
  <header class="header">
    <h1>Scout Device</h1>
  </header>

  <main class="main-content">
    {#if needsSetup}
      <Setup on:complete={() => { needsSetup = false; checkStatus(); }} />
    {:else if currentPage === 'home'}
      <Home {status} on:refresh={checkStatus} />
    {:else if currentPage === 'gallery'}
      <Gallery />
    {:else if currentPage === 'settings'}
      <Settings {status} on:refresh={checkStatus} />
    {/if}
  </main>

  {#if !needsSetup}
    <nav class="nav">
      <div
        class="nav-item"
        class:active={currentPage === 'home'}
        on:click={() => navigate('home')}
        on:keydown={(e) => e.key === 'Enter' && navigate('home')}
        role="button"
        tabindex="0"
      >
        <span class="nav-icon">🏠</span>
        Home
      </div>
      <div
        class="nav-item"
        class:active={currentPage === 'gallery'}
        on:click={() => navigate('gallery')}
        on:keydown={(e) => e.key === 'Enter' && navigate('gallery')}
        role="button"
        tabindex="0"
      >
        <span class="nav-icon">🖼️</span>
        Gallery
      </div>
      <div
        class="nav-item"
        class:active={currentPage === 'settings'}
        on:click={() => navigate('settings')}
        on:keydown={(e) => e.key === 'Enter' && navigate('settings')}
        role="button"
        tabindex="0"
      >
        <span class="nav-icon">⚙️</span>
        Settings
      </div>
    </nav>
  {/if}
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .main-content {
    flex: 1;
    padding-bottom: 70px;
  }
</style>
