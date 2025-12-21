import SwiftUI

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: icon)
                .font(.system(size: 60))
                .foregroundStyle(.secondary)

            VStack(spacing: 8) {
                Text(title)
                    .font(.headline)

                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if let actionTitle = actionTitle, let action = action {
                Button(action: action) {
                    Text(actionTitle)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.blue)
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// Preset empty states
extension EmptyStateView {
    static var noDevices: EmptyStateView {
        EmptyStateView(
            icon: "sensor.fill",
            title: "No Devices",
            message: "You haven't added any devices yet. Add a device to start monitoring."
        )
    }

    static var noAlerts: EmptyStateView {
        EmptyStateView(
            icon: "bell.slash",
            title: "No Alerts",
            message: "You're all caught up! No alerts to show."
        )
    }

    static var noResults: EmptyStateView {
        EmptyStateView(
            icon: "magnifyingglass",
            title: "No Results",
            message: "No items match your search criteria."
        )
    }

    static var offline: EmptyStateView {
        EmptyStateView(
            icon: "wifi.slash",
            title: "You're Offline",
            message: "Check your internet connection and try again."
        )
    }
}

#Preview {
    EmptyStateView.noDevices
}
