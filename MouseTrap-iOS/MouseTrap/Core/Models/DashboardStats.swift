import Foundation

struct DashboardStats: Codable {
    let totalDevices: Int
    let onlineDevices: Int
    let offlineDevices: Int
    let alertingDevices: Int
    let activeAlerts: Int
    let criticalAlerts: Int
    let recentAlerts: [Alert]?

    // Scout-specific stats
    let scoutStats: ScoutStats?
    let recentMotionEvents: [MotionEvent]?

    // API returns camelCase - no CodingKeys needed
}

// MARK: - Scout Stats

struct ScoutStats: Codable {
    let total: Int
    let online: Int
}

// MARK: - Motion Event

struct MotionEvent: Codable, Identifiable {
    let id: String
    let classification: String
    let confidence: Double
    let classifiedAt: Date
    let deviceId: String
    let deviceName: String?
    let location: String?

    /// Icon name based on classification type
    var classificationIcon: String {
        switch classification.lowercased() {
        case "rodent", "mouse", "rat":
            return "ant.fill"
        case "pet", "cat", "dog":
            return "pawprint.fill"
        case "person", "human":
            return "person.fill"
        default:
            return "questionmark.circle"
        }
    }

    /// Color for the classification
    var classificationColor: String {
        switch classification.lowercased() {
        case "rodent", "mouse", "rat":
            return "red"
        case "pet", "cat", "dog":
            return "orange"
        case "person", "human":
            return "blue"
        default:
            return "gray"
        }
    }
}
