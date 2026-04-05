<script>
  import { onMount } from 'svelte';
  import { EP, getText, getJson, jslog } from '../ep';

  let imgSrc = EP.auto;
  let live = false;
  let t = null;

  let ledLabel = 'Toggle LED';
  let ledState = 'off';  // Track LED state for styling
  let statusText = '';
  let threshold = null;
  let falseOff = null;

  function bust(url) {
    const u = new URL(url, window.location.href);
    u.searchParams.set('_', Date.now().toString());
    return u.pathname + '?' + u.searchParams.toString();
  }
  function refreshStill() { imgSrc = bust(EP.auto); }
  function startLive() {
    live = true;
    t = setInterval(() => { imgSrc = bust(EP.camera); }, 300);
  }
  function stopLive() { live=false; if(t) clearInterval(t); t=null; refreshStill(); }

  async function toggleLED() {
    try {
      const state = await getText(EP.led);
      ledLabel = `LED: ${state}`;
      ledState = state.toLowerCase();
    }
    catch(e){ alert('LED error'); jslog(`led:${e.message||e}`); }
  }
  async function doReset() {
    try { await getText(EP.reset); statusText='Alarm reset'; await loadData(); }
    catch(e){ alert('Reset failed'); jslog(`reset:${e.message||e}`); }
  }
  async function doFalseAlarm() {
    try {
      const r = await getJson(EP.falseA);
      if (r && 'falseOff' in r) falseOff = r.falseOff;
      if (r && 'threshold' in r) threshold = r.threshold;
      statusText = 'False alarm recorded';
    } catch(e) { alert('False alarm failed'); jslog(`false:${e.message||e}`); }
  }
  async function loadData() {
    try {
      const d = await getJson(EP.data);
      if ('threshold' in d) threshold = d.threshold;
      if ('falseOff' in d) falseOff = d.falseOff;
    } catch(e){ /* non-fatal */ }
  }
  async function initLedLabel() {
    try {
      const state = await getText(EP.ledStat);
      ledLabel = `LED: ${state}`;
      ledState = state.toLowerCase();
    }
    catch { ledLabel='Toggle LED'; ledState='off'; }
  }

  function attachJsErrorForwarding(){
    const onErr = e => jslog(`err:${e?.message||e}`);
    const onRej = e => jslog(`rej:${e?.reason?.message||e?.reason||''}`);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return ()=>{ window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); };
  }

  onMount(async ()=>{
    refreshStill(); await initLedLabel(); await loadData();
    const ledTimer = setInterval(initLedLabel, 5000);
    const detach = attachJsErrorForwarding();
    return ()=>{ if(t) clearInterval(t); clearInterval(ledTimer); detach(); };
  });
</script>

<style>
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  button{background:#1e1e1e;border:1px solid #333;padding:8px 12px;border-radius:6px;color:#eee;cursor:pointer}
  button:hover{background:#272727}
  button.led-on{background:#2d5016;border-color:#4a7c28}
  button.led-on:hover{background:#3a6420}
  .pill{padding:4px 10px;border:1px solid #333;border-radius:999px;font-size:12px;color:#aaa}
  img{max-width:100%;height:auto;display:block;margin:0 auto;border-radius:8px}
  .kv{font-size:13px;color:#bbb}
  .meta{display:flex;gap:10px;align-items:center;margin:8px 0 12px 0}
</style>

<div class="row" style="margin-bottom:10px">
  <button on:click={refreshStill} disabled={live}>Refresh</button>
  {#if live}
    <button on:click={stopLive}>Live: Stop</button>
  {:else}
    <button on:click={startLive}>Live: Start</button>
  {/if}
  <button on:click={toggleLED} class:led-on={ledState === 'on'}>{ledLabel}</button>
  <button on:click={doReset}>Reset Alarm</button>
  <button on:click={doFalseAlarm}>False Alarm</button>
  {#if statusText}<span class="pill">{statusText}</span>{/if}
</div>

<img alt="camera" src={imgSrc} />
<div class="meta">
  {#if threshold !== null}<div class="kv">threshold: <b>{threshold}</b> mm</div>{/if}
  {#if falseOff !== null}<div class="kv">falseOff: <b>{falseOff}</b> mm</div>{/if}
</div>
