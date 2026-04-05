<script>
  let count = 0;
  const now = Date.now();
</script>

<main style="font: 16px system-ui, sans-serif; color:#ddd; background:#111; min-height:100vh; padding:16px">
  <h1 style="margin:0 0 12px 0">Svelte OK ✅</h1>
  <p style="margin:0 0 12px 0">
    Environment smoke test — open at <code>/app/?smoke</code>.
    If you see this and the button works, loader + DOM mount are good.
  </p>
  <ul style="margin:0 0 12px 18px; padding:0">
    <li>time: {new Date(now).toLocaleString?.() || now}</li>
    <li>ua: {navigator.userAgent}</li>
  </ul>
  <button on:click={() => count++} style="padding:8px 12px; border-radius:6px; border:1px solid #444; background:#1a1a1a; color:#ddd">
    Clicks: {count}
  </button>
</main>
