import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var socketManager: SocketIOManager
    @State private var selectedTab = 0

    // Badge counts from real-time updates
    @State private var alertBadge = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "square.grid.2x2")
                }
                .tag(0)

            DeviceListView()
                .tabItem {
                    Label("Devices", systemImage: "sensor.fill")
                }
                .tag(1)

            AlertsListView()
                .tabItem {
                    Label("Alerts", systemImage: "bell.fill")
                }
                .tag(2)
                .badge(alertBadge > 0 ? alertBadge : 0)

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(3)
        }
        .onChange(of: socketManager.lastAlert) { newAlert in
            if newAlert != nil {
                // New alert received - increment badge
                HapticFeedback.warning.trigger()
                if selectedTab != 2 {
                    alertBadge += 1
                }
            }
        }
        .onChange(of: selectedTab) { newTab in
            if newTab == 2 {
                // Clear badge when viewing alerts
                alertBadge = 0
            }
        }
    }
}

#Preview {
    MainTabView()
        .environmentObject(AuthManager())
        .environmentObject(SocketIOManager.shared)
}
