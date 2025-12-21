import Foundation

struct Alert: Codable, Identifiable {
    let id: String
    let deviceId: String?
    let tenantId: String
    let tenantName: String?
    let type: String
    let severity: AlertSeverity
    let message: String
    let isAcknowledged: Bool
    let acknowledgedAt: Date?
    let acknowledgedBy: String?
    let isResolved: Bool
    let resolvedAt: Date?
    let resolvedBy: String?
    let resolvedNotes: String?
    let createdAt: Date

    // Joined device info
    let macAddress: String?
    let location: String?
    let deviceName: String?

    // Server returns camelCase, so no CodingKeys mapping needed for most fields
}

enum AlertSeverity: String, Codable {
    case low
    case medium
    case high
    case critical

    var color: String {
        switch self {
        case .low: return "blue"
        case .medium: return "yellow"
        case .high: return "orange"
        case .critical: return "red"
        }
    }

    var icon: String {
        switch self {
        case .low: return "info.circle"
        case .medium: return "exclamationmark.circle"
        case .high: return "exclamationmark.triangle"
        case .critical: return "exclamationmark.octagon"
        }
    }
}

struct AlertListResponse: Codable {
    let alerts: [Alert]
    let pagination: Pagination?
}

struct AcknowledgeAlertRequest: Codable {
    // Empty body - just POST to endpoint
}

struct ResolveAlertRequest: Codable {
    let notes: String?
}
