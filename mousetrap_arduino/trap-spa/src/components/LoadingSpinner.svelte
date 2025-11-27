<script>
  export let size = 40; // px
  export let color = '#9fdcff';
</script>

<div class="spinner-container">
  <div class="spinner" style="width: {size}px; height: {size}px; border-color: {color} transparent transparent transparent;"></div>
</div>

<style>
  .spinner-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
  }

  .spinner {
    border: 3px solid;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>
