<script>
  // Svelte 4–safe Counter component (no runes).
  // Preserves variable name `count` and prop `initial`.
  export let initial = 0;
  let count = initial;

  function inc()   { count += 1; }
  function dec()   { count -= 1; }
  function reset() { count  = initial; }
</script>

<style>
  .ctr {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    background: #181818;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 8px 10px;
    color: #ddd;
    font: 14px system-ui, sans-serif;
  }
  button {
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #444;
    background: #1a1a1a;
    color: #ddd;
    cursor: pointer;
  }
  .value { min-width: 32px; text-align: center; font-weight: 600; }
</style>

<div class="ctr">
  <button on:click={dec}>−</button>
  <span class="value">{count}</span>
  <button on:click={inc}>+</button>
  <button on:click={reset} title="Reset">↺</button>
</div>
