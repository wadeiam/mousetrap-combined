<script>
  import { onMount } from 'svelte';
  import { EP, getJson, getText, jslog } from '../ep';

  let threshold=null, falseOff=null, calibrationOffset=0, overrideThreshold=0;

  async function load(){
    try{
      const c = await getJson(EP.calib);
      if('threshold' in c) threshold=c.threshold;
      if('falseOff' in c) falseOff=c.falseOff;
      if('calibrationOffset' in c) calibrationOffset=c.calibrationOffset;
      if('overrideThreshold' in c) overrideThreshold=c.overrideThreshold;
    }catch(e){ jslog(`calib:${e}`); }
  }
  async function saveCalib(){
    try{
      const url = `${EP.data.replace('/data','') }setCalib?calib=${encodeURIComponent(calibrationOffset)}&overrideTh=${encodeURIComponent(overrideThreshold)}`;
      await getText(url);
      alert('Calibration saved');
      await load();
    }catch(e){ jslog(`setCalib:${e}`); alert('Save failed'); }
  }
  async function clearOverride(){
    try{
      const url = `${EP.data.replace('/data','') }setCalib?overrideTh=0`;
      await getText(url);
      await load();
    }catch(e){ jslog(`clearOv:${e}`); }
  }
  async function recalibrate(){
    try{
      const url = `${EP.data.replace('/data','') }recalib`;
      await getText(url);
      alert('Recalibration started');
    }catch(e){ jslog(`recalib:${e}`); }
  }
  onMount(load);
</script>

<style>
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  input[type="number"]{width:110px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:6px}
  .box{border:1px solid #333;border-radius:8px;padding:12px}
</style>

<div class="box">
  <div class="row">
    <div>threshold: <b>{threshold}</b> mm</div>
    <div>falseOff: <b>{falseOff}</b> mm</div>
  </div>

  <div class="row" style="margin-top:10px">
    <label>Calibration Offset (mm)
      <input type="number" bind:value={calibrationOffset} />
    </label>
    <label>Override Threshold (mm)
      <input type="number" bind:value={overrideThreshold} />
    </label>
  </div>

  <div class="row" style="margin-top:10px">
    <button on:click={saveCalib}>Save</button>
    <button on:click={clearOverride}>Clear Override</button>
    <button on:click={recalibrate}>Recalibrate</button>
  </div>
</div>
