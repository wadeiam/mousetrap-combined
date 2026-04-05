<script>
  export let error = null; // { message: string, details?: any }

  function dismiss() {
    error = null;
  }
</script>

{#if error}
  <div class="error-banner">
    <div class="error-content">
      <strong>⚠️ Error:</strong> {error.message}
      {#if error.details}
        <div class="error-details">{JSON.stringify(error.details)}</div>
      {/if}
    </div>
    <button class="dismiss-btn" on:click={dismiss}>✕</button>
  </div>
{/if}

<style>
  .error-banner {
    background: #3a1a1a;
    border: 1px solid #ff6b6b;
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    color: #ffcccc;
  }

  .error-content {
    flex: 1;
  }

  .error-details {
    margin-top: 8px;
    font-size: 12px;
    opacity: 0.8;
    font-family: monospace;
  }

  .dismiss-btn {
    background: transparent;
    border: none;
    color: #ffcccc;
    cursor: pointer;
    font-size: 20px;
    padding: 0 8px;
    margin-left: 12px;
  }

  .dismiss-btn:hover {
    color: #ff6b6b;
  }
</style>
