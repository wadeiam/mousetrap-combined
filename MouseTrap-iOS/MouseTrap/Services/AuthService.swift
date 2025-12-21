import Foundation

class AuthService {
    static let shared = AuthService()

    private let apiClient = APIClient.shared
    private let keychain = KeychainService.shared

    private init() {}

    // MARK: - Login

    func login(email: String, password: String, totpCode: String? = nil) async throws -> AuthResponse {
        let request = LoginRequest(email: email, password: password, totpCode: totpCode)

        struct LoginResponse: Codable {
            let success: Bool?
            let data: AuthResponseData?
            let accessToken: String?
            let refreshToken: String?
            let user: User?
            let error: String?
        }

        struct AuthResponseData: Codable {
            let accessToken: String
            let refreshToken: String
            let user: User
        }

        let response: LoginResponse = try await apiClient.post(
            endpoint: .login,
            body: request,
            requiresAuth: false
        )

        // Handle wrapped response format
        if let data = response.data {
            let authResponse = AuthResponse(
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                user: data.user
            )
            saveTokens(authResponse)
            return authResponse
        }

        // Handle flat response format
        if let accessToken = response.accessToken,
           let refreshToken = response.refreshToken,
           let user = response.user {
            let authResponse = AuthResponse(
                accessToken: accessToken,
                refreshToken: refreshToken,
                user: user
            )
            saveTokens(authResponse)
            return authResponse
        }

        throw APIError.invalidResponse
    }

    // MARK: - Refresh Token

    func refreshToken() async throws -> String {
        guard let refreshToken = keychain.getRefreshToken() else {
            throw APIError.unauthorized
        }

        let request = RefreshTokenRequest(refreshToken: refreshToken)

        struct RefreshResponse: Codable {
            let success: Bool?
            let data: RefreshData?
            let accessToken: String?
        }

        struct RefreshData: Codable {
            let accessToken: String
        }

        let response: RefreshResponse = try await apiClient.post(
            endpoint: .refreshToken,
            body: request,
            requiresAuth: false
        )

        let newToken: String
        if let data = response.data {
            newToken = data.accessToken
        } else if let token = response.accessToken {
            newToken = token
        } else {
            throw APIError.invalidResponse
        }

        keychain.saveAccessToken(newToken)
        return newToken
    }

    // MARK: - Switch Tenant

    func switchTenant(tenantId: String) async throws -> String {
        let request = SwitchTenantRequest(tenantId: tenantId)

        struct SwitchResponse: Codable {
            let success: Bool?
            let data: SwitchData?
            let accessToken: String?
        }

        struct SwitchData: Codable {
            let accessToken: String
        }

        let response: SwitchResponse = try await apiClient.post(
            endpoint: .switchTenant,
            body: request
        )

        let newToken: String
        if let data = response.data {
            newToken = data.accessToken
        } else if let token = response.accessToken {
            newToken = token
        } else {
            throw APIError.invalidResponse
        }

        keychain.saveAccessToken(newToken)
        keychain.saveCurrentTenantId(tenantId)
        return newToken
    }

    // MARK: - Get Current User

    func getCurrentUser() async throws -> User {
        struct MeResponse: Codable {
            let success: Bool?
            let data: User?
            let user: User?
        }

        let response: MeResponse = try await apiClient.get(endpoint: .me)

        if let user = response.data ?? response.user {
            return user
        }

        throw APIError.invalidResponse
    }

    // MARK: - Change Password

    func changePassword(currentPassword: String, newPassword: String) async throws {
        struct ChangePasswordRequest: Codable {
            let currentPassword: String
            let newPassword: String
        }

        let request = ChangePasswordRequest(
            currentPassword: currentPassword,
            newPassword: newPassword
        )

        let _: EmptyResponse = try await apiClient.patch(
            endpoint: .changePassword,
            body: request
        )
    }

    // MARK: - Logout

    func logout() {
        keychain.clearAll()
    }

    // MARK: - Check Auth Status

    var isAuthenticated: Bool {
        return keychain.getAccessToken() != nil
    }

    // MARK: - Private Helpers

    private func saveTokens(_ response: AuthResponse) {
        keychain.saveAccessToken(response.accessToken)
        keychain.saveRefreshToken(response.refreshToken)
        keychain.saveUserId(response.user.id)

        // Save first tenant as current if available
        if let firstTenant = response.user.tenants.first {
            keychain.saveCurrentTenantId(firstTenant.tenantId)
        }
    }
}
