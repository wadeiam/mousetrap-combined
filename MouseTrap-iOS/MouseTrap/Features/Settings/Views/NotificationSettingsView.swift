import SwiftUI

struct NotificationSettingsView: View {
    @StateObject private var viewModel = NotificationSettingsViewModel()

    var body: some View {
        Form {
            Section {
                Toggle("Trap Alerts", isOn: $viewModel.trapAlerts)
                Toggle("Device Offline", isOn: $viewModel.deviceOffline)
                Toggle("Device Online", isOn: $viewModel.deviceOnline)
                Toggle("Low Battery", isOn: $viewModel.lowBattery)
            } header: {
                Text("Notification Types")
            } footer: {
                Text("Choose which events you want to be notified about.")
            }

            Section {
                Toggle("Enable Quiet Hours", isOn: $viewModel.quietHoursEnabled)

                if viewModel.quietHoursEnabled {
                    DatePicker(
                        "Start",
                        selection: $viewModel.quietStart,
                        displayedComponents: .hourAndMinute
                    )

                    DatePicker(
                        "End",
                        selection: $viewModel.quietEnd,
                        displayedComponents: .hourAndMinute
                    )
                }
            } header: {
                Text("Quiet Hours")
            } footer: {
                Text("Notifications will be silenced during quiet hours, except for critical alerts.")
            }

            Section {
                Button {
                    Task {
                        await viewModel.sendTestNotification()
                    }
                } label: {
                    HStack {
                        Spacer()
                        if viewModel.isSendingTest {
                            ProgressView()
                        } else {
                            Text("Send Test Notification")
                        }
                        Spacer()
                    }
                }
                .disabled(viewModel.isSendingTest)
            }

            if viewModel.testSent {
                Section {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("Test notification sent!")
                    }
                }
            }

            if let error = viewModel.error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadPreferences()
        }
        .onChange(of: viewModel.trapAlerts) { _ in Task { await viewModel.savePreferences() } }
        .onChange(of: viewModel.deviceOffline) { _ in Task { await viewModel.savePreferences() } }
        .onChange(of: viewModel.deviceOnline) { _ in Task { await viewModel.savePreferences() } }
        .onChange(of: viewModel.lowBattery) { _ in Task { await viewModel.savePreferences() } }
        .onChange(of: viewModel.quietHoursEnabled) { _ in Task { await viewModel.savePreferences() } }
        .onChange(of: viewModel.quietStart) { _ in Task { await viewModel.savePreferences() } }
        .onChange(of: viewModel.quietEnd) { _ in Task { await viewModel.savePreferences() } }
    }
}

@MainActor
class NotificationSettingsViewModel: ObservableObject {
    @Published var trapAlerts = true
    @Published var deviceOffline = true
    @Published var deviceOnline = false
    @Published var lowBattery = true
    @Published var quietHoursEnabled = false
    @Published var quietStart = Calendar.current.date(from: DateComponents(hour: 22)) ?? Date()
    @Published var quietEnd = Calendar.current.date(from: DateComponents(hour: 7)) ?? Date()

    @Published var isLoading = false
    @Published var isSendingTest = false
    @Published var testSent = false
    @Published var error: String?

    private let apiClient = APIClient.shared
    private var isInitialLoad = true

    func loadPreferences() async {
        isLoading = true

        do {
            struct PrefsResponse: Codable {
                let success: Bool?
                let data: NotificationPrefs?
                let trapAlerts: Bool?
                let deviceOffline: Bool?
                let deviceOnline: Bool?
                let lowBattery: Bool?
                let quietHoursEnabled: Bool?
                let quietStart: String?
                let quietEnd: String?

                enum CodingKeys: String, CodingKey {
                    case success, data
                    case trapAlerts = "trap_alerts"
                    case deviceOffline = "device_offline"
                    case deviceOnline = "device_online"
                    case lowBattery = "low_battery"
                    case quietHoursEnabled = "quiet_hours_enabled"
                    case quietStart = "quiet_start"
                    case quietEnd = "quiet_end"
                }
            }

            struct NotificationPrefs: Codable {
                let trapAlerts: Bool?
                let deviceOffline: Bool?
                let deviceOnline: Bool?
                let lowBattery: Bool?
                let quietHoursEnabled: Bool?
                let quietStart: String?
                let quietEnd: String?

                enum CodingKeys: String, CodingKey {
                    case trapAlerts = "trap_alerts"
                    case deviceOffline = "device_offline"
                    case deviceOnline = "device_online"
                    case lowBattery = "low_battery"
                    case quietHoursEnabled = "quiet_hours_enabled"
                    case quietStart = "quiet_start"
                    case quietEnd = "quiet_end"
                }
            }

            let response: PrefsResponse = try await apiClient.get(endpoint: .notificationPreferences)

            let prefs = response.data

            trapAlerts = prefs?.trapAlerts ?? response.trapAlerts ?? true
            deviceOffline = prefs?.deviceOffline ?? response.deviceOffline ?? true
            deviceOnline = prefs?.deviceOnline ?? response.deviceOnline ?? false
            lowBattery = prefs?.lowBattery ?? response.lowBattery ?? true
            quietHoursEnabled = prefs?.quietHoursEnabled ?? response.quietHoursEnabled ?? false

            // Parse time strings if available
            if let start = prefs?.quietStart ?? response.quietStart {
                quietStart = parseTime(start) ?? quietStart
            }
            if let end = prefs?.quietEnd ?? response.quietEnd {
                quietEnd = parseTime(end) ?? quietEnd
            }

            isInitialLoad = false

        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }

        isLoading = false
    }

    func savePreferences() async {
        guard !isInitialLoad else { return }

        struct UpdatePrefs: Codable {
            let trapAlerts: Bool
            let deviceOffline: Bool
            let deviceOnline: Bool
            let lowBattery: Bool
            let quietHoursEnabled: Bool
            let quietStart: String
            let quietEnd: String

            enum CodingKeys: String, CodingKey {
                case trapAlerts = "trap_alerts"
                case deviceOffline = "device_offline"
                case deviceOnline = "device_online"
                case lowBattery = "low_battery"
                case quietHoursEnabled = "quiet_hours_enabled"
                case quietStart = "quiet_start"
                case quietEnd = "quiet_end"
            }
        }

        let prefs = UpdatePrefs(
            trapAlerts: trapAlerts,
            deviceOffline: deviceOffline,
            deviceOnline: deviceOnline,
            lowBattery: lowBattery,
            quietHoursEnabled: quietHoursEnabled,
            quietStart: formatTime(quietStart),
            quietEnd: formatTime(quietEnd)
        )

        do {
            let _: EmptyResponse = try await apiClient.put(
                endpoint: .notificationPreferences,
                body: prefs
            )
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func sendTestNotification() async {
        isSendingTest = true
        testSent = false
        error = nil

        do {
            let _: EmptyResponse = try await apiClient.post(endpoint: .testNotification)
            testSent = true

            // Hide success message after 3 seconds
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            testSent = false
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }

        isSendingTest = false
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    private func parseTime(_ string: String) -> Date? {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.date(from: string)
    }
}

#Preview {
    NavigationStack {
        NotificationSettingsView()
    }
}
