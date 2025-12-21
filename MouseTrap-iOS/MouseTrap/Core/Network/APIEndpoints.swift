import Foundation

enum APIEndpoint {
    // Base URL - change this for production
    static let baseURL = "http://192.168.133.110:4000/api"

    // Auth
    case login
    case refreshToken
    case switchTenant
    case me
    case twoFactorSetup
    case twoFactorVerify
    case twoFactorDisable
    case changePassword

    // Dashboard
    case dashboardStats

    // Devices
    case devices
    case device(id: String)
    case requestSnapshot(deviceId: String)
    case rebootDevice(deviceId: String)
    case firmwareUpdate(deviceId: String)
    case clearAlerts(deviceId: String)
    case testAlert(deviceId: String)

    // Alerts
    case alerts
    case acknowledgeAlert(id: String)
    case resolveAlert(id: String)

    // Push Notifications
    case registerPushToken
    case removePushToken
    case notificationPreferences
    case testNotification

    // Emergency Contacts
    case emergencyContacts
    case emergencyContact(id: String)

    // Users
    case userProfile
    case userTenants

    var path: String {
        switch self {
        // Auth
        case .login: return "/auth/login"
        case .refreshToken: return "/auth/refresh"
        case .switchTenant: return "/auth/switch-tenant"
        case .me: return "/auth/me"
        case .twoFactorSetup: return "/auth/2fa/setup"
        case .twoFactorVerify: return "/auth/2fa/verify"
        case .twoFactorDisable: return "/auth/2fa/disable"
        case .changePassword: return "/auth/change-password"

        // Dashboard
        case .dashboardStats: return "/dashboard/stats"

        // Devices
        case .devices: return "/devices"
        case .device(let id): return "/devices/\(id)"
        case .requestSnapshot(let id): return "/devices/\(id)/request-snapshot"
        case .rebootDevice(let id): return "/devices/\(id)/reboot"
        case .firmwareUpdate(let id): return "/devices/\(id)/firmware-update"
        case .clearAlerts(let id): return "/devices/\(id)/clear-alerts"
        case .testAlert(let id): return "/devices/\(id)/test-alert"

        // Alerts
        case .alerts: return "/alerts"
        case .acknowledgeAlert(let id): return "/alerts/\(id)/acknowledge"
        case .resolveAlert(let id): return "/alerts/\(id)/resolve"

        // Push
        case .registerPushToken: return "/push/register-token"
        case .removePushToken: return "/push/token"
        case .notificationPreferences: return "/push/preferences"
        case .testNotification: return "/push/test"

        // Emergency Contacts
        case .emergencyContacts: return "/push/emergency-contacts"
        case .emergencyContact(let id): return "/push/emergency-contacts/\(id)"

        // Users
        case .userProfile: return "/users/me"
        case .userTenants: return "/users/me/tenants"
        }
    }

    var url: URL {
        URL(string: APIEndpoint.baseURL + path)!
    }
}
