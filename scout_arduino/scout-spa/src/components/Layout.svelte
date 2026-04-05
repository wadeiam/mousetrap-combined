<script>
  import NavMenu from './NavMenu.svelte';
  import { menuOpen } from '../lib/stores.js';

  function toggleMenu() {
    menuOpen.update(open => !open);
  }

  // Close menu on Escape key
  function handleKeydown(event) {
    if (event.key === 'Escape' && $menuOpen) {
      menuOpen.set(false);
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="layout">
  <!-- Hamburger button -->
  <div
    class="hamburger"
    on:click={toggleMenu}
    on:keydown={(e) => e.key === 'Enter' && toggleMenu()}
    role="button"
    tabindex="0"
    aria-label="Toggle navigation menu"
  >
    <div class="bar"></div>
    <div class="bar"></div>
    <div class="bar"></div>
  </div>

  <!-- Side navigation menu -->
  <NavMenu />

  <!-- Main content area -->
  <main class="content">
    <slot />
  </main>
</div>

<style>
  .layout {
    min-height: 100vh;
    background: #111;
    color: #ddd;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .hamburger {
    position: fixed;
    top: 12px;
    left: 12px;
    width: 30px;
    height: 24px;
    cursor: pointer;
    z-index: 1001;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .bar {
    width: 100%;
    height: 3px;
    background-color: #ddd;
    transition: all 0.3s ease;
  }

  .hamburger:hover .bar {
    background-color: #9fdcff;
  }

  .content {
    padding: 60px 4px 8px 4px; /* Very small border for mobile */
    max-width: 1200px;
    margin: 0 auto;
    width: 100%; /* Ensure content fills available width */
  }

  @media (min-width: 640px) {
    .content {
      padding: 60px 16px 16px 16px; /* More padding on larger screens */
    }
  }

  @media (min-width: 768px) {
    .content {
      padding: 16px 24px;
    }
  }
</style>
