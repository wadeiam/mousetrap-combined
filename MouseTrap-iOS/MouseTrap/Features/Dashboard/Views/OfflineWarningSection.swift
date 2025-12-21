import SwiftUI

struct OfflineWarningSection: View {
    let devices: [Device]
    let dismissedDeviceIds: Set<String>
    let onDismiss: (String) -> Void

    private var visibleOfflineDevices: [Device] {
        devices.filter { device in
            device.status == .offline && !dismissedDeviceIds.contains(device.id)
        }
    }

    var body: some View {
        if !visibleOfflineDevices.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                // Section header
                HStack {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.orange)
                    Text("\(visibleOfflineDevices.count) Device\(visibleOfflineDevices.count == 1 ? "" : "s") Offline")
                        .font(.headline)
                    Spacer()
                }
                .padding(.horizontal)

                // Warning cards
                VStack(spacing: 8) {
                    ForEach(visibleOfflineDevices) { device in
                        OfflineWarningCard(
                            device: device,
                            onDismiss: { onDismiss(device.id) }
                        )
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.orange.opacity(0.08))
            )
            .padding(.horizontal)
        }
    }
}

struct OfflineWarningCard: View {
    let device: Device
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "wifi.slash")
                .font(.title3)
                .foregroundStyle(.orange)

            VStack(alignment: .leading, spacing: 2) {
                Text(device.displayName)
                    .font(.subheadline)
                    .fontWeight(.medium)

                if let lastSeen = device.lastSeen {
                    Text("Last seen \(lastSeen, style: .relative)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Offline")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            // Dismiss button
            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
                    .padding(8)
                    .background(Color(.systemGray5))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
        .padding()
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.orange.opacity(0.3), lineWidth: 1)
        )
    }
}

#Preview {
    VStack {
        OfflineWarningSection(
            devices: [
                Device(
                    id: "1",
                    mqttClientId: "ABC123",
                    name: "Basement Trap",
                    tenantId: "tenant-1",
                    tenantName: nil,
                    status: .offline,
                    location: "Basement",
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
                ),
                Device(
                    id: "2",
                    mqttClientId: "DEF456",
                    name: "Attic Trap",
                    tenantId: "tenant-1",
                    tenantName: nil,
                    status: .offline,
                    location: "Attic",
                    label: nil,
                    firmwareVersion: "v2.0.58",
                    filesystemVersion: nil,
                    hardwareVersion: nil,
                    lastSeen: Date().addingTimeInterval(-86400),
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
            ],
            dismissedDeviceIds: [],
            onDismiss: { _ in }
        )
    }
    .background(Color(.systemGray6))
}
