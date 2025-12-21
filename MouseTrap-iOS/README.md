# MouseTrap iOS App

Native SwiftUI iPhone app for monitoring MouseTrap IoT devices.

## Setup Instructions

### 1. Create Xcode Project

1. Open Xcode
2. File → New → Project
3. Select "App" under iOS
4. Configure:
   - Product Name: `MouseTrap`
   - Team: Your Apple Developer Team
   - Organization Identifier: `com.yourdomain`
   - Interface: SwiftUI
   - Language: Swift
   - Storage: None
   - Uncheck "Include Tests" (can add later)
5. Save to `/Users/wadehargrove/Documents/MouseTrap/MouseTrap-iOS/`

### 2. Add Source Files

After creating the project:

1. Delete the default `ContentView.swift` and `MouseTrapApp.swift` that Xcode created
2. In Xcode, right-click on the MouseTrap folder → "Add Files to MouseTrap..."
3. Navigate to the `MouseTrap/` folder and select all folders:
   - App/
   - Core/
   - Features/
   - Services/
   - Navigation/
   - Components/
4. Make sure "Copy items if needed" is unchecked
5. Make sure "Create groups" is selected
6. Click "Add"

### 3. Add Socket.IO Dependency (Optional - for real-time updates)

1. File → Add Package Dependencies...
2. Enter: `https://github.com/socketio/socket.io-client-swift`
3. Select version: "Up to Next Major" from 16.0.0
4. Click "Add Package"

### 4. Configure Info.plist

Add these keys for push notifications and networking:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>remote-notification</string>
</array>
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

### 5. Update Server URL

Edit `MouseTrap/Core/Network/APIEndpoints.swift`:

```swift
static let baseURL = "http://YOUR_SERVER_IP:4000/api"
```

And `MouseTrap/Core/Network/WebSocketManager.swift`:

```swift
private let baseURL = "ws://YOUR_SERVER_IP:4000"
```

### 6. Build and Run

1. Select your iPhone or simulator
2. Press Cmd+R to build and run

## Project Structure

```
MouseTrap/
├── App/
│   └── MouseTrapApp.swift          # App entry point
├── Core/
│   ├── Network/
│   │   ├── APIClient.swift         # REST API client
│   │   ├── APIEndpoints.swift      # Endpoint definitions
│   │   ├── APIError.swift          # Error types
│   │   └── WebSocketManager.swift  # Real-time updates
│   ├── Storage/
│   │   └── KeychainService.swift   # Secure token storage
│   └── Models/
│       ├── User.swift
│       ├── Device.swift
│       ├── Alert.swift
│       └── DashboardStats.swift
├── Features/
│   ├── Authentication/
│   ├── Dashboard/
│   ├── Devices/
│   ├── Alerts/
│   └── Settings/
├── Services/
│   ├── AuthService.swift
│   └── AuthManager.swift
└── Navigation/
    └── MainTabView.swift
```

## Features

- [x] Email/password login with 2FA support
- [x] Dashboard with device stats
- [x] Device list with search/filter
- [x] Device detail with snapshot capture
- [x] Device controls (reboot, clear alerts, test alert)
- [x] Alerts list with acknowledge/resolve
- [x] Settings with tenant switching
- [x] Change password
- [x] Notification preferences
- [ ] Push notifications (requires APNS setup)
- [ ] Full Socket.IO integration (basic WebSocket included)

## Requirements

- iOS 16.0+
- Xcode 15.0+
- Swift 5.9+
- Apple Developer account (for device testing and App Store)

## Test Credentials

```
Email: admin@mastertenant.com
Password: Admin123!
```

## App Store Preparation

1. Create app icons (1024x1024 and all required sizes)
2. Design launch screen
3. Write privacy policy
4. Take screenshots for App Store
5. Create App Store Connect listing
6. Submit for review
