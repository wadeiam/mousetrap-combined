<script>
  export let title = '';
</script>

<div class="card">
  <div class="card-header">
    {#if title}
      <h3 class="card-title">{title}</h3>
    {/if}
    <div class="card-actions">
      <slot name="actions" />
    </div>
  </div>
  <div class="card-content">
    <slot />
  </div>
</div>

<style>
  .card {
    background: #181818;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .card-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #ddd;
  }

  .card-actions {
    display: flex;
    gap: 0.5rem;
  }

  .card-content {
    color: #bbb;
  }
</style>
