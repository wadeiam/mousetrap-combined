import Foundation

class DeviceService {
    static let shared = DeviceService()

    private let apiClient = APIClient.shared

    private init() {}

    // MARK: - Device List

    func getDevices(
        page: Int = 1,
        limit: Int = 100,
        status: String? = nil,
        search: String? = nil
    ) async throws -> [Device] {
        var queryItems = [
            URLQueryItem(name: "page", value: "\(page)"),
            URLQueryItem(name: "limit", value: "\(limit)")
        ]

        if let status = status {
            queryItems.append(URLQueryItem(name: "status", value: status))
        }

        if let search = search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }

        struct Response: Codable {
            let success: Bool?
            let data: DeviceData?
            let devices: [Device]?
        }

        struct DeviceData: Codable {
            let devices: [Device]
        }

        let response: Response = try await apiClient.get(
            endpoint: .devices,
            queryItems: queryItems
        )

        return response.data?.devices ?? response.devices ?? []
    }

    // MARK: - Single Device

    func getDevice(id: String) async throws -> Device {
        struct Response: Codable {
            let success: Bool?
            let data: Device?
            let device: Device?
        }

        let response: Response = try await apiClient.get(endpoint: .device(id: id))

        guard let device = response.data ?? response.device else {
            throw APIError.noData
        }

        return device
    }

    // MARK: - Device Actions

    func requestSnapshot(deviceId: String) async throws {
        struct Response: Codable {
            let success: Bool?
            let message: String?
        }

        let _: Response = try await apiClient.post(
            endpoint: .requestSnapshot(deviceId: deviceId)
        )
    }

    func rebootDevice(deviceId: String) async throws -> String {
        struct Response: Codable {
            let success: Bool?
            let message: String?
        }

        let response: Response = try await apiClient.post(
            endpoint: .rebootDevice(deviceId: deviceId)
        )

        return response.message ?? "Reboot command sent"
    }

    func triggerFirmwareUpdate(deviceId: String, firmwareId: String) async throws -> String {
        struct Request: Codable {
            let firmwareId: String
        }

        struct Response: Codable {
            let success: Bool?
            let message: String?
        }

        let response: Response = try await apiClient.post(
            endpoint: .firmwareUpdate(deviceId: deviceId),
            body: Request(firmwareId: firmwareId)
        )

        return response.message ?? "Firmware update started"
    }

    func clearAlerts(deviceId: String) async throws -> Int {
        struct Response: Codable {
            let success: Bool?
            let message: String?
            let cleared: Int?
        }

        let response: Response = try await apiClient.post(
            endpoint: .clearAlerts(deviceId: deviceId)
        )

        return response.cleared ?? 0
    }

    func sendTestAlert(deviceId: String) async throws -> String {
        struct Response: Codable {
            let success: Bool?
            let message: String?
            let alertId: String?
        }

        let response: Response = try await apiClient.post(
            endpoint: .testAlert(deviceId: deviceId)
        )

        return response.alertId ?? ""
    }
}
