import SwiftUI

struct DeviceListView: View {
    @StateObject private var viewModel = DeviceListViewModel()
    @State private var searchText = ""
    @State private var selectedStatus: DeviceStatus?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Status Filter
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterChip(
                            title: "All",
                            isSelected: selectedStatus == nil,
                            action: { selectedStatus = nil }
                        )

                        FilterChip(
                            title: "Online",
                            isSelected: selectedStatus == .online,
                            color: .green,
                            action: { selectedStatus = .online }
                        )

                        FilterChip(
                            title: "Alerting",
                            isSelected: selectedStatus == .alerting,
                            color: .red,
                            action: { selectedStatus = .alerting }
                        )

                        FilterChip(
                            title: "Offline",
                            isSelected: selectedStatus == .offline,
                            color: .gray,
                            action: { selectedStatus = .offline }
                        )
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }
                .background(Color(.systemBackground))

                // Device List
                if viewModel.isLoading && viewModel.devices.isEmpty {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else if let error = viewModel.error {
                    ErrorView(
                        error: error,
                        retryAction: {
                            Task { await viewModel.loadDevices() }
                        }
                    )
                } else if filteredDevices.isEmpty {
                    EmptyStateView(
                        icon: "sensor.fill",
                        title: "No Devices",
                        message: "No devices match your search criteria"
                    )
                } else {
                    List {
                        ForEach(filteredDevices) { device in
                            NavigationLink(destination: DeviceDetailView(device: device)) {
                                DeviceRowView(device: device)
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Devices")
            .searchable(text: $searchText, prompt: "Search devices")
            .refreshable {
                await viewModel.loadDevices()
            }
            .task {
                await viewModel.loadDevices()
            }
        }
    }

    private var filteredDevices: [Device] {
        var devices = viewModel.devices

        // Filter by status
        if let status = selectedStatus {
            devices = devices.filter { $0.status == status }
        }

        // Filter by search text
        if !searchText.isEmpty {
            devices = devices.filter {
                $0.displayName.localizedCaseInsensitiveContains(searchText) ||
                ($0.location?.localizedCaseInsensitiveContains(searchText) ?? false) ||
                ($0.mqttClientId.localizedCaseInsensitiveContains(searchText))
            }
        }

        return devices
    }
}

struct FilterChip: View {
    let title: String
    let isSelected: Bool
    var color: Color = .blue
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption)
                .fontWeight(.medium)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? color : Color(.systemGray5))
                .foregroundStyle(isSelected ? .white : .primary)
                .clipShape(Capsule())
        }
    }
}

struct DeviceRowView: View {
    let device: Device

    var body: some View {
        HStack(spacing: 12) {
            // Status indicator
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 4) {
                Text(device.displayName)
                    .font(.headline)

                if let location = device.location {
                    Text(location)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            // Signal strength (show for online and alerting devices)
            if device.status == .online || device.status == .alerting {
                Image(systemName: device.signalStrength.icon)
                    .foregroundStyle(.secondary)
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch device.status {
        case .online: return .green
        case .offline: return .gray
        case .alerting: return .red
        case .error: return .red
        case .maintenance: return .orange
        }
    }
}

#Preview {
    DeviceListView()
        .environmentObject(AuthManager())
}
