import SwiftUI

struct DeviceStatusRow: View {
    let device: Device

    var body: some View {
        NavigationLink(destination: DeviceDetailView(device: device)) {
            HStack(spacing: 12) {
                // Status indicator
                Circle()
                    .fill(statusColor)
                    .frame(width: 10, height: 10)

                // Device info
                VStack(alignment: .leading, spacing: 2) {
                    Text(device.displayName)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(.primary)

                    HStack(spacing: 8) {
                        Text(statusText)
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if let uptime = device.uptime, device.status == .online {
                            Text(formatUptime(uptime))
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                Spacer()

                // Signal strength (if online)
                if device.status == .online, let rssi = device.rssi {
                    HStack(spacing: 4) {
                        Image(systemName: signalIcon(rssi: rssi))
                            .font(.caption)
                            .foregroundStyle(signalColor(rssi: rssi))
                        Text("\(rssi) dBm")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 16)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.03), radius: 4, x: 0, y: 2)
        }
        .buttonStyle(.plain)
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

    private var statusText: String {
        switch device.status {
        case .online: return "Online"
        case .offline:
            if let lastSeen = device.lastSeen {
                return "Last seen \(formatRelativeTime(lastSeen))"
            }
            return "Offline"
        case .alerting: return "Alert Active"
        case .error: return "Error"
        case .maintenance: return "Maintenance"
        }
    }

    private func formatRelativeTime(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func formatUptime(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let days = hours / 24

        if days > 0 {
            return "\(days)d uptime"
        } else if hours > 0 {
            return "\(hours)h uptime"
        } else {
            let minutes = seconds / 60
            return "\(minutes)m uptime"
        }
    }

    private func signalIcon(rssi: Int) -> String {
        switch rssi {
        case -50...0: return "wifi"
        case -60..<(-50): return "wifi"
        case -70..<(-60): return "wifi.exclamationmark"
        default: return "wifi.slash"
        }
    }

    private func signalColor(rssi: Int) -> Color {
        switch rssi {
        case -50...0: return .green
        case -60..<(-50): return .green
        case -70..<(-60): return .orange
        default: return .red
        }
    }
}

#Preview {
    VStack {
        DeviceStatusRow(device: Device(
            id: "1",
            mqttClientId: "ABC123",
            name: "Kitchen Trap",
            tenantId: "tenant-1",
            tenantName: "Demo Tenant",
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
        ))

        DeviceStatusRow(device: Device(
            id: "2",
            mqttClientId: "DEF456",
            name: "Garage Trap",
            tenantId: "tenant-1",
            tenantName: "Demo Tenant",
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
        ))
    }
    .padding()
    .background(Color(.systemGray6))
}
