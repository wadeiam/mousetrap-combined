import Foundation

// MARK: - Camera Settings (All Devices)

struct CameraSettings: Codable {
    var framesize: Int          // Resolution: 0=QVGA, 5=VGA, 8=SVGA, 9=XGA, etc.
    var quality: Int            // JPEG quality: 10-63 (lower = better)
    var brightness: Int         // -2 to 2
    var contrast: Int           // -2 to 2
    var saturation: Int         // -2 to 2
    var vflip: Bool             // Vertical flip
    var hmirror: Bool           // Horizontal mirror

    static let `default` = CameraSettings(
        framesize: 8,           // SVGA (800x600)
        quality: 12,
        brightness: 0,
        contrast: 0,
        saturation: 0,
        vflip: false,
        hmirror: false
    )

    var framesizeDescription: String {
        switch framesize {
        case 0: return "QVGA (320x240)"
        case 3: return "HVGA (480x320)"
        case 5: return "VGA (640x480)"
        case 8: return "SVGA (800x600)"
        case 9: return "XGA (1024x768)"
        case 10: return "SXGA (1280x1024)"
        case 13: return "UXGA (1600x1200)"
        default: return "Unknown"
        }
    }
}

// MARK: - Calibration Settings (Traps Only)

struct CalibrationSettings: Codable {
    var calibrationOffset: Int      // Offset from sensor baseline
    var overrideThreshold: Int?     // Manual threshold override (nil = auto)
    var currentThreshold: Int       // Current active threshold (read-only)
    var falseAlarmOffset: Int       // Offset applied after false alarm

    var isUsingAutoThreshold: Bool {
        overrideThreshold == nil
    }
}

// MARK: - Servo Settings (Traps Only)

struct ServoSettings: Codable {
    var startUS: Int            // Start position in microseconds (typically ~1000)
    var endUS: Int              // End position in microseconds (typically ~2000)
    var disabled: Bool          // Whether servo is disabled

    static let `default` = ServoSettings(
        startUS: 1000,
        endUS: 2000,
        disabled: false
    )

    // Valid range for servo microseconds
    static let minUS = 500
    static let maxUS = 2500
}

// MARK: - Motion Config (Scouts Only)

struct MotionConfig: Codable {
    var threshold: Int          // Motion detection threshold (0-255)
    var minSize: Double         // Minimum blob size to trigger
    var maxSize: Double         // Maximum blob size (filter out large changes)

    static let `default` = MotionConfig(
        threshold: 25,
        minSize: 0.01,
        maxSize: 0.5
    )
}

// MARK: - System Status

struct DeviceSystemStatus: Codable {
    let firmwareVersion: String
    let filesystemVersion: String?
    let uptime: Int
    let heapFree: Int
    let heapTotal: Int?
    let psramFree: Int?
    let psramTotal: Int?
    let filesystemUsed: Int?
    let filesystemTotal: Int?

    var heapPercentUsed: Double {
        guard let total = heapTotal, total > 0 else { return 0 }
        return Double(total - heapFree) / Double(total)
    }

    var uptimeFormatted: String {
        let hours = uptime / 3600
        let minutes = (uptime % 3600) / 60
        if hours > 24 {
            let days = hours / 24
            return "\(days)d \(hours % 24)h"
        }
        return "\(hours)h \(minutes)m"
    }
}
