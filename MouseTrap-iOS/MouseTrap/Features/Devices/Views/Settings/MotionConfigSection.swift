import SwiftUI

struct MotionConfigSection: View {
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
                    if isExpanded && viewModel.motionConfig == nil {
                        Task {
                            await viewModel.loadMotionConfig(deviceId: deviceId)
                        }
                    }
                }
            } label: {
                HStack {
                    Image(systemName: "waveform.path.ecg")
                        .foregroundStyle(.cyan)
                        .frame(width: 24)
                    Text("Motion Detection")
                        .font(.headline)
                    Spacer()
                    if viewModel.isLoadingMotion {
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

                if let config = viewModel.motionConfig {
                    VStack(spacing: 16) {
                        // Threshold slider
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Detection Threshold")
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(config.threshold)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Slider(value: Binding(
                                get: { Double(config.threshold) },
                                set: { viewModel.motionConfig?.threshold = Int($0) }
                            ), in: 5...100, step: 1)
                            Text("Lower = more sensitive to motion")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }

                        // Min size slider
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Minimum Size")
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(String(format: "%.1f%%", config.minSize * 100))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Slider(value: Binding(
                                get: { config.minSize },
                                set: { viewModel.motionConfig?.minSize = $0 }
                            ), in: 0.001...0.1, step: 0.001)
                            Text("Ignore motion smaller than this % of frame")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }

                        // Max size slider
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Maximum Size")
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(String(format: "%.0f%%", config.maxSize * 100))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Slider(value: Binding(
                                get: { config.maxSize },
                                set: { viewModel.motionConfig?.maxSize = $0 }
                            ), in: 0.1...1.0, step: 0.05)
                            Text("Ignore motion larger than this (filters lighting changes)")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }

                        // Visual size indicator
                        VStack(spacing: 8) {
                            Text("Detection Size Range")
                                .font(.caption2)
                                .foregroundStyle(.secondary)

                            GeometryReader { geometry in
                                let width = geometry.size.width
                                let minX = width * CGFloat(config.minSize)
                                let maxX = width * CGFloat(config.maxSize)

                                ZStack(alignment: .leading) {
                                    // Background
                                    Rectangle()
                                        .fill(Color(.systemGray5))
                                        .frame(height: 20)

                                    // Active range
                                    Rectangle()
                                        .fill(Color.cyan.opacity(0.5))
                                        .frame(width: maxX - minX, height: 20)
                                        .offset(x: minX)

                                    // Labels
                                    HStack {
                                        Text("Small")
                                            .font(.caption2)
                                            .padding(.leading, 4)
                                        Spacer()
                                        Text("Large")
                                            .font(.caption2)
                                            .padding(.trailing, 4)
                                    }
                                    .foregroundStyle(.secondary)
                                }
                            }
                            .frame(height: 20)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        }

                        // Apply button
                        Button {
                            Task {
                                await viewModel.saveMotionConfig(deviceId: deviceId)
                            }
                        } label: {
                            HStack {
                                if viewModel.isSavingMotion {
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
                        .disabled(viewModel.isSavingMotion)
                    }
                    .padding()
                    .font(.subheadline)
                } else if viewModel.motionError != nil {
                    VStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title2)
                            .foregroundStyle(.orange)
                        Text(viewModel.motionError ?? "Failed to load config")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button("Retry") {
                            Task {
                                await viewModel.loadMotionConfig(deviceId: deviceId)
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
