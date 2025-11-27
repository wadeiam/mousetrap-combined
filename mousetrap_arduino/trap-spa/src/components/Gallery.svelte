<script>
  import { onMount } from 'svelte';
  import { EP, getJson, jslog } from '../ep';

  let files = [];
  let loading = true;
  let err = '';

  function sortFiles(a, b) {
    // sort newest-looking first if names carry timestamps, else by name desc
    return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0);
  }

  async function load() {
    loading = true; err = '';
    try {
      const j = await getJson(EP.captures);
      files = Array.isArray(j.files) ? j.files.slice().sort(sortFiles) : [];
    } catch (e) {
      err = 'Failed to load captures';
      jslog(`captures:${e}`);
    } finally {
      loading = false;
    }
  }

  function thumbUrl(f) {
    // For images, show the actual file; for videos, show a placeholder icon
    return f.kind === 'image' ? EP.fileUrl(f.name) : null;
  }

  function openItem(f) {
    if (f.kind === 'image') {
      window.open(EP.fileUrl(f.name), '_blank', 'noreferrer');
    } else if (f.kind === 'video') {
      // Use your existing viewer (better UX than raw multipart stream in <img>)
      window.open(EP.view(f.name), '_blank', 'noreferrer');
    } else {
      window.open(EP.download(f.name), '_blank', 'noreferrer');
    }
  }

  function dlItem(f) {
    window.open(EP.download(f.name), '_blank', 'noreferrer');
  }

  onMount(load);
</script>

<style>
  .toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px}
  button{background:#1e1e1e;border:1px solid #333;padding:8px 12px;border-radius:6px;color:#eee;cursor:pointer}
  button:hover{background:#272727}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
  .card{border:1px solid #333;border-radius:8px;padding:8px;background:#141414}
  .thumb{width:100%;aspect-ratio:4/3;object-fit:cover;background:#000;border-radius:6px}
  .name{font-size:12px;color:#bbb;word-break:break-all;margin:6px 0 8px}
  .row{display:flex;gap:8px}
  .pill{padding:4px 10px;border:1px solid #333;border-radius:999px;font-size:12px;color:#aaa}
  .placeholder{width:100%;aspect-ratio:4/3;background:repeating-linear-gradient(45deg,#1f1f1f,#1f1f1f 10px,#222 10px,#222 20px);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px}
</style>

<div class="toolbar">
  <button on:click={load} disabled={loading}>Refresh</button>
  {#if loading}<span class="pill">Loading…</span>{/if}
  {#if err}<span class="pill">{err}</span>{/if}
</div>

{#if !loading && files.length === 0}
  <div class="pill">No captures yet.</div>
{:else}
  <div class="grid">
    {#each files as f}
      <div class="card">
        {#if f.kind === 'image'}
          <img alt={f.name} class="thumb" src={EP.fileUrl(f.name)} />
        {:else if f.kind === 'video'}
          <div class="placeholder">MJPEG video</div>
        {:else}
          <div class="placeholder">File</div>
        {/if}
        <div class="name" title={f.name}>{f.name}</div>
        <div class="row">
          <button on:click={() => openItem(f)}>Open</button>
          <button on:click={() => dlItem(f)}>Download</button>
        </div>
      </div>
    {/each}
  </div>
{/if}
