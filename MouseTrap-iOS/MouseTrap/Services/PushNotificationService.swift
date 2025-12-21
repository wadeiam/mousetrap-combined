import Foundation
import UserNotifications
import UIKit

@MainActor
class PushNotificationService: ObservableObject {
    static let shared = PushNotificationService()

    @Published var isRegistered = false
    @Published var hasPermission = false

    private let apiClient = APIClient.shared
    private var deviceToken: String?

    private init() {
        checkPermissionStatus()
    }

    // MARK: - Permission

    func checkPermissionStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            Task { @MainActor in
                self.hasPermission = settings.authorizationStatus == .authorized
            }
        }
    }

    func requestPermission() async -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound]
            )
            hasPermission = granted

            if granted {
                await MainActor.run {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }

            return granted
        } catch {
            print("[Push] Permission error: \(error)")
            return false
        }
    }

    // MARK: - Token Registration

    func registerToken(_ token: String) async {
        self.deviceToken = token

        // Only register if authenticated
        guard KeychainService.shared.getAccessToken() != nil else {
            return
        }

        do {
            struct RegisterRequest: Codable {
                let token: String
                let platform: String
                let deviceName: String?
            }

            let request = RegisterRequest(
                token: token,
                platform: "ios",
                deviceName: UIDevice.current.name
            )

            let _: EmptyResponse = try await apiClient.post(
                endpoint: .registerPushToken,
                body: request
            )

            isRegistered = true
            print("[Push] Token registered with server")

        } catch {
            print("[Push] Failed to register token: \(error)")
        }
    }

    func unregisterToken() async {
        guard let token = deviceToken else { return }

        do {
            struct UnregisterRequest: Codable {
                let token: String
            }

            let _: EmptyResponse = try await apiClient.request(
                endpoint: .removePushToken,
                method: .delete,
                body: UnregisterRequest(token: token)
            )

            isRegistered = false
            print("[Push] Token unregistered")

        } catch {
            print("[Push] Failed to unregister token: \(error)")
        }
    }

    // MARK: - Re-register on Login

    func onLogin() async {
        if let token = deviceToken {
            await registerToken(token)
        }
    }

    func onLogout() async {
        await unregisterToken()
    }

    // MARK: - Test Notification

    func sendTestNotification() async throws {
        let _: EmptyResponse = try await apiClient.post(endpoint: .testNotification)
    }

    // MARK: - Badge Management

    func clearBadge() {
        UNUserNotificationCenter.current().setBadgeCount(0)
    }

    func setBadge(_ count: Int) {
        UNUserNotificationCenter.current().setBadgeCount(count)
    }
}
