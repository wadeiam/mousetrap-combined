import SwiftUI

struct DeviceListView: View {
    @StateObject private var viewModel = DeviceListViewModel()
    @State private var searchText = ""
    @State private var selectedStatus: DeviceStatus?
    @State private var selectedType: DeviceType?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Filters
                VStack(spacing: 8) {
                    // Type Filter
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            FilterChip(
                                title: "All Types",
                                isSelected: selectedType == nil,
                                action: { selectedType = nil }
                            )

                            FilterChip(
                                title: "Traps",
                                icon: "sensor.fill",
                                isSelected: selectedType == .trap,
                                color: .orange,
                                action: { selectedType = .trap }
                            )

                            FilterChip(
                                title: "Scouts",
                                icon: "video.fill",
                                isSelected: selectedType == .scout,
                                color: .cyan,
                                action: { selectedType = .scout }
                            )
                        }
                        .padding(.horizontal)
                    }

                    // Status Filter
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            FilterChip(
                                title: "All Status",
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
                    }
                }
                .padding(.vertical, 8)
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

        // Filter by device type
        if let type = selectedType {
            devices = devices.filter {
                type == .trap ? $0.isTrap : $0.isScout
            }
        }

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
    var icon: String? = nil
    let isSelected: Bool
    var color: Color = .blue
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon = icon {
                    Image(systemName: icon)
                        .font(.caption2)
                }
                Text(title)
                    .font(.caption)
                    .fontWeight(.medium)
            }
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
            // Device type icon with status indicator
            ZStack(alignment: .bottomTrailing) {
                Image(systemName: device.typeIcon)
                    .font(.title2)
                    .foregroundStyle(device.isTrap ? .orange : .cyan)
                    .frame(width: 32, height: 32)

                Circle()
                    .fill(statusColor)
                    .frame(width: 10, height: 10)
                    .overlay(
                        Circle()
                            .stroke(Color(.systemBackground), lineWidth: 2)
                    )
                    .offset(x: 2, y: 2)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(device.displayName)
                    .font(.headline)

                HStack(spacing: 4) {
                    Text(device.isTrap ? "Trap" : "Scout")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(device.isTrap ? Color.orange.opacity(0.2) : Color.cyan.opacity(0.2))
                        .foregroundStyle(device.isTrap ? .orange : .cyan)
                        .clipShape(Capsule())

                    if let location = device.location {
                        Text(location)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
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
