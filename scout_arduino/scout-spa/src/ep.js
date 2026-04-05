// Resolve device-root endpoints from /app/
export const EP = {
  auto:    '../auto.jpg',
  camera:  '../camera',
  led:     '../toggleLED',
  ledStat: '../ledStatus',
  reset:   '../reset',
  falseA:  '../falseAlarm',
  data:    '../data',
  jslog:   '../jslog',

  // Calibration
  calib:   '../api/calib',
  setCalib:'../setCalib',
  recalib: '../recalib',

  // Gallery
  captures: '../api/captures',
  download: (name) => `../download?f=${encodeURIComponent(name)}`,
  view:     (name) => `../view?f=${encodeURIComponent(name)}`,
  fileUrl:  (name) => `../captures/${encodeURIComponent(name)}`
};

export async function getText(path, init) {
  const r = await fetch(path, { cache:'no-store', ...init });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.text();
}
export async function getJson(path, init) {
  const r = await fetch(path, { cache:'no-store', ...init });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
export function jslog(msg) {
  try {
    fetch(EP.jslog, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ m: String(msg).slice(0, 250) })
    }).catch(()=>{});
  } catch {}
}
