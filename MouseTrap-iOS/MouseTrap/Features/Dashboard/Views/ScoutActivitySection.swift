import SwiftUI

struct ScoutActivitySection: View {
    let scoutStats: ScoutStats
    let recentEvents: [MotionEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Section header
            HStack {
                Image(systemName: "video.fill")
                    .foregroundStyle(.cyan)
                Text("Scout Activity")
                    .font(.headline)
                Spacer()
                Text("\(scoutStats.online)/\(scoutStats.total) online")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)

            if recentEvents.isEmpty {
                // Empty state
                VStack(spacing: 12) {
                    Image(systemName: "eye.slash")
                        .font(.largeTitle)
                        .foregroundStyle(.tertiary)
                    Text("No recent motion events")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("Scouts are monitoring for activity")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            } else {
                // Motion event list
                VStack(spacing: 8) {
                    ForEach(recentEvents.prefix(5)) { event in
                        MotionEventRow(event: event)
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding(.vertical)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }
}

// MARK: - Motion Event Row

struct MotionEventRow: View {
    let event: MotionEvent

    var body: some View {
        HStack(spacing: 12) {
            // Classification icon
            Image(systemName: event.classificationIcon)
                .font(.title3)
                .frame(width: 28)
                .foregroundStyle(iconColor)

            // Event details
            VStack(alignment: .leading, spacing: 2) {
                Text(event.deviceName ?? "Unknown Device")
                    .font(.subheadline)
                    .fontWeight(.medium)

                HStack(spacing: 4) {
                    Text(event.classification.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text("•")
                        .font(.caption)
                        .foregroundStyle(.tertiary)

                    Text("\(Int(event.confidence * 100))%")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let location = event.location {
                        Text("•")
                            .font(.caption)
                            .foregroundStyle(.tertiary)

                        Text(location)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }
            }

            Spacer()

            // Time ago
            Text(timeAgo(from: event.classifiedAt))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 12)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var iconColor: Color {
        switch event.classification.lowercased() {
        case "rodent", "mouse", "rat":
            return .red
        case "pet", "cat", "dog":
            return .orange
        case "person", "human":
            return .blue
        default:
            return .secondary
        }
    }

    private func timeAgo(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)

        if interval < 60 {
            return "Just now"
        } else if interval < 3600 {
            let minutes = Int(interval / 60)
            return "\(minutes)m ago"
        } else if interval < 86400 {
            let hours = Int(interval / 3600)
            return "\(hours)h ago"
        } else {
            let days = Int(interval / 86400)
            return "\(days)d ago"
        }
    }
}

// MARK: - Preview

#Preview {
    ScrollView {
        VStack(spacing: 20) {
            // With events
            ScoutActivitySection(
                scoutStats: ScoutStats(total: 3, online: 2),
                recentEvents: [
                    MotionEvent(
                        id: "1",
                        classification: "rodent",
                        confidence: 0.92,
                        classifiedAt: Date().addingTimeInterval(-300),
                        deviceId: "device-1",
                        deviceName: "Front Door Scout",
                        location: "Entry Point"
                    ),
                    MotionEvent(
                        id: "2",
                        classification: "pet",
                        confidence: 0.78,
                        classifiedAt: Date().addingTimeInterval(-3600),
                        deviceId: "device-2",
                        deviceName: "Garage Scout",
                        location: nil
                    ),
                    MotionEvent(
                        id: "3",
                        classification: "unknown",
                        confidence: 0.45,
                        classifiedAt: Date().addingTimeInterval(-86400),
                        deviceId: "device-3",
                        deviceName: "Basement Scout",
                        location: "Basement"
                    )
                ]
            )

            // Empty state
            ScoutActivitySection(
                scoutStats: ScoutStats(total: 1, online: 1),
                recentEvents: []
            )
        }
    }
    .background(Color(.systemGray6))
}
