import Foundation

enum AppConfig {
    // MARK: - Server Configuration

    static let serverBaseURL = "http://192.168.133.110:4000"
    static let apiBaseURL = "\(serverBaseURL)/api"
    static let wsBaseURL = "ws://192.168.133.110:4000"

    // MARK: - App Info

    static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    static var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }

    static var fullVersion: String {
        "\(appVersion) (\(buildNumber))"
    }

    // MARK: - Feature Flags

    static let enableDebugLogging = true
    static let enableHaptics = true

    // MARK: - Timeouts

    static let apiTimeout: TimeInterval = 30
    static let websocketReconnectDelay: TimeInterval = 2
    static let maxReconnectAttempts = 5

    // MARK: - Cache

    static let imageCacheLimit = 50 // MB
    static let snapshotCacheExpiry: TimeInterval = 3600 // 1 hour
}

// MARK: - Debug Logging

func debugLog(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
    #if DEBUG
    if AppConfig.enableDebugLogging {
        let filename = (file as NSString).lastPathComponent
        print("[\(filename):\(line)] \(function) - \(message)")
    }
    #endif
}
