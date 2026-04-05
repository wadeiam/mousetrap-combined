import SwiftUI

struct ServoSettingsSection: View {
    let deviceId: String
    let isOnline: Bool
    @ObservedObject var viewModel: DeviceSettingsViewModel

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                    if isExpanded && viewModel.servoSettings == nil {
                        Task {
                            await viewModel.loadServoSettings(deviceId: deviceId)
                        }
                    }
                }
            } label: {
                HStack {
                    Image(systemName: "gearshape.2")
                        .foregroundStyle(.green)
                        .frame(width: 24)
                    Text("Servo Settings")
                        .font(.headline)
                    Spacer()
                    if viewModel.isLoadingServo {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()
            }
            .buttonStyle(.plain)
            .disabled(!isOnline)

            if isExpanded {
                Divider()
                    .padding(.horizontal)

                if let settings = viewModel.servoSettings {
                    VStack(spacing: 16) {
                        // Disabled toggle
                        Toggle("Servo Disabled", isOn: Binding(
                            get: { settings.disabled },
                            set: { viewModel.servoSettings?.disabled = $0 }
                        ))

                        if !settings.disabled {
                            // Start position slider
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Start Position")
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Text("\(settings.startUS) µs")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Slider(value: Binding(
                                    get: { Double(settings.startUS) },
                                    set: { viewModel.servoSettings?.startUS = Int($0) }
                                ), in: Double(ServoSettings.minUS)...Double(ServoSettings.maxUS), step: 10)
                                Text("Open position (arm retracted)")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }

                            // End position slider
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("End Position")
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Text("\(settings.endUS) µs")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Slider(value: Binding(
                                    get: { Double(settings.endUS) },
                                    set: { viewModel.servoSettings?.endUS = Int($0) }
                                ), in: Double(ServoSettings.minUS)...Double(ServoSettings.maxUS), step: 10)
                                Text("Closed position (arm extended)")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }

                            // Visual indicator
                            HStack {
                                VStack {
                                    Text("OPEN")
                                        .font(.caption2)
                                        .fontWeight(.medium)
                                    Text("\(settings.startUS)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity)

                                Image(systemName: "arrow.left.and.right")
                                    .foregroundStyle(.secondary)

                                VStack {
                                    Text("CLOSED")
                                        .font(.caption2)
                                        .fontWeight(.medium)
                                    Text("\(settings.endUS)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .padding(.vertical, 8)
                            .padding(.horizontal)
                            .background(Color(.systemGray5))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }

                        // Action buttons
                        HStack(spacing: 12) {
                            if !settings.disabled {
                                Button {
                                    Task {
                                        await viewModel.testServo(deviceId: deviceId)
                                    }
                                } label: {
                                    HStack {
                                        if viewModel.isTestingServo {
                                            ProgressView()
                                                .tint(.orange)
                                        } else {
                                            Image(systemName: "play.fill")
                                        }
                                        Text("Test")
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(Color.orange.opacity(0.2))
                                    .foregroundStyle(.orange)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                }
                                .disabled(viewModel.isTestingServo)
                            }

                            Button {
                                Task {
                                    await viewModel.saveServoSettings(deviceId: deviceId)
                                }
                            } label: {
                                HStack {
                                    if viewModel.isSavingServo {
                                        ProgressView()
                                            .tint(.white)
                                    } else {
                                        Image(systemName: "checkmark")
                                    }
                                    Text("Apply")
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Color.blue)
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .disabled(viewModel.isSavingServo)
                        }
                    }
                    .padding()
                    .font(.subheadline)
                } else if viewModel.servoError != nil {
                    VStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title2)
                            .foregroundStyle(.orange)
                        Text(viewModel.servoError ?? "Failed to load settings")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button("Retry") {
                            Task {
                                await viewModel.loadServoSettings(deviceId: deviceId)
                            }
                        }
                        .font(.caption)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding()
                }
            }
        }
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .opacity(isOnline ? 1.0 : 0.5)
    }
}
