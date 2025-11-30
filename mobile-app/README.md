# MouseTrap Monitor - Mobile App

React Native/Expo mobile app for monitoring MouseTrap devices on iOS and Android.

## Features

- **Authentication** - Login with existing MouseTrap dashboard credentials
- **Device List** - View all traps with status, battery level, and trap state
- **Device Details** - View detailed device information including:
  - Network status and signal strength
  - Firmware version and uptime
  - Camera snapshot viewing and capture
- **Camera Snapshots** - Request and view camera snapshots from devices in real-time
- **Alerts** - View, acknowledge, and resolve device alerts
- **Push Notifications** - Receive instant notifications for:
  - Trap triggered alerts
  - Device offline/online status
  - Low battery warnings
- **Notification Preferences** - Configure which notifications to receive and set quiet hours

## Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- Physical iOS or Android device for push notifications (simulator won't work)
- Expo Go app installed on your phone

## Setup

1. **Install dependencies:**
   ```bash
   cd mobile-app
   npm install
   ```

2. **Configure API URL:**
   Edit `src/services/api.ts` and update `API_BASE_URL`:
   ```typescript
   const API_BASE_URL = __DEV__
     ? 'http://YOUR_SERVER_IP:4000/api'  // Local development
     : 'https://your-production-server.com/api';
   ```

3. **Configure EAS (for push notifications):**
   ```bash
   # Install EAS CLI
   npm install -g eas-cli

   # Login to Expo
   eas login

   # Configure project
   eas build:configure
   ```

4. **Update app.json with your EAS project ID:**
   ```json
   {
     "expo": {
       "extra": {
         "eas": {
           "projectId": "your-eas-project-id"
         }
       }
     }
   }
   ```

## Running the App

### Development (Expo Go)
```bash
# Start development server
npm start

# Or with specific platform
npm run ios
npm run android
```

Scan the QR code with Expo Go on your phone.

### Development Build (for push notifications)
Push notifications require a development build:
```bash
# Build for iOS
eas build --profile development --platform ios

# Build for Android
eas build --profile development --platform android
```

## Project Structure

```
mobile-app/
├── App.tsx                 # App entry point
├── app.json               # Expo config
├── src/
│   ├── context/
│   │   └── AuthContext.tsx    # Auth state management
│   ├── navigation/
│   │   └── AppNavigator.tsx   # Tab navigation
│   ├── screens/
│   │   ├── LoginScreen.tsx       # Login form
│   │   ├── DevicesScreen.tsx     # Device list
│   │   ├── DeviceDetailScreen.tsx # Device details & snapshots
│   │   ├── AlertsScreen.tsx      # Alerts list
│   │   └── SettingsScreen.tsx    # Settings & preferences
│   ├── services/
│   │   ├── api.ts            # API client
│   │   └── notifications.ts  # Push notification handling
│   └── types/
│       └── index.ts          # TypeScript types
└── assets/                    # App icons and images
```

## API Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | User authentication |
| `/auth/profile` | GET | Get user profile |
| `/devices` | GET | List all devices |
| `/devices/:id` | GET | Get device details |
| `/devices/:id/request-snapshot` | POST | Request camera snapshot |
| `/alerts` | GET | List alerts |
| `/alerts/:id/acknowledge` | POST | Acknowledge alert |
| `/alerts/:id/resolve` | POST | Resolve alert |
| `/push/register-token` | POST | Register push token |
| `/push/token` | DELETE | Remove push token |
| `/push/preferences` | GET | Get notification prefs |
| `/push/preferences` | PUT | Update notification prefs |
| `/push/test` | POST | Send test notification |

## Push Notification Flow

1. On login/app start, app requests push notification permission
2. If granted, gets Expo Push Token from Expo's servers
3. Sends token to MouseTrap server (`POST /push/register-token`)
4. When device triggers alert, server sends push via Expo's push service
5. Notification appears on user's phone even when app is closed

## Building for Production

### iOS (TestFlight)
```bash
eas build --platform ios --profile production
eas submit --platform ios
```

### Android (Play Store)
```bash
eas build --platform android --profile production
eas submit --platform android
```

## Troubleshooting

### Push notifications not working
- Ensure you're testing on a physical device (not simulator)
- Check that notification permissions are granted in device settings
- Verify EAS project ID is configured in app.json
- Check server logs for push sending errors

### API connection failed
- Verify server is running and accessible
- Check API_BASE_URL in api.ts
- Ensure device is on same network as server (for local dev)

### TypeScript errors
```bash
# Check for type errors
npx tsc --noEmit
```
