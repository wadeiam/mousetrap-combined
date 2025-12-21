import Foundation

@MainActor
class DeviceListViewModel: ObservableObject {
    @Published var devices: [Device] = []
    @Published var isLoading = false
    @Published var error: String?

    private let apiClient = APIClient.shared

    func loadDevices() async {
        isLoading = true
        error = nil

        do {
            struct DevicesResponse: Codable {
                let success: Bool?
                let data: DeviceData?
                let devices: [Device]?
                let pagination: Pagination?
            }

            struct DeviceData: Codable {
                let items: [Device]?
                let devices: [Device]?
                let pagination: Pagination?
            }

            let response: DevicesResponse = try await apiClient.get(
                endpoint: .devices,
                queryItems: [
                    URLQueryItem(name: "page", value: "1"),
                    URLQueryItem(name: "limit", value: "100")
                ]
            )

            if let data = response.data {
                if let items = data.items {
                    devices = items
                    print("[Devices] Loaded \(devices.count) devices from data.items")
                } else if let deviceList = data.devices {
                    devices = deviceList
                    print("[Devices] Loaded \(devices.count) devices from data.devices")
                }
            } else if let deviceList = response.devices {
                devices = deviceList
                print("[Devices] Loaded \(devices.count) devices from devices")
            } else {
                print("[Devices] No devices found in response")
            }

        } catch let apiError as APIError {
            error = apiError.errorDescription
            print("[Devices] API Error: \(apiError.errorDescription ?? "unknown")")
        } catch let decodingError as DecodingError {
            error = "Failed to parse device data"
            print("[Devices] Decoding Error: \(decodingError)")
        } catch {
            self.error = error.localizedDescription
            print("[Devices] Error: \(error.localizedDescription)")
        }

        isLoading = false
    }
}
