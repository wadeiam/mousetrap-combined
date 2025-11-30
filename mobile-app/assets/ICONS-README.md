# MouseTrap Monitor - App Icons & Assets

## Overview

This directory contains all visual assets for the MouseTrap Monitor mobile app, including app icons, splash screens, and notification icons.

## Asset Files

### Source Files (SVG)
- `icon-source.svg` - Main app icon source (1024x1024)
- `notification-icon-source.svg` - Notification icon source (monochrome silhouette)

### Generated Assets
- `icon.png` (1024x1024) - Main app icon for iOS and Android
- `adaptive-icon.png` (1024x1024) - Android adaptive icon foreground layer
- `splash-icon.png` (1024x1024) - Splash screen icon
- `favicon.png` (48x48) - Web favicon
- `notification-icon.png` (96x96) - Android push notification icon

## Icon Design

### Main Icon Features
- **Background**: Primary blue (#0f4c75) with rounded corners
- **Elements**:
  - Mouse trap mechanism (spring, snap bar, trigger plate)
  - Mouse silhouette
  - IoT indicator (signal waves)
  - Monitoring badge with "M" letter
- **Style**: Flat design, simple and recognizable at small sizes
- **Colors**:
  - Primary: #0f4c75 (blue)
  - Background: #1a1a2e (dark purple/blue)
  - Accent: #4CAF50 (green for active/monitoring status)
  - Alert: #ff4444 (red for trap snap bar)
  - Trigger: #ffd700 (gold for bait plate)

### Notification Icon
- **Design**: Simple monochrome silhouette
- **Color**: White (system will tint with notification color #0f4c75)
- **Elements**: Simplified trap outline with alert indicator
- **Size**: 96x96 (Android recommendation)
- **Format**: Transparent background, white foreground

## Regenerating Icons

### Method 1: Using HTML Preview (Easiest)

1. Open `preview-icons.html` in your web browser:
   ```bash
   open preview-icons.html
   ```

2. Click the download buttons for each required icon:
   - Download icon.png
   - Download adaptive-icon.png
   - Download splash-icon.png
   - Download notification-icon.png
   - Download favicon.png

3. The files will be downloaded to your Downloads folder - move them to this directory

4. Rebuild the native projects:
   ```bash
   cd ..
   npx expo prebuild --clean
   ```

### Method 2: Using Shell Script (macOS)

1. Run the icon generation script:
   ```bash
   ./generate-icons.sh
   ```

2. If SVG conversion fails, manually convert to PNG:
   - Open `icon-source.svg` in Safari or Preview
   - Export/Save as PNG at 1024x1024 → save as `icon-temp.png`
   - Open `notification-icon-source.svg`
   - Export/Save as PNG at 1024x1024 → save as `notification-temp.png`

3. Run the PNG-based script:
   ```bash
   ./generate-icons-from-png.sh
   ```

### Method 3: Online Tools

If the above methods don't work:

1. Upload `icon-source.svg` to https://svgtopng.com/ or https://cloudconvert.com/svg-to-png
2. Export at 1024x1024 resolution
3. Save as `icon.png`, `adaptive-icon.png`, and `splash-icon.png`
4. Resize for favicon:
   ```bash
   sips -z 48 48 icon.png --out favicon.png
   ```
5. Repeat for notification icon at 96x96

## Icon Specifications

### iOS Requirements
- **App Icon**: 1024x1024 PNG, no transparency, no rounded corners (iOS adds these)
- **Format**: RGB color space, no alpha channel
- **Referenced in**: `app.json` → `expo.icon`

### Android Requirements
- **App Icon**: 1024x1024 PNG
- **Adaptive Icon**: 1024x1024 PNG (foreground layer on transparent background)
  - Safe zone: Center 66% (avoid placing critical elements in outer 17%)
  - Background color set in `app.json`: #1a1a2e
- **Notification Icon**: 96x96 PNG, white silhouette on transparent background
  - System will tint with color specified in `app.json`: #0f4c75
- **Referenced in**: `app.json` → `expo.android.adaptiveIcon`

### Web Requirements
- **Favicon**: 48x48 PNG
- **Referenced in**: `app.json` → `expo.web.favicon`

### Splash Screen
- **Icon**: 1024x1024 PNG (displayed on colored background)
- **Background**: #1a1a2e (set in `app.json`)
- **Resize Mode**: contain (icon maintains aspect ratio)
- **Referenced in**: `app.json` → `expo.splash`

## Design Guidelines

### Safe Zones
- **iOS**: Keep important elements within center 80% (outer 10% on each side may be masked)
- **Android Adaptive**: Keep within center 66% (outer 17% may be masked)
- **Notification**: Simple silhouette, avoid fine details

### Color Contrast
- Icons should work on both light and dark backgrounds
- Test on iOS (light/dark mode) and Android (various launchers)

### Simplicity
- Icons should be recognizable at 40x40 pixels (smallest display size)
- Avoid text except for single letter badges
- Use bold, clear shapes

## Modifying Icons

To change the icon design:

1. Edit `icon-source.svg` in any SVG editor (Figma, Adobe Illustrator, Inkscape, etc.)
2. Edit `notification-icon-source.svg` for notification icon
3. Maintain the 1024x1024 viewBox
4. Keep colors consistent with app theme
5. Regenerate PNGs using one of the methods above
6. Test on both iOS and Android devices

## App.json Configuration

Current configuration in `/Users/wadehargrove/Documents/MouseTrap/mobile-app/app.json`:

```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#1a1a2e"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#1a1a2e"
      }
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      ["expo-notifications", {
        "icon": "./assets/notification-icon.png",
        "color": "#0f4c75"
      }]
    ]
  }
}
```

## Testing Icons

### iOS
1. Build the app: `npx expo run:ios`
2. Check icon on home screen
3. Test in light and dark mode
4. Verify splash screen on app launch
5. Send test notification to verify notification icon

### Android
1. Build the app: `npx expo run:android`
2. Check adaptive icon behavior (different launchers may mask differently)
3. Test notification icon with test notification
4. Verify splash screen

### Web
1. Run web version: `npx expo start --web`
2. Check favicon in browser tab

## Resources

- [Expo Icon Requirements](https://docs.expo.dev/develop/user-interface/app-icons/)
- [iOS Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Android Adaptive Icons](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive)
- [Material Design - Product Icons](https://m3.material.io/styles/icons/designing-icons)

## Troubleshooting

### Icons not updating after change
```bash
# Clean and rebuild
npx expo prebuild --clean
cd ios && rm -rf build Pods Podfile.lock && cd ..
cd android && ./gradlew clean && cd ..
```

### Android adaptive icon looks cut off
- Ensure important elements are within the center 66% safe zone
- Edit `icon-source.svg` to add more padding

### Notification icon not showing
- Ensure `notification-icon.png` is white silhouette on transparent background
- Rebuild with `npx expo prebuild --clean`
- Check that the plugin is configured in `app.json`

### Wrong colors
- Check color codes in SVG files
- Verify `backgroundColor` in `app.json` matches design (#1a1a2e)
- Verify notification color in plugins section (#0f4c75)
