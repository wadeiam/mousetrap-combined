import SwiftUI

/// Banner displayed when the app cannot reach the server
/// Critical for animal welfare - users must know when monitoring is down
struct ServerConnectivityBanner: View {
    let lastAttempt: Date?
    var lanReachableCount: Int = 0
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "exclamationmark.icloud.fill")
                    .font(.title)
                    .foregroundStyle(.white)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Server Unreachable")
                        .font(.headline)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)

                    Text("Trap monitoring is offline. You will NOT receive alerts.")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.9))

                    if lanReachableCount > 0 {
                        Text("\(lanReachableCount) device\(lanReachableCount == 1 ? "" : "s") accessible on your local network")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }

                Spacer()
            }

            HStack {
                if let lastAttempt = lastAttempt {
                    Text("Last attempt: \(lastAttempt, style: .relative) ago")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.7))
                }

                Spacer()

                Button {
                    onRetry()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise")
                        Text("Retry")
                    }
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.white)
                    .clipShape(Capsule())
                }
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.red)
        )
        .padding(.horizontal)
    }
}

#Preview {
    VStack {
        ServerConnectivityBanner(
            lastAttempt: Date().addingTimeInterval(-120),
            onRetry: {}
        )

        ServerConnectivityBanner(
            lastAttempt: nil,
            onRetry: {}
        )
    }
    .background(Color(.systemGray6))
}
