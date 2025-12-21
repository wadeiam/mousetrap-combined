import Foundation

class AlertService {
    static let shared = AlertService()

    private let apiClient = APIClient.shared

    private init() {}

    // MARK: - Alert List

    func getAlerts(
        page: Int = 1,
        limit: Int = 100,
        severity: String? = nil,
        deviceId: String? = nil,
        isResolved: Bool? = nil
    ) async throws -> [Alert] {
        var queryItems = [
            URLQueryItem(name: "page", value: "\(page)"),
            URLQueryItem(name: "limit", value: "\(limit)")
        ]

        if let severity = severity {
            queryItems.append(URLQueryItem(name: "severity", value: severity))
        }

        if let deviceId = deviceId {
            queryItems.append(URLQueryItem(name: "device_id", value: deviceId))
        }

        if let isResolved = isResolved {
            queryItems.append(URLQueryItem(name: "is_resolved", value: isResolved ? "true" : "false"))
        }

        struct Response: Codable {
            let success: Bool?
            let data: AlertData?
            let alerts: [Alert]?
        }

        struct AlertData: Codable {
            let alerts: [Alert]
        }

        let response: Response = try await apiClient.get(
            endpoint: .alerts,
            queryItems: queryItems
        )

        return response.data?.alerts ?? response.alerts ?? []
    }

    // MARK: - Alert Actions

    func acknowledgeAlert(id: String) async throws -> Alert {
        struct Response: Codable {
            let success: Bool?
            let data: Alert?
            let alert: Alert?
        }

        let response: Response = try await apiClient.post(
            endpoint: .acknowledgeAlert(id: id)
        )

        guard let alert = response.data ?? response.alert else {
            throw APIError.noData
        }

        return alert
    }

    func resolveAlert(id: String, notes: String?) async throws -> Alert {
        struct Request: Codable {
            let notes: String?
        }

        struct Response: Codable {
            let success: Bool?
            let data: Alert?
            let alert: Alert?
        }

        let response: Response = try await apiClient.post(
            endpoint: .resolveAlert(id: id),
            body: Request(notes: notes)
        )

        guard let alert = response.data ?? response.alert else {
            throw APIError.noData
        }

        return alert
    }
}
