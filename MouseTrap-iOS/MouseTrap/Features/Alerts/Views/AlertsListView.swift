import SwiftUI

struct AlertsListView: View {
    @StateObject private var viewModel = AlertsViewModel()
    @State private var selectedSeverity: AlertSeverity?
    @State private var showResolved = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Filters
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterChip(
                            title: "All",
                            isSelected: selectedSeverity == nil,
                            action: { selectedSeverity = nil }
                        )

                        FilterChip(
                            title: "Critical",
                            isSelected: selectedSeverity == .critical,
                            color: .red,
                            action: { selectedSeverity = .critical }
                        )

                        FilterChip(
                            title: "High",
                            isSelected: selectedSeverity == .high,
                            color: .orange,
                            action: { selectedSeverity = .high }
                        )

                        FilterChip(
                            title: "Medium",
                            isSelected: selectedSeverity == .medium,
                            color: .yellow,
                            action: { selectedSeverity = .medium }
                        )

                        FilterChip(
                            title: "Low",
                            isSelected: selectedSeverity == .low,
                            color: .blue,
                            action: { selectedSeverity = .low }
                        )

                        Divider()
                            .frame(height: 20)

                        Toggle("Resolved", isOn: $showResolved)
                            .toggleStyle(.button)
                            .font(.caption)
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }
                .background(Color(.systemBackground))

                // Alert List
                if viewModel.isLoading && viewModel.alerts.isEmpty {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else if filteredAlerts.isEmpty {
                    EmptyStateView(
                        icon: "bell.slash",
                        title: "No Alerts",
                        message: "No alerts match your filters"
                    )
                } else {
                    List {
                        ForEach(filteredAlerts) { alert in
                            AlertRowView(alert: alert, viewModel: viewModel)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Alerts")
            .refreshable {
                await viewModel.loadAlerts()
            }
            .task {
                await viewModel.loadAlerts()
            }
        }
    }

    private var filteredAlerts: [Alert] {
        var alerts = viewModel.alerts

        // Filter by severity
        if let severity = selectedSeverity {
            alerts = alerts.filter { $0.severity == severity }
        }

        // Filter by resolved status
        if !showResolved {
            alerts = alerts.filter { !$0.isResolved }
        }

        return alerts
    }
}

struct AlertRowView: View {
    let alert: Alert
    @ObservedObject var viewModel: AlertsViewModel
    @State private var showingResolveSheet = false
    @State private var resolveNotes = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Image(systemName: alert.severity.icon)
                    .foregroundStyle(severityColor)

                Text(alert.type.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.headline)

                Spacer()

                if alert.isResolved {
                    Text("Resolved")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.2))
                        .foregroundStyle(.green)
                        .clipShape(Capsule())
                } else if alert.isAcknowledged {
                    Text("Acknowledged")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.2))
                        .foregroundStyle(.orange)
                        .clipShape(Capsule())
                }
            }

            // Message
            Text(alert.message)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            // Device info
            if let deviceName = alert.deviceName ?? alert.location {
                HStack {
                    Image(systemName: "sensor.fill")
                        .font(.caption)
                    Text(deviceName)
                        .font(.caption)
                }
                .foregroundStyle(.secondary)
            }

            // Time
            Text(alert.createdAt, style: .relative)
                .font(.caption)
                .foregroundStyle(.tertiary)

            // Actions
            if !alert.isResolved {
                HStack(spacing: 12) {
                    if !alert.isAcknowledged {
                        Button {
                            Task {
                                await viewModel.acknowledgeAlert(id: alert.id)
                            }
                        } label: {
                            Text("Acknowledge")
                                .font(.caption)
                                .fontWeight(.medium)
                        }
                        .buttonStyle(.bordered)
                    }

                    Button {
                        showingResolveSheet = true
                    } label: {
                        Text("Resolve")
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 4)
        .sheet(isPresented: $showingResolveSheet) {
            NavigationStack {
                Form {
                    Section("Resolution Notes") {
                        TextField("Optional notes...", text: $resolveNotes, axis: .vertical)
                            .lineLimit(3...6)
                    }
                }
                .navigationTitle("Resolve Alert")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            showingResolveSheet = false
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Resolve") {
                            Task {
                                await viewModel.resolveAlert(
                                    id: alert.id,
                                    notes: resolveNotes.isEmpty ? nil : resolveNotes
                                )
                                showingResolveSheet = false
                                resolveNotes = ""
                            }
                        }
                    }
                }
            }
            .presentationDetents([.medium])
        }
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
    AlertsListView()
}
