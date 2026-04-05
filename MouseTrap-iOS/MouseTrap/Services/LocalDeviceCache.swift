import Foundation

class LocalDeviceCache {
    static let shared = LocalDeviceCache()

    private let cacheKey = "CachedDevices"
    private let cacheTimestampKey = "CachedDevicesTimestamp"

    private init() {}

    // MARK: - Cache Operations

    func cacheDevices(_ devices: [Device]) {
        do {
            // Strip base64 snapshot data to keep cache small
            let lightDevices = devices.map { device -> Device in
                Device(
                    id: device.id,
                    mqttClientId: device.mqttClientId,
                    name: device.name,
                    tenantId: device.tenantId,
                    tenantName: device.tenantName,
                    status: device.status,
                    location: device.location,
                    label: device.label,
                    firmwareVersion: device.firmwareVersion,
                    filesystemVersion: device.filesystemVersion,
                    hardwareVersion: device.hardwareVersion,
                    lastSeen: device.lastSeen,
                    uptime: device.uptime,
                    rssi: device.rssi,
                    localIp: device.localIp,
                    macAddress: device.macAddress,
                    online: device.online,
                    paused: device.paused,
                    heapFree: device.heapFree,
                    lastSnapshot: nil,
                    lastSnapshotAt: device.lastSnapshotAt,
                    deviceType: device.deviceType,
                    activeAlert: device.activeAlert != nil ? ActiveAlert(
                        id: device.activeAlert!.id,
                        triggeredAt: device.activeAlert!.triggeredAt,
                        snapshot: nil,
                        snapshotAt: device.activeAlert!.snapshotAt
                    ) : nil,
                    muteOfflinePermanently: device.muteOfflinePermanently,
                    muteOfflineUntil: device.muteOfflineUntil
                )
            }

            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(lightDevices)
            UserDefaults.standard.set(data, forKey: cacheKey)
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: cacheTimestampKey)
            print("[LocalDeviceCache] Cached \(devices.count) devices")
        } catch {
            print("[LocalDeviceCache] Failed to cache devices: \(error)")
        }
    }

    func loadCachedDevices() -> [Device]? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }

        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let devices = try decoder.decode([Device].self, from: data)
            print("[LocalDeviceCache] Loaded \(devices.count) cached devices")
            return devices
        } catch {
            print("[LocalDeviceCache] Failed to load cached devices: \(error)")
            return nil
        }
    }

    var lastCachedAt: Date? {
        let timestamp = UserDefaults.standard.double(forKey: cacheTimestampKey)
        guard timestamp > 0 else { return nil }
        return Date(timeIntervalSince1970: timestamp)
    }

    var cacheAge: TimeInterval? {
        guard let lastCachedAt else { return nil }
        return Date().timeIntervalSince(lastCachedAt)
    }
}
