import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var showingLogoutConfirm = false
    @State private var showingTenantSwitcher = false

    var body: some View {
        NavigationStack {
            List {
                // Profile Section
                Section {
                    if let user = authManager.currentUser {
                        HStack(spacing: 12) {
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 50))
                                .foregroundStyle(.blue)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(user.email)
                                    .font(.headline)

                                if user.twoFactorEnabled {
                                    HStack(spacing: 4) {
                                        Image(systemName: "lock.shield")
                                        Text("2FA Enabled")
                                    }
                                    .font(.caption)
                                    .foregroundStyle(.green)
                                }
                            }
                        }
                        .padding(.vertical, 8)
                    }
                }

                // Tenant Section
                Section("Organization") {
                    if let tenant = authManager.currentTenant {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(tenant.tenantName)
                                    .font(.headline)
                                Text(tenant.role.displayName)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }

                    if let tenants = authManager.currentUser?.tenants, tenants.count > 1 {
                        Button {
                            showingTenantSwitcher = true
                        } label: {
                            HStack {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                Text("Switch Organization")
                                Spacer()
                                Text("\(tenants.count) available")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                // Account Section
                Section("Account") {
                    NavigationLink {
                        ChangePasswordView()
                    } label: {
                        Label("Change Password", systemImage: "key")
                    }

                    NavigationLink {
                        NotificationSettingsView()
                    } label: {
                        Label("Notifications", systemImage: "bell")
                    }

                    NavigationLink {
                        EmergencyContactsView()
                    } label: {
                        Label("Emergency Contacts", systemImage: "person.2.fill")
                    }
                }

                // About Section
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        Text("Build")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
                            .foregroundStyle(.secondary)
                    }
                }

                // Logout Section
                Section {
                    Button(role: .destructive) {
                        showingLogoutConfirm = true
                    } label: {
                        HStack {
                            Spacer()
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                            Spacer()
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .alert("Sign Out?", isPresented: $showingLogoutConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Sign Out", role: .destructive) {
                    authManager.logout()
                }
            } message: {
                Text("You will need to sign in again to access your devices.")
            }
            .sheet(isPresented: $showingTenantSwitcher) {
                TenantSwitcherView()
            }
        }
    }
}

struct TenantSwitcherView: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let tenants = authManager.currentUser?.tenants {
                    ForEach(tenants) { tenant in
                        Button {
                            Task {
                                await authManager.switchTenant(tenant)
                                dismiss()
                            }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(tenant.tenantName)
                                        .font(.headline)
                                        .foregroundStyle(.primary)
                                    Text(tenant.role.displayName)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                Spacer()

                                if tenant.tenantId == authManager.currentTenant?.tenantId {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.blue)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Switch Organization")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .overlay {
                if authManager.isLoading {
                    ProgressView()
                        .background(Color(.systemBackground).opacity(0.8))
                }
            }
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(AuthManager())
}
