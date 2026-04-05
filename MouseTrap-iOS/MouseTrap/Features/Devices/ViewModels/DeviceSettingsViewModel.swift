import Foundation

@MainActor
class DeviceSettingsViewModel: ObservableObject {
    // Camera Settings
    @Published var cameraSettings: CameraSettings?
    @Published var isLoadingCamera = false
    @Published var isSavingCamera = false
    @Published var cameraError: String?

    // Calibration Settings (Trap only)
    @Published var calibrationSettings: CalibrationSettings?
    @Published var isLoadingCalibration = false
    @Published var isSavingCalibration = false
    @Published var isRecalibrating = false
    @Published var calibrationError: String?

    // Servo Settings (Trap only)
    @Published var servoSettings: ServoSettings?
    @Published var isLoadingServo = false
    @Published var isSavingServo = false
    @Published var isTestingServo = false
    @Published var servoError: String?

    // Motion Config (Scout only)
    @Published var motionConfig: MotionConfig?
    @Published var isLoadingMotion = false
    @Published var isSavingMotion = false
    @Published var motionError: String?

    // General
    @Published var successMessage: String?

    private let apiClient = APIClient.shared

    // MARK: - Camera Settings

    func loadCameraSettings(deviceId: String) async {
        isLoadingCamera = true
        cameraError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let data: CameraSettings?
                let error: String?
            }

            let response: Response = try await apiClient.get(
                endpoint: .cameraSettings(deviceId: deviceId)
            )

            if let settings = response.data {
                cameraSettings = settings
            } else {
                cameraError = response.error ?? "No settings returned"
            }
        } catch let apiError as APIError {
            cameraError = apiError.errorDescription
        } catch {
            cameraError = error.localizedDescription
        }

        isLoadingCamera = false
    }

    func saveCameraSettings(deviceId: String) async {
        guard let settings = cameraSettings else { return }
        isSavingCamera = true
        cameraError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let message: String?
                let error: String?
            }

            let _: Response = try await apiClient.post(
                endpoint: .cameraSettings(deviceId: deviceId),
                body: settings
            )

            successMessage = "Camera settings applied"
        } catch let apiError as APIError {
            cameraError = apiError.errorDescription
        } catch {
            cameraError = error.localizedDescription
        }

        isSavingCamera = false
    }

    // MARK: - Calibration Settings (Trap only)

    func loadCalibrationSettings(deviceId: String) async {
        isLoadingCalibration = true
        calibrationError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let data: CalibrationSettings?
                let error: String?
            }

            let response: Response = try await apiClient.get(
                endpoint: .calibration(deviceId: deviceId)
            )

            if let settings = response.data {
                calibrationSettings = settings
            } else {
                calibrationError = response.error ?? "No settings returned"
            }
        } catch let apiError as APIError {
            calibrationError = apiError.errorDescription
        } catch {
            calibrationError = error.localizedDescription
        }

        isLoadingCalibration = false
    }

    func saveCalibrationSettings(deviceId: String) async {
        guard let settings = calibrationSettings else { return }
        isSavingCalibration = true
        calibrationError = nil

        do {
            struct Request: Codable {
                let calibrationOffset: Int
                let overrideThreshold: Int?
            }

            struct Response: Codable {
                let success: Bool?
                let message: String?
                let error: String?
            }

            let _: Response = try await apiClient.post(
                endpoint: .calibration(deviceId: deviceId),
                body: Request(
                    calibrationOffset: settings.calibrationOffset,
                    overrideThreshold: settings.overrideThreshold
                )
            )

            successMessage = "Calibration settings applied"
        } catch let apiError as APIError {
            calibrationError = apiError.errorDescription
        } catch {
            calibrationError = error.localizedDescription
        }

        isSavingCalibration = false
    }

    func recalibrate(deviceId: String) async {
        isRecalibrating = true
        calibrationError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let message: String?
                let error: String?
            }

            let _: Response = try await apiClient.post(
                endpoint: .recalibrate(deviceId: deviceId)
            )

            successMessage = "Recalibration started"
        } catch let apiError as APIError {
            calibrationError = apiError.errorDescription
        } catch {
            calibrationError = error.localizedDescription
        }

        isRecalibrating = false
    }

    // MARK: - Servo Settings (Trap only)

    func loadServoSettings(deviceId: String) async {
        isLoadingServo = true
        servoError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let data: ServoSettings?
                let error: String?
            }

            let response: Response = try await apiClient.get(
                endpoint: .servoSettings(deviceId: deviceId)
            )

            if let settings = response.data {
                servoSettings = settings
            } else {
                servoError = response.error ?? "No settings returned"
            }
        } catch let apiError as APIError {
            servoError = apiError.errorDescription
        } catch {
            servoError = error.localizedDescription
        }

        isLoadingServo = false
    }

    func saveServoSettings(deviceId: String) async {
        guard let settings = servoSettings else { return }
        isSavingServo = true
        servoError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let message: String?
                let error: String?
            }

            let _: Response = try await apiClient.post(
                endpoint: .servoSettings(deviceId: deviceId),
                body: settings
            )

            successMessage = "Servo settings applied"
        } catch let apiError as APIError {
            servoError = apiError.errorDescription
        } catch {
            servoError = error.localizedDescription
        }

        isSavingServo = false
    }

    func testServo(deviceId: String) async {
        isTestingServo = true
        servoError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let message: String?
                let error: String?
            }

            let _: Response = try await apiClient.post(
                endpoint: .testServo(deviceId: deviceId)
            )

            successMessage = "Servo test triggered"
        } catch let apiError as APIError {
            servoError = apiError.errorDescription
        } catch {
            servoError = error.localizedDescription
        }

        isTestingServo = false
    }

    // MARK: - Motion Config (Scout only)

    func loadMotionConfig(deviceId: String) async {
        isLoadingMotion = true
        motionError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let data: MotionConfig?
                let error: String?
            }

            let response: Response = try await apiClient.get(
                endpoint: .motionConfig(deviceId: deviceId)
            )

            if let config = response.data {
                motionConfig = config
            } else {
                motionError = response.error ?? "No config returned"
            }
        } catch let apiError as APIError {
            motionError = apiError.errorDescription
        } catch {
            motionError = error.localizedDescription
        }

        isLoadingMotion = false
    }

    func saveMotionConfig(deviceId: String) async {
        guard let config = motionConfig else { return }
        isSavingMotion = true
        motionError = nil

        do {
            struct Response: Codable {
                let success: Bool?
                let message: String?
                let error: String?
            }

            let _: Response = try await apiClient.post(
                endpoint: .motionConfig(deviceId: deviceId),
                body: config
            )

            successMessage = "Motion config applied"
        } catch let apiError as APIError {
            motionError = apiError.errorDescription
        } catch {
            motionError = error.localizedDescription
        }

        isSavingMotion = false
    }
}
