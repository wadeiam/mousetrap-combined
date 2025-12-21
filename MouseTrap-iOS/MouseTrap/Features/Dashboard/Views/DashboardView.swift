import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var authManager: AuthManager
    @StateObject private var viewModel = DashboardViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
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
                        AllClearBanner()
                    }

                    // 4. Device Status List (always shown)
                    DeviceStatusList(devices: viewModel.devices)
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
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.green.opacity(0.1))
        )
        .padding(.horizontal)
    }
}

#Preview {
    DashboardView()
        .environmentObject(AuthManager())
}
