import Foundation

struct DashboardStats: Codable {
    let totalDevices: Int
    let onlineDevices: Int
    let offlineDevices: Int
    let alertingDevices: Int
    let activeAlerts: Int
    let criticalAlerts: Int
    let recentAlerts: [Alert]?

    // API returns camelCase - no CodingKeys needed
}
