# Claude Learning Notes - Mobile Fullscreen & Layout Issues

## Session Date: 2025-11-13
## Context: v2.0.38 → v2.0.39 deployment

---

## Problem 1: Browser Chrome Visible in Landscape Zoom Mode

### Initial Approach (FAILED)
**What was tried**: Changed CSS from `width: 100vw; height: 100vh` to `inset: 0`

**Why it failed**:
- `100vh` includes the browser chrome height on mobile
- `inset: 0` only sizes to available viewport space AFTER browser chrome
- Neither approach actually HIDES the browser UI elements
- On mobile, the URL bar and tabs remain visible when rotating to landscape

### Correct Solution: Fullscreen API
**File**: `src/pages/Dashboard.svelte:195-227`

**Key implementation details**:
```javascript
async function toggleZoom() {
  if (!isZoomed) {
    // CRITICAL: Use document.documentElement, not the image element
    const elem = document.documentElement;

    // CRITICAL: Need webkit prefixes for iOS/Safari support
    if (elem.requestFullscreen) {
      await elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      await elem.webkitRequestFullscreen();
    }

    isZoomed = true;
  } else {
    // Check both standard and webkit fullscreen states
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      }
    }
    isZoomed = false;
  }
}
```

**Critical gotchas**:
1. Must use `async/await` - the API returns promises
2. Must request fullscreen on `document.documentElement`, not on individual elements
3. MUST include webkit prefixes for iOS/Safari compatibility
4. Need try-catch with fallback behavior
5. MUST add event listeners for fullscreen changes (users can exit with ESC key)

### State Synchronization Required
**File**: `src/pages/Dashboard.svelte:229-234, 249-251, 264-266`

```javascript
// CRITICAL: Handle user exiting fullscreen via ESC or browser controls
function handleFullscreenChange() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    isZoomed = false;
  }
}

// In onMount:
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

// In onDestroy (CRITICAL to prevent memory leaks):
document.removeEventListener('fullscreenchange', handleFullscreenChange);
document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
```

**Why this matters**: Users can exit fullscreen without clicking your UI:
- ESC key
- Browser back button
- Rotating device
- Browser gestures

If you don't listen for these events, your UI state (`isZoomed`) gets out of sync with actual fullscreen state.

---

## Problem 2: Cards Not Fitting in Portrait After Landscape Rotation

### The Issue
When rotating from landscape back to portrait, the grid cards (Sensor Range and System Status) were wider than the viewport, causing horizontal overflow.

### Root Cause
CSS Grid with `minmax(300px, 1fr)` - the 300px minimum was too wide for narrow portrait phone screens.

### Solution
**File**: `src/pages/Dashboard.svelte:399`

Changed from:
```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}
```

To:
```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
}
```

**Why 250px**:
- Accommodates narrower portrait screens (many phones are 360-375px wide)
- With padding/margins, 300px minimum could force horizontal scroll
- 250px still maintains proper grid layout on wider screens

**Key learning**: CSS Grid `minmax()` minimum values directly impact whether content fits on narrow mobile screens. Always test the actual minimum viewport width your users have.

---

## Deployment Workflow for This ESP32 Project

### Build Process
```bash
# 1. Build Svelte SPA with Vite
cd trap-spa && npm run build

# 2. Copy built files to data directory
cp -r dist/* ../data/app/

# 3. Update version.json
# Edit ../data/version.json manually or via script

# 4. Build LittleFS filesystem binary
cd .. && /opt/homebrew/bin/mklittlefs -c data -s 1441792 build/littlefs.bin

# 5. Create versioned directory structure
mkdir -p /path/to/server/firmware/.../filesystem/v2.0.XX/

# 6. Copy filesystem binary
cp build/littlefs.bin /path/to/server/firmware/.../filesystem/v2.0.XX/v2.0.XX.bin

# 7. Upload to device
curl -u "ops:changeme" \
  -F "file=@/path/to/v2.0.XX.bin" \
  "http://192.168.133.46/uploadfs"

# Device auto-reboots after upload
```

### Verification
```bash
# Check that new assets are being served
curl -s http://192.168.133.46/app/ | head -15

# Look for new asset filenames (Vite uses content hashing)
# Example: index-vmiS9O9C.js, index-BfSaVW6F.css
```

**Key insight**: Vite generates different asset filenames on each build (content hashing). To verify deployment succeeded, check that the HTML references the NEW asset filenames you just built.

---

## Mobile Development Gotchas

### 1. Browser Chrome Behavior
- On mobile, browser chrome (URL bar, tabs) dynamically appears/disappears
- CSS `100vh` includes the chrome height
- `100dvh` (dynamic viewport height) might help but has limited support
- For true fullscreen (hiding ALL browser UI), you MUST use Fullscreen API

### 2. Viewport Meta Tag
Already correctly configured in this project:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover, user-scalable=yes" />
```

The `viewport-fit=cover` is important for edge-to-edge display on iOS devices with notches.

### 3. Testing Responsive Layouts
- Chrome DevTools mobile emulation doesn't perfectly replicate real device behavior
- Browser chrome behavior differs between:
  - Chrome/Android
  - Safari/iOS
  - Different phone models
- Always test on actual devices when possible

### 4. Event Listener Cleanup
When using DOM event listeners in Svelte components:
- Add listeners in `onMount`
- ALWAYS remove in `onDestroy` to prevent memory leaks
- This is especially important for document-level listeners

---

## File Structure Context

```
trap-spa/
├── src/
│   ├── pages/
│   │   └── Dashboard.svelte      # Main dashboard with camera zoom
│   ├── components/
│   │   ├── Layout.svelte         # App layout with hamburger menu
│   │   ├── NavMenu.svelte        # Side navigation
│   │   └── Card.svelte           # Reusable card component
│   └── lib/
│       ├── api.js                # API functions
│       └── stores.js             # Svelte stores
├── dist/                         # Vite build output
└── package.json

../data/
├── app/                          # Copied from dist/
└── version.json                  # Filesystem version tracking

../build/
└── littlefs.bin                  # Compiled filesystem binary
```

---

## API Endpoints Reference

The ESP32 device exposes these endpoints:
- `/app/` - Serves the Svelte SPA
- `/camera` - Camera image without LED flash (for live mode)
- `/auto.jpg` - Camera image with LED flash (for refresh)
- `/uploadfs` - Filesystem upload endpoint (requires auth)
- `/uploadfw` - Firmware upload endpoint (requires auth)
- `/api/status` - Get device status
- `/api/toggle-led` - Toggle LED
- `/api/reset-alarm` - Reset alarm state
- `/api/false-alarm` - Report false alarm (adjusts threshold)
- `/api/heartbeat` - Send heartbeat

Authentication: `ops:changeme`

---

## Version History Context

- v2.0.37 - Previous stable version
- v2.0.38 - Attempted fix with `inset: 0` (didn't solve browser chrome issue)
- v2.0.39 - Fullscreen API implementation + grid width fix (current)

---

## Future Considerations

### Potential Improvements
1. Add visual indicator when in fullscreen mode
2. Consider orientation lock when in fullscreen
3. Add haptic feedback on fullscreen toggle (if supported)
4. Implement pinch-to-zoom as alternative to tap-to-fullscreen

### Known Limitations
1. Fullscreen API requires user gesture (can't auto-fullscreen on page load)
2. Some browsers may prompt user for fullscreen permission
3. Fullscreen behavior varies across browsers/devices

---

## Testing Checklist for Mobile Layout Changes

When making mobile layout changes, test:
- [ ] Portrait orientation on narrow phone (360px width)
- [ ] Portrait orientation on wider phone (414px width)
- [ ] Landscape orientation
- [ ] Rotation from portrait → landscape → portrait
- [ ] Browser chrome behavior (scroll to hide/show)
- [ ] Fullscreen mode entry/exit
- [ ] ESC key exits fullscreen properly
- [ ] State synchronization after fullscreen changes
- [ ] Both iOS Safari and Chrome/Android if possible

---

## Common Mistakes to Avoid

1. **Don't assume CSS alone can hide browser chrome** - Use Fullscreen API
2. **Don't forget webkit prefixes** - iOS Safari needs them
3. **Don't skip fullscreen event listeners** - State gets out of sync
4. **Don't forget event listener cleanup** - Memory leaks in Svelte components
5. **Don't use hardcoded viewport dimensions** - Use responsive units and grid
6. **Don't assume 300px minimum is safe** - Some phones are narrower
7. **Don't skip actual device testing** - DevTools emulation isn't perfect

---

## Quick Reference: CSS vs Fullscreen API

| Approach | Hides Browser Chrome? | Use Case |
|----------|----------------------|----------|
| `width: 100vw; height: 100vh` | ❌ No | Simple fullscreen-style layout |
| `inset: 0` | ❌ No | Fixed positioning within viewport |
| `position: fixed; top: 0; left: 0; right: 0; bottom: 0;` | ❌ No | Same as inset: 0 |
| Fullscreen API | ✅ Yes | True fullscreen, hides ALL browser UI |

**Bottom line**: If you need to actually HIDE the browser UI, you MUST use the Fullscreen API. CSS positioning alone will never hide browser chrome.
