import SwiftUI

struct CameraSettingsSection: View {
    let deviceId: String
    let isOnline: Bool
    @ObservedObject var viewModel: DeviceSettingsViewModel

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header - tappable to expand/collapse
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                    if isExpanded && viewModel.cameraSettings == nil {
                        Task {
                            await viewModel.loadCameraSettings(deviceId: deviceId)
                        }
                    }
                }
            } label: {
                HStack {
                    Image(systemName: "camera")
                        .foregroundStyle(.blue)
                        .frame(width: 24)
                    Text("Camera Settings")
                        .font(.headline)
                    Spacer()
                    if viewModel.isLoadingCamera {
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

                if let settings = viewModel.cameraSettings {
                    VStack(spacing: 16) {
                        // Resolution picker
                        HStack {
                            Text("Resolution")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Picker("Resolution", selection: Binding(
                                get: { settings.framesize },
                                set: { viewModel.cameraSettings?.framesize = $0 }
                            )) {
                                Text("QVGA (320x240)").tag(0)
                                Text("HVGA (480x320)").tag(3)
                                Text("VGA (640x480)").tag(5)
                                Text("SVGA (800x600)").tag(8)
                                Text("XGA (1024x768)").tag(9)
                                Text("SXGA (1280x1024)").tag(10)
                            }
                            .pickerStyle(.menu)
                        }

                        // Quality slider
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Quality")
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(settings.quality)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Slider(value: Binding(
                                get: { Double(settings.quality) },
                                set: { viewModel.cameraSettings?.quality = Int($0) }
                            ), in: 10...63, step: 1)
                            Text("Lower = better quality, larger file")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }

                        // Brightness slider
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Brightness")
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(settings.brightness)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Slider(value: Binding(
                                get: { Double(settings.brightness) },
                                set: { viewModel.cameraSettings?.brightness = Int($0) }
                            ), in: -2...2, step: 1)
                        }

                        // Contrast slider
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Contrast")
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(settings.contrast)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Slider(value: Binding(
                                get: { Double(settings.contrast) },
                                set: { viewModel.cameraSettings?.contrast = Int($0) }
                            ), in: -2...2, step: 1)
                        }

                        // Saturation slider
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Saturation")
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(settings.saturation)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Slider(value: Binding(
                                get: { Double(settings.saturation) },
                                set: { viewModel.cameraSettings?.saturation = Int($0) }
                            ), in: -2...2, step: 1)
                        }

                        // Flip/Mirror toggles
                        HStack {
                            Toggle("Vertical Flip", isOn: Binding(
                                get: { settings.vflip },
                                set: { viewModel.cameraSettings?.vflip = $0 }
                            ))
                        }

                        HStack {
                            Toggle("Horizontal Mirror", isOn: Binding(
                                get: { settings.hmirror },
                                set: { viewModel.cameraSettings?.hmirror = $0 }
                            ))
                        }

                        // Save button
                        Button {
                            Task {
                                await viewModel.saveCameraSettings(deviceId: deviceId)
                            }
                        } label: {
                            HStack {
                                if viewModel.isSavingCamera {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Image(systemName: "checkmark")
                                }
                                Text("Apply Settings")
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Color.blue)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .disabled(viewModel.isSavingCamera)
                    }
                    .padding()
                    .font(.subheadline)
                } else if viewModel.cameraError != nil {
                    VStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title2)
                            .foregroundStyle(.orange)
                        Text(viewModel.cameraError ?? "Failed to load settings")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button("Retry") {
                            Task {
                                await viewModel.loadCameraSettings(deviceId: deviceId)
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
