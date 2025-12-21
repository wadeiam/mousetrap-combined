import Foundation

@MainActor
class AlertsViewModel: ObservableObject {
    @Published var alerts: [Alert] = []
    @Published var isLoading = false
    @Published var error: String?

    private let apiClient = APIClient.shared

    func loadAlerts() async {
        isLoading = true
        error = nil

        do {
            struct AlertsResponse: Codable {
                let success: Bool?
                let data: AlertData?
                let alerts: [Alert]?
                let pagination: Pagination?
            }

            struct AlertData: Codable {
                let items: [Alert]?
                let alerts: [Alert]?
                let pagination: Pagination?
            }

            let response: AlertsResponse = try await apiClient.get(
                endpoint: .alerts,
                queryItems: [
                    URLQueryItem(name: "page", value: "1"),
                    URLQueryItem(name: "limit", value: "100")
                ]
            )

            if let data = response.data {
                if let items = data.items {
                    alerts = items
                    print("[Alerts] Loaded \(alerts.count) alerts from data.items")
                } else if let alertList = data.alerts {
                    alerts = alertList
                    print("[Alerts] Loaded \(alerts.count) alerts from data.alerts")
                }
            } else if let alertList = response.alerts {
                alerts = alertList
                print("[Alerts] Loaded \(alerts.count) alerts from alerts")
            } else {
                print("[Alerts] No alerts found in response")
            }

        } catch let apiError as APIError {
            error = apiError.errorDescription
            print("[Alerts] API Error: \(apiError.errorDescription ?? "unknown")")
        } catch let decodingError as DecodingError {
            error = "Failed to parse alert data"
            print("[Alerts] Decoding Error: \(decodingError)")
        } catch {
            self.error = error.localizedDescription
            print("[Alerts] Error: \(error.localizedDescription)")
        }

        isLoading = false
    }

    func acknowledgeAlert(id: String) async {
        do {
            struct AckResponse: Codable {
                let success: Bool?
                let data: Alert?
                let alert: Alert?
            }

            let response: AckResponse = try await apiClient.post(
                endpoint: .acknowledgeAlert(id: id)
            )

            // Update local alert
            if let updatedAlert = response.data ?? response.alert {
                if let index = alerts.firstIndex(where: { $0.id == id }) {
                    alerts[index] = updatedAlert
                }
            } else {
                // Reload alerts if we didn't get the updated alert back
                await loadAlerts()
            }

        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func resolveAlert(id: String, notes: String?) async {
        do {
            struct ResolveResponse: Codable {
                let success: Bool?
                let data: Alert?
                let alert: Alert?
            }

            let body = ResolveAlertRequest(notes: notes)

            let response: ResolveResponse = try await apiClient.post(
                endpoint: .resolveAlert(id: id),
                body: body
            )

            // Update local alert
            if let updatedAlert = response.data ?? response.alert {
                if let index = alerts.firstIndex(where: { $0.id == id }) {
                    alerts[index] = updatedAlert
                }
            } else {
                await loadAlerts()
            }

        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
