import SwiftUI

struct CalibrationSection: View {
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
                    if isExpanded && viewModel.calibrationSettings == nil {
                        Task {
                            await viewModel.loadCalibrationSettings(deviceId: deviceId)
                        }
                    }
                }
            } label: {
                HStack {
                    Image(systemName: "tuningfork")
                        .foregroundStyle(.purple)
                        .frame(width: 24)
                    Text("Calibration")
                        .font(.headline)
                    Spacer()
                    if viewModel.isLoadingCalibration {
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

                if let settings = viewModel.calibrationSettings {
                    VStack(spacing: 16) {
                        // Current threshold (read-only)
                        HStack {
                            Text("Current Threshold")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("\(settings.currentThreshold)")
                                .fontWeight(.medium)
                        }

                        // Mode indicator
                        HStack {
                            Text("Mode")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(settings.isUsingAutoThreshold ? "Automatic" : "Manual Override")
                                .fontWeight(.medium)
                                .foregroundStyle(settings.isUsingAutoThreshold ? .green : .orange)
                        }

                        Divider()

                        // Calibration offset
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Calibration Offset")
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(settings.calibrationOffset)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Slider(value: Binding(
                                get: { Double(settings.calibrationOffset) },
                                set: { viewModel.calibrationSettings?.calibrationOffset = Int($0) }
                            ), in: -50...50, step: 1)
                            Text("Adjusts sensitivity relative to baseline")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }

                        // Manual threshold override
                        VStack(alignment: .leading, spacing: 8) {
                            Toggle("Manual Threshold Override", isOn: Binding(
                                get: { settings.overrideThreshold != nil },
                                set: { enabled in
                                    if enabled {
                                        viewModel.calibrationSettings?.overrideThreshold = settings.currentThreshold
                                    } else {
                                        viewModel.calibrationSettings?.overrideThreshold = nil
                                    }
                                }
                            ))

                            if let override = settings.overrideThreshold {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text("Override Value")
                                            .foregroundStyle(.secondary)
                                        Spacer()
                                        Text("\(override)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Slider(value: Binding(
                                        get: { Double(override) },
                                        set: { viewModel.calibrationSettings?.overrideThreshold = Int($0) }
                                    ), in: 0...1000, step: 10)
                                }
                            }
                        }

                        // Action buttons
                        HStack(spacing: 12) {
                            Button {
                                Task {
                                    await viewModel.recalibrate(deviceId: deviceId)
                                }
                            } label: {
                                HStack {
                                    if viewModel.isRecalibrating {
                                        ProgressView()
                                            .tint(.orange)
                                    } else {
                                        Image(systemName: "arrow.clockwise")
                                    }
                                    Text("Recalibrate")
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Color.orange.opacity(0.2))
                                .foregroundStyle(.orange)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .disabled(viewModel.isRecalibrating)

                            Button {
                                Task {
                                    await viewModel.saveCalibrationSettings(deviceId: deviceId)
                                }
                            } label: {
                                HStack {
                                    if viewModel.isSavingCalibration {
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
                            .disabled(viewModel.isSavingCalibration)
                        }
                    }
                    .padding()
                    .font(.subheadline)
                } else if viewModel.calibrationError != nil {
                    VStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title2)
                            .foregroundStyle(.orange)
                        Text(viewModel.calibrationError ?? "Failed to load settings")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button("Retry") {
                            Task {
                                await viewModel.loadCalibrationSettings(deviceId: deviceId)
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
