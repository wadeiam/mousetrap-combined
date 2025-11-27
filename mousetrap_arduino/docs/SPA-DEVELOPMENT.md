# SPA Development Guide

**Local Svelte web interface served from ESP32's LittleFS filesystem**

---

## Quick Reference

### Build Everything
```bash
cd /Users/wadehargrove/Documents/MouseTrap/Arduino
./build-littlefs.sh
```

This script:
1. Builds the Svelte SPA (`trap-spa/`)
2. Copies files to `data/app/`
3. Creates LittleFS filesystem image (`build/littlefs.bin`)

### Deploy to Device
```bash
curl -u "ops:changeme" \
  -F "file=@build/littlefs.bin" \
  http://192.168.133.46/uploadfs
```

---

## What is the SPA?

The **Single Page Application (SPA)** is a local web interface that:
- Runs directly on each ESP32 device
- Served from the device's LittleFS partition (~11MB)
- Works offline (no server/internet required)
- Built with Svelte + Vite
- Total size: ~120KB (minified)

### Features
- Dashboard - Device status, camera view
- Settings - WiFi, MQTT, configuration
- Gallery - View captured images
- Logs - System logs
- Calibration - Servo and sensor setup
- Firmware - Local OTA updates

---

## File Structure

```
mousetrap_arduino/
├── trap-spa/                    # Svelte source code
│   ├── src/
│   │   ├── pages/              # Page components
│   │   │   ├── Dashboard.svelte
│   │   │   ├── Settings.svelte
│   │   │   └── ...
│   │   ├── components/         # Reusable components
│   │   │   ├── Layout.svelte
│   │   │   ├── NavMenu.svelte
│   │   │   └── Card.svelte
│   │   └── lib/                # Utilities
│   │       ├── api.js          # Device API client
│   │       └── stores.js       # Svelte stores
│   ├── dist/                   # Vite build output
│   │   ├── index.html
│   │   ├── assets/             # JS/CSS bundles
│   │   └── version.json
│   └── package.json
│
├── data/                        # LittleFS source files
│   └── app/                     # SPA files (copied from dist/)
│
├── build/
│   └── littlefs.bin             # Compiled filesystem image
│
└── build-littlefs.sh            # Build automation script
```

---

## Development Workflow

### 1. Local Development (Fast Iteration)

```bash
cd trap-spa
npm run dev
```

- Opens dev server on `http://localhost:5173`
- Hot module replacement (instant updates)
- To test against real device API, update fetch URLs in `src/lib/api.js`

### 2. Build for Production

```bash
cd trap-spa
npm run build
```

Output in `trap-spa/dist/`:
- `index.html` - Entry point
- `assets/index-<hash>.js` - JavaScript bundle (~90KB)
- `assets/index-<hash>.css` - Stylesheet (~31KB)
- `version.json` - Version metadata
- `vite.svg` - Logo

### 3. Create Filesystem Image

```bash
cd ..
./build-littlefs.sh
```

This:
1. Builds SPA with `npm run build`
2. Copies `dist/` files to `data/app/`
3. Runs `mklittlefs` to create `build/littlefs.bin`

### 4. Deploy to Device

```bash
curl -u "ops:changeme" \
  -F "file=@build/littlefs.bin" \
  http://192.168.133.46/uploadfs
```

### 5. Verify Deployment

```bash
# Wait for device reboot (~30 seconds)
sleep 35

# Check SPA loads
curl http://192.168.133.46/app/ | head -20

# Look for new asset hashes (Vite uses content hashing)
```

---

## Version Management

### Update SPA Version

Edit `trap-spa/dist/version.json`:
```json
{
  "version": "2.0.40",
  "buildDate": "2025-11-16",
  "changelog": "Added claim link to maintenance menu"
}
```

This version is tracked separately from firmware version.

---

## Build Tools

### mklittlefs

Creates filesystem images compatible with ESP32's LittleFS partition.

**Location:**
```
/Users/wadehargrove/Library/Arduino15/packages/esp32/tools/mklittlefs/4.0.2-db0513a/mklittlefs
```

**Parameters:**
```bash
mklittlefs \
  -c data \              # Source directory
  -p 256 \               # Page size (matches flash)
  -b 4096 \              # Block size (matches flash)
  -s 10485760 \          # Partition size (10.875 MB = 0xAE0000)
  build/littlefs.bin     # Output file
```

### Vite

Builds and bundles the Svelte SPA.

**Config:** `trap-spa/vite.config.js`
- Outputs to `dist/`
- Minifies JS/CSS
- Content-hashed filenames for cache busting
- Base URL: `/app/` (matches ESP32 routing)

---

## API Integration

The SPA communicates with the ESP32 via HTTP REST API.

### API Client: `src/lib/api.js`

**Important:** The API client includes captive portal detection to handle iPhone/Android captive portal browsers.

```javascript
// Captive Portal Detection (Added Nov 23, 2025)
// On iPhone, captive portal browser sets window.location.origin to
// 'http://captive.apple.com' instead of device IP. This function
// detects that and returns the correct device IP.
function getBaseUrl() {
  const origin = window.location.origin;
  if (origin.includes('192.168.') || origin.includes('localhost') || origin.includes('mousetrap.local')) {
    return origin;  // Normal browsing - use current origin
  }
  // Captive portal mode - use device's AP IP
  console.log('[API] Captive portal detected, using 192.168.4.1');
  return 'http://192.168.4.1';
}

const BASE_URL = getBaseUrl();

export async function getStatus() {
  const res = await fetch(`${BASE_URL}/data`);
  return res.json();
}

export async function getClaimStatus() {
  const res = await fetch(`${BASE_URL}/api/device/claim-status`);
  return res.json();
}

// Setup Wizard endpoints
export async function connectWiFi(config) {
  // config: { ssid, password, email, accountPassword, deviceName }
  return apiFetch('/api/setup/connect', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function standaloneMode(config) {
  // config: { ssid, password }
  // Enables standalone mode - WiFi without cloud registration
  return apiFetch('/api/setup/standalone', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}
```

See [DEVICE-API.md](./DEVICE-API.md) for full endpoint reference.

---

## Troubleshooting

### SPA Doesn't Load (404 Errors)

**Cause:** LittleFS not mounted or files not in partition

**Fix:**
1. Check firmware has LittleFS.begin():
   ```cpp
   if (!LittleFS.begin(true)) {
     Serial.println("LittleFS mount failed");
   }
   ```
2. Rebuild and redeploy filesystem:
   ```bash
   ./build-littlefs.sh
   curl -u "ops:changeme" -F "file=@build/littlefs.bin" http://192.168.133.46/uploadfs
   ```

### Old Version Still Showing

**Cause:** Browser cache

**Fix:**
- Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- Clear browser cache
- Try incognito/private mode

### Assets Not Loading (CSS/JS 404)

**Symptom:** SPA loads but no styling, console shows 404 for assets

**Cause:** Didn't rebuild SPA before creating filesystem image

**Fix:**
1. Rebuild SPA:
   ```bash
   cd trap-spa && npm run build && cd ..
   ```
2. Rebuild filesystem:
   ```bash
   ./build-littlefs.sh
   ```
3. Verify assets exist:
   ```bash
   ls -la data/app/assets/
   ```

### Build Fails: "mklittlefs not found"

**Cause:** ESP32 Arduino core not installed

**Fix:**
```bash
arduino-cli core install esp32:esp32
```

### npm Build Fails

**Symptom:** `npm run build` errors

**Possible causes:**
1. Dependencies not installed
2. Node version incompatible
3. Syntax errors in Svelte code

**Fix:**
```bash
cd trap-spa
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## File Sizes

Typical build sizes (after minification):

| File | Size |
|------|------|
| index.html | ~600 bytes |
| JavaScript bundle | ~90 KB |
| CSS bundle | ~31 KB |
| Images/SVG | ~2 KB |
| **Total** | **~124 KB** |

LittleFS partition: **10.875 MB** (plenty of headroom)

---

## Mobile Development Notes

### Fullscreen API (for Camera Zoom)

The Dashboard implements fullscreen for landscape camera viewing.

**Key learnings:**
- Must use Fullscreen API, not CSS alone
- Requires webkit prefixes for iOS Safari
- Must listen for fullscreen change events (user can exit with ESC)
- Request fullscreen on `document.documentElement`, not individual elements

See `trap-spa/CLAUDE_LEARNING_NOTES.md` for detailed mobile development gotchas.

### Responsive Grid Layout

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
}
```

**Important:** 250px minimum accommodates narrow portrait phones. Don't use 300px or cards will overflow.

---

## Testing Checklist

Before deploying SPA updates:

- [ ] Test in dev mode (`npm run dev`)
- [ ] Build succeeds without errors
- [ ] Build creates new asset hashes
- [ ] Filesystem image created successfully
- [ ] Deploy to test device
- [ ] Hard refresh browser
- [ ] Test all pages load
- [ ] Test API calls work
- [ ] Test on mobile (portrait and landscape)
- [ ] Check version displays correctly

---

## Adding New Pages

### 1. Create Page Component

```svelte
<!-- src/pages/NewPage.svelte -->
<script>
  import { onMount } from 'svelte';
  import Card from '../components/Card.svelte';

  let data = {};

  onMount(async () => {
    // Fetch data from device API
  });
</script>

<div class="page">
  <h1>New Page</h1>
  <Card>
    <!-- content -->
  </Card>
</div>

<style>
  /* scoped styles */
</style>
```

### 2. Add Route

Edit `src/App.svelte`:
```javascript
import NewPage from './pages/NewPage.svelte';

// In routes object:
'/new-page': NewPage
```

### 3. Add Nav Link

Edit `src/components/NavMenu.svelte`:
```svelte
<a href="#/new-page" use:link>
  New Page
</a>
```

---

## Best Practices

1. **Always version builds** - Update `version.json` before deployment
2. **Test locally first** - Use dev server for rapid iteration
3. **Verify asset hashes** - Ensure Vite generates new hashes after changes
4. **Hard refresh browsers** - Clear cache when testing updates
5. **Check file sizes** - Keep bundles small for faster loading
6. **Mobile-first** - Test responsive layouts on narrow screens
7. **API error handling** - Handle fetch failures gracefully

---

## Dependencies

### Runtime (on device)
- None - pure Svelte compiled to vanilla JS

### Development
```json
{
  "svelte": "^4.x",
  "vite": "^5.x",
  "@sveltejs/vite-plugin-svelte": "^3.x",
  "svelte-spa-router": "^4.x"
}
```

Install:
```bash
cd trap-spa
npm install
```

---

## Next Steps

After SPA updates:
1. Deploy filesystem: See [OTA-DEPLOYMENT.md](./OTA-DEPLOYMENT.md)
2. Test on device
3. Check system logs for errors
4. Verify version updated

---

**Related Documentation:**
- [OTA-DEPLOYMENT.md](./OTA-DEPLOYMENT.md) - Deploy filesystem to devices
- [DEVICE-API.md](./DEVICE-API.md) - ESP32 API endpoints
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues
- `trap-spa/CLAUDE_LEARNING_NOTES.md` - Mobile development notes
