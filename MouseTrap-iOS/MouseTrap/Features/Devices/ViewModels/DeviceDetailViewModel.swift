import Foundation

@MainActor
class DeviceDetailViewModel: ObservableObject {
    @Published var snapshot: String?
    @Published var isRequestingSnapshot = false
    @Published var isLoading = false
    @Published var error: String?
    @Published var successMessage: String?

    private let apiClient = APIClient.shared

    func requestSnapshot(deviceId: String) async {
        isRequestingSnapshot = true
        error = nil

        do {
            struct SnapshotResponse: Codable {
                let success: Bool?
                let message: String?
            }

            let _: SnapshotResponse = try await apiClient.post(
                endpoint: .requestSnapshot(deviceId: deviceId)
            )

            // Snapshot will come via WebSocket - wait a bit then poll
            try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds

            // Fetch device to get latest snapshot
            struct DeviceResponse: Codable {
                let success: Bool?
                let data: Device?
            }

            let response: DeviceResponse = try await apiClient.get(
                endpoint: .device(id: deviceId)
            )

            if let device = response.data, let snap = device.lastSnapshot {
                snapshot = snap
            }

        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }

        isRequestingSnapshot = false
    }

    func rebootDevice(deviceId: String) async {
        isLoading = true
        error = nil

        do {
            struct RebootResponse: Codable {
                let success: Bool?
                let message: String?
            }

            let response: RebootResponse = try await apiClient.post(
                endpoint: .rebootDevice(deviceId: deviceId)
            )

            successMessage = response.message ?? "Reboot command sent"

        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func clearAlerts(deviceId: String) async {
        isLoading = true
        error = nil

        do {
            struct ClearResponse: Codable {
                let success: Bool?
                let message: String?
                let cleared: Int?
            }

            let response: ClearResponse = try await apiClient.post(
                endpoint: .clearAlerts(deviceId: deviceId)
            )

            let cleared = response.cleared ?? 0
            successMessage = "Cleared \(cleared) alert\(cleared == 1 ? "" : "s")"

        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func testAlert(deviceId: String) async {
        isLoading = true
        error = nil

        do {
            struct TestAlertResponse: Codable {
                let success: Bool?
                let message: String?
                let alertId: String?
            }

            let _: TestAlertResponse = try await apiClient.post(
                endpoint: .testAlert(deviceId: deviceId)
            )

            successMessage = "Test alert sent"

        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }
}
