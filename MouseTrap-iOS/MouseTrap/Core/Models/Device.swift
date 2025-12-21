import Foundation

struct Device: Codable, Identifiable {
    let id: String
    let mqttClientId: String
    let name: String?
    let tenantId: String?
    let tenantName: String?
    let status: DeviceStatus
    let location: String?
    let label: String?
    let firmwareVersion: String?
    let filesystemVersion: String?
    let hardwareVersion: String?
    let lastSeen: Date?
    let uptime: Int?
    let rssi: Int?
    let localIp: String?
    let macAddress: String?
    let online: Bool?
    let paused: Bool?
    let heapFree: Int?
    let lastSnapshot: String?
    let lastSnapshotAt: Date?

    var displayName: String {
        name ?? label ?? mqttClientId
    }

    var signalStrength: SignalStrength {
        guard let rssi = rssi else { return .unknown }
        switch rssi {
        case -50...0: return .excellent
        case -60..<(-50): return .good
        case -70..<(-60): return .fair
        default: return .poor
        }
    }

    enum CodingKeys: String, CodingKey {
        case id
        case mqttClientId = "deviceId"
        case name
        case tenantId
        case tenantName
        case status
        case location
        case label
        case firmwareVersion
        case filesystemVersion
        case hardwareVersion
        case lastSeen
        case uptime
        case rssi = "signalStrength"
        case localIp = "ipAddress"
        case macAddress
        case online
        case paused
        case heapFree
        case lastSnapshot
        case lastSnapshotAt
    }
}

enum DeviceStatus: String, Codable {
    case online
    case offline
    case alerting
    case error
    case maintenance

    var color: String {
        switch self {
        case .online: return "green"
        case .offline: return "gray"
        case .alerting: return "red"
        case .error: return "red"
        case .maintenance: return "orange"
        }
    }
}

enum SignalStrength {
    case excellent, good, fair, poor, unknown

    var icon: String {
        switch self {
        case .excellent: return "wifi"
        case .good: return "wifi"
        case .fair: return "wifi.exclamationmark"
        case .poor: return "wifi.slash"
        case .unknown: return "wifi.slash"
        }
    }
}

struct DeviceListResponse: Codable {
    let devices: [Device]
    let pagination: Pagination?
}

struct Pagination: Codable {
    let page: Int
    let limit: Int
    let total: Int
    let totalPages: Int
}
