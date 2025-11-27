/* MouseTrap SPA - Robust Svelte 4 boot with error handling */
import './app.css';
import App from './App.svelte';

const log = (...a) => console.log('[JS]', ...a);

function showFatal(err) {
  log('app-main: FATAL', err);
  const host = document.getElementById('app');
  if (!host) return;
  if (host.childElementCount === 0) {
    host.innerHTML = `
      <div style="font: 14px system-ui, sans-serif; color:#ddd; background:#111; padding:16px; line-height:1.35">
        <div style="font-weight:600; margin-bottom:8px; color:#ff6b6b">⚠️ App failed to load</div>
        <div style="opacity:.85; margin-bottom:8px">Check console for full stack. Error:</div>
        <pre style="white-space:pre-wrap; background:#181818; border:1px solid #ff6b6b; padding:12px; border-radius:6px; overflow:auto; color:#ffcccc">
${String((err && (err.stack || err.message)) || err)}
        </pre>
      </div>`;
  }
}

// Global error taps
window.addEventListener('error', (e) => log('global-error:', e.message || e.error));
window.addEventListener('unhandledrejection', (e) => log('unhandled-rejection:', e.reason));

// Boot
(function boot() {
  log('app-main: start');
  const host = document.getElementById('app');
  if (!host) {
    showFatal('Missing #app container in HTML');
    return;
  }

  try {
    const app = new App({ target: host });
    window.__MOUSETRAP_APP = { ok: true, mountedAt: Date.now(), app };
    log('app-main: mounted OK');
  } catch (err) {
    window.__MOUSETRAP_APP = { ok: false, error: err, when: Date.now() };
    showFatal(err);
  }
})();
