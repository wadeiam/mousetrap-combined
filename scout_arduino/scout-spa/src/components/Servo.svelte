<script>
  import { EP, getText, jslog } from '../ep';
  let servoVal = 1500;     // uS
  let start = '';          // user-supplied; can be blank if unknown
  let end = '';
  let disableServo = false;

  async function testMove(v){ try{ await getText(`${EP.servoSet}?val=${v}`);}catch(e){ jslog(`servoSet:${e}`); alert('Servo disabled or error'); } }
  async function save(){
    try{
      const fd = new FormData();
      if(start !== '') fd.append('start', String(start));
      if(end !== '') fd.append('end', String(end));
      if(disableServo) fd.append('disableServo','1');
      await fetch(EP.setServoSettings, { method:'POST', body: fd });
      alert('Servo settings saved');
    }catch(e){ jslog(`setServo:${e}`); alert('Save failed'); }
  }
</script>

<style>
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  input[type="number"]{width:100px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:6px}
  .box{border:1px solid #333;border-radius:8px;padding:12px}
</style>

<div class="box">
  <div class="row">
    <label>Start (uS) <input type="number" bind:value={start} inputmode="numeric" /></label>
    <label>End (uS) <input type="number" bind:value={end} inputmode="numeric" /></label>
    <label><input type="checkbox" bind:checked={disableServo} /> Disable Servo</label>
    <button on:click={save}>Save</button>
  </div>
  <div class="row" style="margin-top:10px">
    <label>Test move: <input type="range" min="500" max="2500" step="5" bind:value={servoVal} on:input={() => testMove(servoVal)} /></label>
    <span>{servoVal} uS</span>
  </div>
</div>
