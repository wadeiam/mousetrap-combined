import Foundation

class DashboardService {
    static let shared = DashboardService()

    private let apiClient = APIClient.shared

    private init() {}

    func getStats() async throws -> DashboardStats {
        struct Response: Codable {
            let success: Bool?
            let data: DashboardStats?
            // Flat response fields
            let totalDevices: Int?
            let onlineDevices: Int?
            let offlineDevices: Int?
            let alertingDevices: Int?
            let activeAlerts: Int?
            let criticalAlerts: Int?
            let recentAlerts: [Alert]?

            enum CodingKeys: String, CodingKey {
                case success, data
                case totalDevices = "total_devices"
                case onlineDevices = "online_devices"
                case offlineDevices = "offline_devices"
                case alertingDevices = "alerting_devices"
                case activeAlerts = "active_alerts"
                case criticalAlerts = "critical_alerts"
                case recentAlerts = "recent_alerts"
            }
        }

        let response: Response = try await apiClient.get(endpoint: .dashboardStats)

        if let data = response.data {
            return data
        }

        // Build from flat response
        return DashboardStats(
            totalDevices: response.totalDevices ?? 0,
            onlineDevices: response.onlineDevices ?? 0,
            offlineDevices: response.offlineDevices ?? 0,
            alertingDevices: response.alertingDevices ?? 0,
            activeAlerts: response.activeAlerts ?? 0,
            criticalAlerts: response.criticalAlerts ?? 0,
            recentAlerts: response.recentAlerts
        )
    }
}
