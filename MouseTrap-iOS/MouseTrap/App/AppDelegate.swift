import UIKit
import UserNotifications

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Clear stale keychain data on fresh install
        // UserDefaults is cleared on uninstall, Keychain is not
        let hasLaunchedKey = "hasLaunchedBefore"
        if !UserDefaults.standard.bool(forKey: hasLaunchedKey) {
            print("[App] Fresh install detected - clearing keychain")
            KeychainService.shared.clearAll()
            UserDefaults.standard.set(true, forKey: hasLaunchedKey)
        }

        // Set notification delegate
        UNUserNotificationCenter.current().delegate = self

        // Request notification permission
        requestNotificationPermission()

        return true
    }

    // MARK: - Push Notification Registration

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            if let error = error {
                print("[Push] Authorization error: \(error)")
                return
            }

            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[Push] Device token: \(token)")

        // Register token with server
        Task {
            await PushNotificationService.shared.registerToken(token)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[Push] Failed to register: \(error)")
    }

    // MARK: - UNUserNotificationCenterDelegate

    // Handle notification when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show notification even when app is in foreground
        // Include .list to add to Notification Center
        completionHandler([.banner, .badge, .sound, .list])
    }

    // Handle notification tap
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo

        // Handle different notification types
        if let alertId = userInfo["alertId"] as? String {
            NotificationCenter.default.post(
                name: .didTapAlertNotification,
                object: nil,
                userInfo: ["alertId": alertId]
            )
        } else if let deviceId = userInfo["deviceId"] as? String {
            NotificationCenter.default.post(
                name: .didTapDeviceNotification,
                object: nil,
                userInfo: ["deviceId": deviceId]
            )
        }

        completionHandler()
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let didTapAlertNotification = Notification.Name("didTapAlertNotification")
    static let didTapDeviceNotification = Notification.Name("didTapDeviceNotification")
}
