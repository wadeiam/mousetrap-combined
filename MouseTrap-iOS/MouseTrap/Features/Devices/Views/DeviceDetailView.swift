import SwiftUI

struct DeviceDetailView: View {
    let device: Device
    @StateObject private var viewModel = DeviceDetailViewModel()
    @StateObject private var settingsViewModel = DeviceSettingsViewModel()
    @ObservedObject private var lanService = LANDiscoveryService.shared
    @State private var showingRebootConfirm = false
    @State private var showingSnapshot = false
    @State private var hasRequestedAutoCapture = false

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
                                let lanIcon = lanService.isReachable(deviceId: device.id) ? "network" : "network.slash"
                                Link(destination: URL(string: "http://\(ip)/app/")!) {
                                    StatItem(icon: lanIcon, value: ip, label: "IP")
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // LAN access banner for offline devices
                    if device.status != .online, lanService.isReachable(deviceId: device.id),
                       let ip = lanService.ip(for: device.id) {
                        Button {
                            if let url = URL(string: "http://\(ip)/app/") {
                                UIApplication.shared.open(url)
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "network")
                                    .font(.title3)
                                    .foregroundStyle(.blue)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Device Available on LAN")
                                        .font(.subheadline)
                                        .fontWeight(.semibold)
                                        .foregroundStyle(.primary)
                                    Text("Server is unreachable, but this device is accessible at \(ip)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                Spacer()

                                Image(systemName: "arrow.up.right.square")
                                    .foregroundStyle(.blue)
                            }
                            .padding()
                            .background(Color.blue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.blue.opacity(0.3), lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    } else if device.status != .online, let ip = device.localIp {
                        // Show IP even when offline (but not LAN reachable)
                        HStack(spacing: 20) {
                            let lanIcon = lanService.isReachable(deviceId: device.id) ? "network" : "network.slash"
                            Link(destination: URL(string: "http://\(ip)/app/")!) {
                                StatItem(icon: lanIcon, value: ip, label: "IP")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                // Snapshot Section
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        // Show "Alert Snapshot" if there's an active alert with snapshot
                        if let alert = device.activeAlert, alert.snapshot != nil {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.red)
                                Text("Alert Snapshot")
                                    .font(.headline)
                            }
                        } else {
                            Text("Latest Snapshot")
                                .font(.headline)
                        }
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

                    // Priority: 1. Alert snapshot, 2. ViewModel snapshot, 3. Device's lastSnapshot
                    if let alertSnapshot = device.activeAlert?.snapshot,
                       let imageData = Data(base64Encoded: alertSnapshot),
                       let uiImage = UIImage(data: imageData) {
                        // Show alert snapshot
                        VStack(spacing: 8) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(alignment: .topTrailing) {
                                    Text("ALERT")
                                        .font(.caption2)
                                        .fontWeight(.bold)
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(.red)
                                        .clipShape(Capsule())
                                        .padding(8)
                                }
                                .onTapGesture {
                                    showingSnapshot = true
                                }
                            if let snapshotAt = device.activeAlert?.snapshotAt {
                                Text(snapshotAt, style: .date) + Text(" at ") + Text(snapshotAt, style: .time)
                            } else if let triggeredAt = device.activeAlert?.triggeredAt {
                                Text(triggeredAt, style: .date) + Text(" at ") + Text(triggeredAt, style: .time)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    } else if let snapshot = viewModel.snapshot ?? device.lastSnapshot,
                       let imageData = Data(base64Encoded: snapshot),
                       let uiImage = UIImage(data: imageData) {
                        // Show latest snapshot
                        VStack(spacing: 8) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .onTapGesture {
                                    showingSnapshot = true
                                }
                            if let snapshotAt = viewModel.snapshotAt ?? device.lastSnapshotAt {
                                Text(snapshotAt, style: .date) + Text(" at ") + Text(snapshotAt, style: .time)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    } else {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(.systemGray5))
                            .aspectRatio(4/3, contentMode: .fit)
                            .overlay {
                                VStack {
                                    if viewModel.isRequestingSnapshot {
                                        ProgressView()
                                            .scaleEffect(1.5)
                                        Text("Capturing...")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .padding(.top, 8)
                                    } else {
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
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .onAppear {
                    // Auto-capture if: online, no alert snapshot, and no recent snapshot (>10s)
                    guard device.status == .online,
                          !hasRequestedAutoCapture,
                          device.activeAlert?.snapshot == nil else { return }

                    let needsCapture: Bool
                    if let snapshotAt = device.lastSnapshotAt {
                        // Capture if last snapshot is older than 10 seconds
                        needsCapture = Date().timeIntervalSince(snapshotAt) > 10
                    } else {
                        // No snapshot at all - capture
                        needsCapture = true
                    }

                    if needsCapture {
                        hasRequestedAutoCapture = true
                        Task {
                            await viewModel.requestSnapshot(deviceId: device.id)
                        }
                    }
                }

                // Device Settings Section
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Image(systemName: device.typeIcon)
                            .foregroundStyle(.blue)
                        Text("Device Settings")
                            .font(.headline)
                        Spacer()
                        Text(device.isTrap ? "Trap" : "Scout")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(device.isTrap ? Color.orange.opacity(0.2) : Color.cyan.opacity(0.2))
                            .foregroundStyle(device.isTrap ? .orange : .cyan)
                            .clipShape(Capsule())
                    }
                    .padding(.horizontal)
                    .padding(.top)

                    // Camera settings (all devices)
                    CameraSettingsSection(
                        deviceId: device.id,
                        isOnline: device.status == .online,
                        viewModel: settingsViewModel
                    )
                    .padding(.horizontal)

                    if device.isTrap {
                        // Calibration (trap only)
                        CalibrationSection(
                            deviceId: device.id,
                            isOnline: device.status == .online,
                            viewModel: settingsViewModel
                        )
                        .padding(.horizontal)

                        // Servo settings (trap only)
                        ServoSettingsSection(
                            deviceId: device.id,
                            isOnline: device.status == .online,
                            viewModel: settingsViewModel
                        )
                        .padding(.horizontal)
                    } else if device.isScout {
                        // Motion config (scout only)
                        MotionConfigSection(
                            deviceId: device.id,
                            isOnline: device.status == .online,
                            viewModel: settingsViewModel
                        )
                        .padding(.horizontal)
                    }
                }
                .padding(.bottom)
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

                    if let ip = device.localIp {
                        HStack {
                            Text("IP Address")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Link(destination: URL(string: "http://\(ip)/app/")!) {
                                HStack(spacing: 4) {
                                    Text(ip)
                                        .fontWeight(.medium)
                                    Image(systemName: "arrow.up.right.square")
                                        .font(.caption)
                                }
                            }
                        }
                        .font(.subheadline)
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

                    // Mute/Unmute offline alerts
                    Button {
                        Task {
                            await viewModel.toggleOfflineAlertsMuted(deviceId: device.id, currentlyMuted: device.isOfflineAlertsMuted)
                        }
                    } label: {
                        HStack {
                            Image(systemName: device.isOfflineAlertsMuted ? "bell.fill" : "bell.slash.fill")
                            Text(device.isOfflineAlertsMuted ? "Unmute Offline Alerts" : "Mute Offline Alerts")
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(device.isOfflineAlertsMuted ? Color.green.opacity(0.2) : Color(.systemGray5))
                        .foregroundStyle(device.isOfflineAlertsMuted ? .green : .primary)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    // Show mute status if muted
                    if device.isOfflineAlertsMuted {
                        HStack {
                            Image(systemName: "info.circle")
                                .foregroundStyle(.secondary)
                            if device.muteOfflinePermanently == true {
                                Text("Offline alerts permanently muted")
                            } else if let muteUntil = device.muteOfflineUntil {
                                Text("Muted until \(muteUntil, style: .date) \(muteUntil, style: .time)")
                            }
                            Spacer()
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
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
        .alert("Settings Applied", isPresented: .constant(settingsViewModel.successMessage != nil)) {
            Button("OK") {
                settingsViewModel.successMessage = nil
            }
        } message: {
            if let message = settingsViewModel.successMessage {
                Text(message)
            }
        }
    }

    private var statusColor: Color {
        switch device.status {
        case .online: return .green
        case .offline: return lanService.isReachable(deviceId: device.id) ? .blue : .gray
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
            lastSnapshotAt: nil,
            deviceType: .trap,
            activeAlert: nil,
            muteOfflinePermanently: nil,
            muteOfflineUntil: nil
        ))
    }
}
