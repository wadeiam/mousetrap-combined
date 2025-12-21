import SwiftUI

struct DeviceDetailView: View {
    let device: Device
    @StateObject private var viewModel = DeviceDetailViewModel()
    @State private var showingRebootConfirm = false
    @State private var showingSnapshot = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Status Card
                VStack(spacing: 16) {
                    HStack {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 12, height: 12)
                        Text(device.status.rawValue.capitalized)
                            .font(.headline)
                        Spacer()
                        if let lastSeen = device.lastSeen {
                            Text("Last seen: \(lastSeen, style: .relative)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if device.status == .online {
                        HStack(spacing: 20) {
                            if let rssi = device.rssi {
                                StatItem(icon: "wifi", value: "\(rssi) dBm", label: "Signal")
                            }
                            if let uptime = device.uptime {
                                StatItem(icon: "clock", value: formatUptime(uptime), label: "Uptime")
                            }
                            if let ip = device.localIp {
                                StatItem(icon: "network", value: ip, label: "IP")
                            }
                        }
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                // Snapshot Section
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Latest Snapshot")
                            .font(.headline)
                        Spacer()
                        if device.status == .online {
                            Button {
                                Task {
                                    await viewModel.requestSnapshot(deviceId: device.id)
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    if viewModel.isRequestingSnapshot {
                                        ProgressView()
                                            .scaleEffect(0.8)
                                    } else {
                                        Image(systemName: "camera")
                                    }
                                    Text("Capture")
                                }
                                .font(.caption)
                            }
                            .disabled(viewModel.isRequestingSnapshot)
                        }
                    }

                    if let snapshot = viewModel.snapshot ?? device.lastSnapshot,
                       let imageData = Data(base64Encoded: snapshot),
                       let uiImage = UIImage(data: imageData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .onTapGesture {
                                showingSnapshot = true
                            }
                    } else {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(.systemGray5))
                            .aspectRatio(4/3, contentMode: .fit)
                            .overlay {
                                VStack {
                                    Image(systemName: "photo")
                                        .font(.largeTitle)
                                        .foregroundStyle(.secondary)
                                    Text("No snapshot available")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                // Device Info
                VStack(alignment: .leading, spacing: 12) {
                    Text("Device Information")
                        .font(.headline)

                    InfoRow(label: "Device ID", value: device.mqttClientId)

                    if let mac = device.macAddress {
                        InfoRow(label: "MAC Address", value: mac)
                    }

                    if let firmware = device.firmwareVersion {
                        InfoRow(label: "Firmware", value: firmware)
                    }

                    if let location = device.location {
                        InfoRow(label: "Location", value: location)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                // Actions
                VStack(spacing: 12) {
                    if device.status == .online {
                        Button {
                            showingRebootConfirm = true
                        } label: {
                            HStack {
                                Image(systemName: "arrow.clockwise")
                                Text("Reboot Device")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.orange)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }

                        Button {
                            Task {
                                await viewModel.clearAlerts(deviceId: device.id)
                            }
                        } label: {
                            HStack {
                                Image(systemName: "bell.slash")
                                Text("Clear Alert")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color(.systemGray5))
                            .foregroundStyle(.primary)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }

                    Button {
                        Task {
                            await viewModel.testAlert(deviceId: device.id)
                        }
                    } label: {
                        HStack {
                            Image(systemName: "bell.badge")
                            Text("Send Test Alert")
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color(.systemGray5))
                        .foregroundStyle(.primary)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
            .padding()
        }
        .navigationTitle(device.displayName)
        .navigationBarTitleDisplayMode(.large)
        .alert("Reboot Device?", isPresented: $showingRebootConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Reboot", role: .destructive) {
                Task {
                    await viewModel.rebootDevice(deviceId: device.id)
                }
            }
        } message: {
            Text("The device will restart and be offline briefly.")
        }
        .alert("Success", isPresented: .constant(viewModel.successMessage != nil)) {
            Button("OK") {
                viewModel.successMessage = nil
            }
        } message: {
            if let message = viewModel.successMessage {
                Text(message)
            }
        }
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

    private func formatUptime(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 24 {
            let days = hours / 24
            return "\(days)d"
        } else if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else {
            return "\(minutes)m"
        }
    }
}

struct StatItem: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .fontWeight(.medium)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
        .font(.subheadline)
    }
}

#Preview {
    NavigationStack {
        DeviceDetailView(device: Device(
            id: "1",
            mqttClientId: "ABC123",
            name: "Kitchen Trap",
            tenantId: "tenant-1",
            tenantName: "Demo Tenant",
            status: .online,
            location: "Kitchen",
            label: nil,
            firmwareVersion: "v2.0.59",
            filesystemVersion: "v2.0.58",
            hardwareVersion: "v1.0",
            lastSeen: Date(),
            uptime: 3600,
            rssi: -55,
            localIp: "192.168.1.100",
            macAddress: "AA:BB:CC:DD:EE:FF",
            online: true,
            paused: false,
            heapFree: 150000,
            lastSnapshot: nil,
            lastSnapshotAt: nil
        ))
    }
}
