import SwiftUI

struct AlertHeroSection: View {
    let alerts: [Alert]
    let onAcknowledge: (String) async -> Void
    let onResolve: (String) async -> Void

    @State private var processingAlertId: String?
    @State private var isFlashing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Flashing header banner
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                Text("\(alerts.count) ACTIVE ALERT\(alerts.count == 1 ? "" : "S")")
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundStyle(.white)
                Spacer()
                Image(systemName: "bell.badge.fill")
                    .font(.title3)
                    .foregroundStyle(.white)
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.red)
                    .opacity(isFlashing ? 1.0 : 0.7)
            )
            .padding(.horizontal)

            // Alert cards
            VStack(spacing: 10) {
                ForEach(sortedAlerts) { alert in
                    AlertHeroCard(
                        alert: alert,
                        isProcessing: processingAlertId == alert.id,
                        onAcknowledge: {
                            processingAlertId = alert.id
                            await onAcknowledge(alert.id)
                            processingAlertId = nil
                        },
                        onResolve: {
                            processingAlertId = alert.id
                            await onResolve(alert.id)
                            processingAlertId = nil
                        }
                    )
                }
            }
            .padding(.horizontal)
        }
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.red.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.red.opacity(0.3), lineWidth: 2)
                )
        )
        .padding(.horizontal)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                isFlashing = true
            }
        }
    }

    // Sort by severity (critical first) then by time (newest first)
    private var sortedAlerts: [Alert] {
        alerts.sorted { first, second in
            let priority1 = severityPriority(first.severity)
            let priority2 = severityPriority(second.severity)

            if priority1 != priority2 {
                return priority1 < priority2
            }

            return first.createdAt > second.createdAt
        }
    }

    private func severityPriority(_ severity: AlertSeverity) -> Int {
        switch severity {
        case .critical: return 0
        case .high: return 1
        case .medium: return 2
        case .low: return 3
        }
    }
}

struct AlertHeroCard: View {
    let alert: Alert
    let isProcessing: Bool
    let onAcknowledge: () async -> Void
    let onResolve: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Alert header
            HStack(spacing: 10) {
                Image(systemName: alert.severity.icon)
                    .font(.title3)
                    .foregroundStyle(severityColor)

                VStack(alignment: .leading, spacing: 2) {
                    // Device name and location
                    Text(deviceDisplayName)
                        .font(.subheadline)
                        .fontWeight(.semibold)

                    // Alert type
                    Text(alertTypeText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                // Time
                Text(alert.createdAt, style: .relative)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            // Message
            if !alert.message.isEmpty {
                Text(alert.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            // Action buttons
            HStack(spacing: 12) {
                if !alert.isAcknowledged {
                    Button {
                        Task { await onAcknowledge() }
                    } label: {
                        HStack(spacing: 4) {
                            if isProcessing {
                                ProgressView()
                                    .scaleEffect(0.7)
                            } else {
                                Image(systemName: "hand.raised")
                            }
                            Text("Acknowledge")
                        }
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.orange)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .disabled(isProcessing)
                } else {
                    Text("Acknowledged")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.orange.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                Button {
                    Task { await onResolve() }
                } label: {
                    HStack(spacing: 4) {
                        if isProcessing {
                            ProgressView()
                                .scaleEffect(0.7)
                        } else {
                            Image(systemName: "checkmark.circle")
                        }
                        Text("Resolve")
                    }
                    .font(.caption)
                    .fontWeight(.medium)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.green)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .disabled(isProcessing)

                Spacer()
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(severityColor.opacity(0.3), lineWidth: 1)
        )
    }

    private var deviceDisplayName: String {
        if let name = alert.deviceName {
            return name
        }
        if let location = alert.location {
            return location
        }
        return alert.macAddress ?? "Unknown Device"
    }

    private var alertTypeText: String {
        alert.type
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    private var severityColor: Color {
        switch alert.severity {
        case .critical: return .red
        case .high: return .orange
        case .medium: return .yellow
        case .low: return .blue
        }
    }
}

#Preview {
    ScrollView {
        AlertHeroSection(
            alerts: [
                Alert(
                    id: "1",
                    deviceId: "dev-1",
                    tenantId: "tenant-1",
                    tenantName: "Demo Tenant",
                    type: "trap_triggered",
                    severity: .critical,
                    message: "Motion detected in trap",
                    isAcknowledged: false,
                    acknowledgedAt: nil,
                    acknowledgedBy: nil,
                    isResolved: false,
                    resolvedAt: nil,
                    resolvedBy: nil,
                    resolvedNotes: nil,
                    createdAt: Date().addingTimeInterval(-300),
                    macAddress: "AA:BB:CC:DD:EE:FF",
                    location: "Kitchen",
                    deviceName: "Kitchen Trap"
                ),
                Alert(
                    id: "2",
                    deviceId: "dev-2",
                    tenantId: "tenant-1",
                    tenantName: nil,
                    type: "trap_triggered",
                    severity: .high,
                    message: "Motion detected",
                    isAcknowledged: true,
                    acknowledgedAt: Date(),
                    acknowledgedBy: "user-1",
                    isResolved: false,
                    resolvedAt: nil,
                    resolvedBy: nil,
                    resolvedNotes: nil,
                    createdAt: Date().addingTimeInterval(-720),
                    macAddress: nil,
                    location: "Garage",
                    deviceName: "Garage Trap"
                )
            ],
            onAcknowledge: { _ in },
            onResolve: { _ in }
        )
    }
    .background(Color(.systemGray6))
}
