import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var socketManager: SocketIOManager
    @StateObject private var viewModel = DashboardViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // 0. Server Connectivity Warning (CRITICAL - shows first)
                    if socketManager.serverUnreachable {
                        ServerConnectivityBanner(
                            lastAttempt: socketManager.lastConnectionAttempt,
                            lanReachableCount: LANDiscoveryService.shared.lanReachableCount,
                            onRetry: {
                                if let tenantId = authManager.currentTenant?.tenantId {
                                    socketManager.disconnect()
                                    socketManager.connect(tenantId: tenantId)
                                }
                            }
                        )
                    }

                    // 0b. Cached data banner
                    if viewModel.isUsingCachedData {
                        CachedDataBanner(cacheAge: viewModel.cacheAge)
                    }

                    // Tenant Name (right-aligned)
                    if let tenant = authManager.currentTenant {
                        HStack {
                            Spacer()
                            Text(tenant.tenantName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal)
                    }

                    // 1. Alert Hero Section (if alerts exist)
                    if viewModel.hasActiveAlerts {
                        AlertHeroSection(
                            alerts: viewModel.activeAlerts,
                            onAcknowledge: { id in
                                await viewModel.acknowledgeAlert(id: id)
                            },
                            onResolve: { id in
                                await viewModel.resolveAlert(id: id)
                            }
                        )
                    }

                    // 2. Offline Warnings Section (if any undismissed)
                    OfflineWarningSection(
                        devices: viewModel.devices,
                        dismissedDeviceIds: viewModel.dismissedOfflineDeviceIds,
                        onDismiss: { deviceId in
                            viewModel.dismissOfflineWarning(deviceId: deviceId)
                        }
                    )

                    // 3. All Clear Message (when no alerts and no warnings)
                    if !viewModel.hasActiveAlerts && !viewModel.hasOfflineWarnings && viewModel.stats != nil {
                        AllClearBanner(isConnected: socketManager.isConnected)
                    }

                    // 4. Device Status List (always shown)
                    DeviceStatusList(devices: viewModel.devices)

                    // 5. Scout Activity Section (if scouts exist)
                    if let scoutStats = viewModel.stats?.scoutStats, scoutStats.total > 0 {
                        ScoutActivitySection(
                            scoutStats: scoutStats,
                            recentEvents: viewModel.stats?.recentMotionEvents ?? []
                        )
                    }
                }
                .padding(.vertical)
            }
            .background(Color(.systemGray6))
            .navigationTitle("Dashboard")
            .refreshable {
                await viewModel.loadData()
            }
            .task {
                await viewModel.loadData()
            }
            .overlay {
                if viewModel.isLoading && viewModel.stats == nil {
                    ProgressView()
                }
            }
            .alert("Error", isPresented: .constant(viewModel.error != nil)) {
                Button("OK") {
                    viewModel.error = nil
                }
            } message: {
                if let error = viewModel.error {
                    Text(error)
                }
            }
        }
    }
}

// MARK: - Supporting Views

struct AllClearBanner: View {
    var isConnected: Bool = true

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.title2)
                .foregroundStyle(.green)

            VStack(alignment: .leading, spacing: 2) {
                Text("All Clear")
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Text("No active alerts")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Connection indicator
            HStack(spacing: 4) {
                Circle()
                    .fill(isConnected ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                Text(isConnected ? "Live" : "Reconnecting...")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.green.opacity(0.1))
        )
        .padding(.horizontal)
    }
}

struct CachedDataBanner: View {
    let cacheAge: TimeInterval?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.subheadline)
                .foregroundStyle(.orange)

            VStack(alignment: .leading, spacing: 2) {
                Text("Showing cached data")
                    .font(.caption)
                    .fontWeight(.semibold)

                if let age = cacheAge {
                    Text("Last updated \(formatAge(age))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.orange.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                )
        )
        .padding(.horizontal)
    }

    private func formatAge(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds) / 60
        let hours = minutes / 60
        let days = hours / 24

        if days > 0 { return "\(days)d ago" }
        if hours > 0 { return "\(hours)h ago" }
        if minutes > 0 { return "\(minutes)m ago" }
        return "just now"
    }
}

#Preview {
    DashboardView()
        .environmentObject(AuthManager())
}
