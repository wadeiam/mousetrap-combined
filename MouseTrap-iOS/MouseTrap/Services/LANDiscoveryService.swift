import Foundation

struct LANDeviceStatus {
    let isReachable: Bool
    let lastChecked: Date
    let ip: String
}

@MainActor
class LANDiscoveryService: ObservableObject {
    static let shared = LANDiscoveryService()

    @Published var deviceStatus: [String: LANDeviceStatus] = [:]

    private var devices: [Device] = []
    private var timer: Timer?
    private let checkInterval: TimeInterval = 30

    private init() {}

    // MARK: - Monitoring

    func startMonitoring(devices: [Device]) {
        self.devices = devices
        stopMonitoring()

        // Initial check
        Task { await checkAllDevices() }

        // Periodic checks
        timer = Timer.scheduledTimer(withTimeInterval: checkInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.checkAllDevices()
            }
        }
    }

    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
    }

    func updateDevices(_ devices: [Device]) {
        self.devices = devices
        Task { await checkAllDevices() }
    }

    func checkAllDevices() async {
        let devicesToCheck = devices.filter { $0.localIp != nil }
        guard !devicesToCheck.isEmpty else { return }

        await withTaskGroup(of: (String, LANDeviceStatus).self) { group in
            for device in devicesToCheck {
                guard let ip = device.localIp else { continue }
                group.addTask {
                    let reachable = await self.checkDevice(ip: ip)
                    return (device.id, LANDeviceStatus(
                        isReachable: reachable,
                        lastChecked: Date(),
                        ip: ip
                    ))
                }
            }

            for await (deviceId, status) in group {
                deviceStatus[deviceId] = status
            }
        }
    }

    // MARK: - Convenience

    func isReachable(deviceId: String) -> Bool {
        deviceStatus[deviceId]?.isReachable ?? false
    }

    func ip(for deviceId: String) -> String? {
        deviceStatus[deviceId]?.ip
    }

    // MARK: - Private

    private nonisolated func checkDevice(ip: String) async -> Bool {
        guard let url = URL(string: "http://\(ip)/healthz") else { return false }

        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        request.httpMethod = "GET"

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode == 200
            }
            return false
        } catch {
            return false
        }
    }

    var lanReachableCount: Int {
        deviceStatus.values.filter(\.isReachable).count
    }
}
