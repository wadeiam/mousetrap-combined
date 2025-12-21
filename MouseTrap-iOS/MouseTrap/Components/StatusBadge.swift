import SwiftUI

struct StatusBadge: View {
    let status: DeviceStatus

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)

            Text(status.rawValue.capitalized)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(statusColor.opacity(0.15))
        .clipShape(Capsule())
    }

    private var statusColor: Color {
        switch status {
        case .online: return .green
        case .offline: return .gray
        case .alerting: return .red
        case .error: return .red
        case .maintenance: return .orange
        }
    }
}

struct SeverityBadge: View {
    let severity: AlertSeverity

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: severity.icon)
                .font(.caption2)

            Text(severity.rawValue.capitalized)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(severityColor.opacity(0.15))
        .foregroundStyle(severityColor)
        .clipShape(Capsule())
    }

    private var severityColor: Color {
        switch severity {
        case .critical: return .red
        case .high: return .orange
        case .medium: return .yellow
        case .low: return .blue
        }
    }
}

struct ConnectionBadge: View {
    let isConnected: Bool

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(isConnected ? Color.green : Color.red)
                .frame(width: 6, height: 6)

            Text(isConnected ? "Live" : "Offline")
                .font(.caption2)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(isConnected ? Color.green.opacity(0.15) : Color.red.opacity(0.15))
        .foregroundStyle(isConnected ? .green : .red)
        .clipShape(Capsule())
    }
}

#Preview {
    VStack(spacing: 20) {
        HStack {
            StatusBadge(status: .online)
            StatusBadge(status: .offline)
            StatusBadge(status: .error)
        }

        HStack {
            SeverityBadge(severity: .critical)
            SeverityBadge(severity: .high)
            SeverityBadge(severity: .medium)
            SeverityBadge(severity: .low)
        }

        HStack {
            ConnectionBadge(isConnected: true)
            ConnectionBadge(isConnected: false)
        }
    }
}
