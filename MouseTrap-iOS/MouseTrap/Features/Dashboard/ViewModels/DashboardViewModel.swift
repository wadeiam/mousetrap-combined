import Foundation

@MainActor
class DashboardViewModel: ObservableObject {
    @Published var stats: DashboardStats?
    @Published var devices: [Device] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var dismissedOfflineDeviceIds: Set<String> = []

    private let apiClient = APIClient.shared
    private let dismissedDevicesKey = "DismissedOfflineDevices"

    init() {
        loadDismissedDevices()
    }

    // MARK: - Data Loading

    func loadData() async {
        isLoading = true
        error = nil

        // Load stats and devices in parallel
        async let statsTask: () = loadStats()
        async let devicesTask: () = loadDevices()

        await statsTask
        await devicesTask

        // Clear dismissals for devices that are now online
        cleanupDismissedDevices()

        isLoading = false
    }

    func loadStats() async {
        do {
            struct StatsResponse: Codable {
                let success: Bool?
                let data: DashboardStats?
                // Flat response fields (API returns camelCase)
                let totalDevices: Int?
                let onlineDevices: Int?
                let offlineDevices: Int?
                let alertingDevices: Int?
                let activeAlerts: Int?
                let criticalAlerts: Int?
                let recentAlerts: [Alert]?
            }

            let response: StatsResponse = try await apiClient.get(endpoint: .dashboardStats)
            print("[Dashboard] Stats response - data: \(response.data != nil), recentAlerts: \(response.data?.recentAlerts?.count ?? 0)")

            if let data = response.data {
                stats = data
            } else if let total = response.totalDevices {
                // Build from flat response
                stats = DashboardStats(
                    totalDevices: total,
                    onlineDevices: response.onlineDevices ?? 0,
                    offlineDevices: response.offlineDevices ?? 0,
                    alertingDevices: response.alertingDevices ?? 0,
                    activeAlerts: response.activeAlerts ?? 0,
                    criticalAlerts: response.criticalAlerts ?? 0,
                    recentAlerts: response.recentAlerts
                )
            }

        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadDevices() async {
        do {
            struct DevicesResponse: Codable {
                let success: Bool?
                let data: DeviceData?
                let devices: [Device]?

                struct DeviceData: Codable {
                    let items: [Device]?
                    let devices: [Device]?
                }
            }

            let response: DevicesResponse = try await apiClient.get(
                endpoint: .devices,
                queryItems: [
                    URLQueryItem(name: "page", value: "1"),
                    URLQueryItem(name: "limit", value: "100")
                ]
            )

            if let data = response.data {
                devices = data.items ?? data.devices ?? []
            } else if let deviceList = response.devices {
                devices = deviceList
            }

        } catch {
            // Don't overwrite error from stats - devices are secondary
            print("[Dashboard] Failed to load devices: \(error)")
        }
    }

    // MARK: - Alert Actions

    func acknowledgeAlert(id: String) async {
        do {
            let _: EmptyResponse = try await apiClient.post(
                endpoint: .acknowledgeAlert(id: id),
                body: EmptyBody()
            )

            // Refresh data to reflect the change
            await loadData()

        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = "Failed to acknowledge alert"
        }
    }

    func resolveAlert(id: String) async {
        do {
            let _: EmptyResponse = try await apiClient.post(
                endpoint: .resolveAlert(id: id),
                body: EmptyBody()
            )

            // Refresh data to reflect the change
            await loadData()

        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = "Failed to resolve alert"
        }
    }

    // MARK: - Offline Device Dismissal

    func dismissOfflineWarning(deviceId: String) {
        dismissedOfflineDeviceIds.insert(deviceId)
        saveDismissedDevices()
    }

    private func loadDismissedDevices() {
        if let data = UserDefaults.standard.data(forKey: dismissedDevicesKey),
           let ids = try? JSONDecoder().decode(Set<String>.self, from: data) {
            dismissedOfflineDeviceIds = ids
        }
    }

    private func saveDismissedDevices() {
        if let data = try? JSONEncoder().encode(dismissedOfflineDeviceIds) {
            UserDefaults.standard.set(data, forKey: dismissedDevicesKey)
        }
    }

    private func cleanupDismissedDevices() {
        // Remove dismissals for devices that are now online
        let onlineDeviceIds = Set(devices.filter { $0.status == .online }.map(\.id))
        let updatedDismissals = dismissedOfflineDeviceIds.subtracting(onlineDeviceIds)

        if updatedDismissals != dismissedOfflineDeviceIds {
            dismissedOfflineDeviceIds = updatedDismissals
            saveDismissedDevices()
        }
    }

    // MARK: - Computed Properties

    var activeAlerts: [Alert] {
        stats?.recentAlerts?.filter { !$0.isResolved } ?? []
    }

    var offlineDevices: [Device] {
        devices.filter { $0.status == .offline }
    }

    var hasActiveAlerts: Bool {
        !activeAlerts.isEmpty
    }

    var hasOfflineWarnings: Bool {
        let undismissedOffline = offlineDevices.filter { !dismissedOfflineDeviceIds.contains($0.id) }
        return !undismissedOffline.isEmpty
    }
}

// MARK: - Helper Types

private struct EmptyBody: Codable {}
