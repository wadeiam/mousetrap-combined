import SwiftUI

struct DeviceStatusList: View {
    let devices: [Device]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Section header
            HStack {
                Image(systemName: "sensor.fill")
                    .foregroundStyle(.blue)
                Text("Devices")
                    .font(.headline)
                Spacer()
                Text("\(devices.count)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)

            if devices.isEmpty {
                // Empty state
                VStack(spacing: 12) {
                    Image(systemName: "sensor.fill")
                        .font(.largeTitle)
                        .foregroundStyle(.tertiary)
                    Text("No devices")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            } else {
                // Device list - sorted: alerting first, then online, then offline
                VStack(spacing: 8) {
                    ForEach(sortedDevices) { device in
                        DeviceStatusRow(device: device)
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    private var sortedDevices: [Device] {
        devices.sorted { first, second in
            // Priority: alerting > online > offline > other
            let priority1 = statusPriority(first.status)
            let priority2 = statusPriority(second.status)

            if priority1 != priority2 {
                return priority1 < priority2
            }

            // Then sort by name
            return first.displayName.localizedCaseInsensitiveCompare(second.displayName) == .orderedAscending
        }
    }

    private func statusPriority(_ status: DeviceStatus) -> Int {
        switch status {
        case .alerting: return 0
        case .error: return 1
        case .online: return 2
        case .maintenance: return 3
        case .offline: return 4
        }
    }
}

#Preview {
    ScrollView {
        DeviceStatusList(devices: [
            Device(
                id: "1",
                mqttClientId: "ABC123",
                name: "Kitchen Trap",
                tenantId: "tenant-1",
                tenantName: nil,
                status: .online,
                location: "Kitchen",
                label: nil,
                firmwareVersion: "v2.0.59",
                filesystemVersion: nil,
                hardwareVersion: nil,
                lastSeen: Date(),
                uptime: 86400,
                rssi: -45,
                localIp: "192.168.1.100",
                macAddress: nil,
                online: true,
                paused: false,
                heapFree: nil,
                lastSnapshot: nil,
                lastSnapshotAt: nil
            ),
            Device(
                id: "2",
                mqttClientId: "DEF456",
                name: "Garage Trap",
                tenantId: "tenant-1",
                tenantName: nil,
                status: .offline,
                location: "Garage",
                label: nil,
                firmwareVersion: "v2.0.58",
                filesystemVersion: nil,
                hardwareVersion: nil,
                lastSeen: Date().addingTimeInterval(-7200),
                uptime: nil,
                rssi: nil,
                localIp: nil,
                macAddress: nil,
                online: false,
                paused: false,
                heapFree: nil,
                lastSnapshot: nil,
                lastSnapshotAt: nil
            )
        ])
    }
    .background(Color(.systemGray6))
}
