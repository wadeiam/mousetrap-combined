import Foundation

struct User: Codable, Identifiable {
    let id: String
    let email: String
    var twoFactorEnabled: Bool
    var tenants: [TenantMembership]

    enum CodingKeys: String, CodingKey {
        case id, email
        case twoFactorEnabled = "twoFactorEnabled"
        case tenants
    }
}

struct TenantMembership: Codable, Identifiable, Hashable {
    let tenantId: String
    let tenantName: String
    let role: UserRole
    let deviceCount: String?

    var id: String { tenantId }

    enum CodingKeys: String, CodingKey {
        case tenantId = "tenant_id"
        case tenantName = "tenant_name"
        case role
        case deviceCount = "device_count"
    }
}

enum UserRole: String, Codable {
    case superadmin
    case admin
    case user
    case viewer

    var displayName: String {
        switch self {
        case .superadmin: return "Super Admin"
        case .admin: return "Admin"
        case .user: return "User"
        case .viewer: return "Viewer"
        }
    }
}

struct AuthResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let user: User
}

struct APIResponse<T: Codable>: Codable {
    let success: Bool
    let data: T?
    let error: String?
}

struct LoginRequest: Codable {
    let email: String
    let password: String
    let totpCode: String?
}

struct RefreshTokenRequest: Codable {
    let refreshToken: String
}

struct SwitchTenantRequest: Codable {
    let tenantId: String
}
