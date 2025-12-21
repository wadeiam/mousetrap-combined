import SwiftUI

extension Color {
    // MARK: - App Colors

    static let appPrimary = Color.blue
    static let appSecondary = Color(.systemGray)

    // MARK: - Status Colors

    static let statusOnline = Color.green
    static let statusOffline = Color(.systemGray)
    static let statusError = Color.red
    static let statusWarning = Color.orange
    static let statusMaintenance = Color.yellow

    // MARK: - Alert Severity Colors

    static let severityCritical = Color.red
    static let severityHigh = Color.orange
    static let severityMedium = Color.yellow
    static let severityLow = Color.blue

    // MARK: - Background Colors

    static let cardBackground = Color(.systemBackground)
    static let groupedBackground = Color(.systemGroupedBackground)
    static let secondaryBackground = Color(.secondarySystemBackground)

    // MARK: - Semantic Colors

    static let success = Color.green
    static let warning = Color.orange
    static let danger = Color.red
    static let info = Color.blue
}

// MARK: - Color for Device Status

extension DeviceStatus {
    var displayColor: Color {
        switch self {
        case .online: return .statusOnline
        case .offline: return .statusOffline
        case .alerting: return .statusError
        case .error: return .statusError
        case .maintenance: return .statusMaintenance
        }
    }
}

// MARK: - Color for Alert Severity

extension AlertSeverity {
    var displayColor: Color {
        switch self {
        case .critical: return .severityCritical
        case .high: return .severityHigh
        case .medium: return .severityMedium
        case .low: return .severityLow
        }
    }
}
