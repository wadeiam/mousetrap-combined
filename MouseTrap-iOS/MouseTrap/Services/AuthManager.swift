import Foundation
import Combine

@MainActor
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var currentTenant: TenantMembership?
    @Published var isLoading = false
    @Published var error: String?

    private let authService = AuthService.shared
    private let keychain = KeychainService.shared

    init() {
        // Check if we have a valid token on launch
        checkAuthStatus()
    }

    // MARK: - Public Methods

    func login(email: String, password: String, totpCode: String? = nil) async {
        isLoading = true
        error = nil

        do {
            let response = try await authService.login(
                email: email,
                password: password,
                totpCode: totpCode
            )

            currentUser = response.user
            currentTenant = response.user.tenants.first
            isAuthenticated = true

        } catch APIError.twoFactorRequired {
            error = "2FA_REQUIRED"
        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func logout() {
        authService.logout()
        currentUser = nil
        currentTenant = nil
        isAuthenticated = false
        error = nil
    }

    func switchTenant(_ tenant: TenantMembership) async {
        isLoading = true
        error = nil

        do {
            _ = try await authService.switchTenant(tenantId: tenant.tenantId)

            // Preserve the original tenants list since /me may not return all tenants
            // for superadmins (the login endpoint has special superadmin logic)
            let originalTenants = currentUser?.tenants ?? []

            currentTenant = tenant

            // Refresh user data for new tenant context
            let user = try await authService.getCurrentUser()

            // Preserve original tenants list if it was larger
            // (superadmins see all tenants on login but /me only returns explicit memberships)
            if originalTenants.count > user.tenants.count {
                currentUser = User(
                    id: user.id,
                    email: user.email,
                    twoFactorEnabled: user.twoFactorEnabled,
                    tenants: originalTenants
                )
            } else {
                currentUser = user
            }

        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func refreshUserData() async {
        do {
            let user = try await authService.getCurrentUser()
            currentUser = user
        } catch {
            // If refresh fails with auth error, log out
            if let apiError = error as? APIError, apiError.isAuthError {
                logout()
            }
        }
    }

    func changePassword(currentPassword: String, newPassword: String) async throws {
        try await authService.changePassword(
            currentPassword: currentPassword,
            newPassword: newPassword
        )
    }

    // MARK: - Private Methods

    private func checkAuthStatus() {
        guard keychain.getAccessToken() != nil else {
            isAuthenticated = false
            return
        }

        // We have a token, try to fetch user data
        isAuthenticated = true

        Task {
            await refreshUserData()

            // Restore current tenant from keychain
            if let tenantId = keychain.getCurrentTenantId(),
               let tenant = currentUser?.tenants.first(where: { $0.tenantId == tenantId }) {
                currentTenant = tenant
            } else {
                currentTenant = currentUser?.tenants.first
            }
        }
    }
}
