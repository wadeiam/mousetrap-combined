import SwiftUI

@main
struct MouseTrapApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @StateObject private var authManager = AuthManager()
    @StateObject private var socketManager = SocketIOManager.shared
    @StateObject private var pushService = PushNotificationService.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authManager)
                .environmentObject(socketManager)
                .environmentObject(pushService)
                .onReceive(NotificationCenter.default.publisher(for: .didTapAlertNotification)) { notification in
                    // Handle alert notification tap - could navigate to alerts tab
                    if let alertId = notification.userInfo?["alertId"] as? String {
                        print("Navigate to alert: \(alertId)")
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .didTapDeviceNotification)) { notification in
                    // Handle device notification tap
                    if let deviceId = notification.userInfo?["deviceId"] as? String {
                        print("Navigate to device: \(deviceId)")
                    }
                }
                .onChange(of: authManager.isAuthenticated) { isAuthenticated in
                    if isAuthenticated {
                        // Connect WebSocket and register push on login
                        if let tenantId = authManager.currentTenant?.tenantId {
                            socketManager.connect(tenantId: tenantId)
                        }
                        Task {
                            await pushService.onLogin()
                        }
                    } else {
                        // Disconnect on logout
                        socketManager.disconnect()
                        Task {
                            await pushService.onLogout()
                        }
                    }
                }
                .onChange(of: authManager.currentTenant?.tenantId) { newTenantId in
                    // Switch WebSocket room when tenant changes
                    if let tenantId = newTenantId {
                        socketManager.switchTenant(tenantId)
                    }
                }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var authManager: AuthManager

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut, value: authManager.isAuthenticated)
    }
}
