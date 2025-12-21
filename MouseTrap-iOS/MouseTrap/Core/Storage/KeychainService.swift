import Foundation
import Security

class KeychainService {
    static let shared = KeychainService()

    private let serviceName = "com.mousetrap.ios"

    private enum Keys {
        static let accessToken = "accessToken"
        static let refreshToken = "refreshToken"
        static let currentTenantId = "currentTenantId"
        static let userId = "userId"
    }

    private init() {}

    // MARK: - Access Token

    func saveAccessToken(_ token: String) {
        save(key: Keys.accessToken, value: token)
    }

    func getAccessToken() -> String? {
        return get(key: Keys.accessToken)
    }

    func deleteAccessToken() {
        delete(key: Keys.accessToken)
    }

    // MARK: - Refresh Token

    func saveRefreshToken(_ token: String) {
        save(key: Keys.refreshToken, value: token)
    }

    func getRefreshToken() -> String? {
        return get(key: Keys.refreshToken)
    }

    func deleteRefreshToken() {
        delete(key: Keys.refreshToken)
    }

    // MARK: - Current Tenant ID

    func saveCurrentTenantId(_ tenantId: String) {
        save(key: Keys.currentTenantId, value: tenantId)
    }

    func getCurrentTenantId() -> String? {
        return get(key: Keys.currentTenantId)
    }

    func deleteCurrentTenantId() {
        delete(key: Keys.currentTenantId)
    }

    // MARK: - User ID

    func saveUserId(_ userId: String) {
        save(key: Keys.userId, value: userId)
    }

    func getUserId() -> String? {
        return get(key: Keys.userId)
    }

    func deleteUserId() {
        delete(key: Keys.userId)
    }

    // MARK: - Clear All

    func clearAll() {
        deleteAccessToken()
        deleteRefreshToken()
        deleteCurrentTenantId()
        deleteUserId()
    }

    // MARK: - Private Helpers

    private func save(key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }

        // Delete any existing item first
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        let status = SecItemAdd(query as CFDictionary, nil)

        #if DEBUG
        if status != errSecSuccess {
            print("[Keychain] Failed to save \(key): \(status)")
        }
        #endif
    }

    private func get(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }

        return string
    }

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]

        SecItemDelete(query as CFDictionary)
    }
}
