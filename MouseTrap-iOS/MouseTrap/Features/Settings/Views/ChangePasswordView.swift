import SwiftUI

struct ChangePasswordView: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) var dismiss

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isLoading = false
    @State private var error: String?
    @State private var showSuccess = false

    var body: some View {
        Form {
            Section {
                SecureField("Current Password", text: $currentPassword)
            } header: {
                Text("Current Password")
            }

            Section {
                SecureField("New Password", text: $newPassword)
                SecureField("Confirm Password", text: $confirmPassword)
            } header: {
                Text("New Password")
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    PasswordRequirement(
                        text: "At least 8 characters",
                        isMet: newPassword.count >= 8
                    )
                    PasswordRequirement(
                        text: "Contains uppercase letter",
                        isMet: newPassword.contains(where: { $0.isUppercase })
                    )
                    PasswordRequirement(
                        text: "Contains lowercase letter",
                        isMet: newPassword.contains(where: { $0.isLowercase })
                    )
                    PasswordRequirement(
                        text: "Contains number",
                        isMet: newPassword.contains(where: { $0.isNumber })
                    )
                    PasswordRequirement(
                        text: "Passwords match",
                        isMet: !newPassword.isEmpty && newPassword == confirmPassword
                    )
                }
            }

            if let error = error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Button {
                    Task {
                        await changePassword()
                    }
                } label: {
                    HStack {
                        Spacer()
                        if isLoading {
                            ProgressView()
                        } else {
                            Text("Change Password")
                        }
                        Spacer()
                    }
                }
                .disabled(!isFormValid || isLoading)
            }
        }
        .navigationTitle("Change Password")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Password Changed", isPresented: $showSuccess) {
            Button("OK") {
                dismiss()
            }
        } message: {
            Text("Your password has been updated successfully.")
        }
    }

    private var isFormValid: Bool {
        !currentPassword.isEmpty &&
        newPassword.count >= 8 &&
        newPassword.contains(where: { $0.isUppercase }) &&
        newPassword.contains(where: { $0.isLowercase }) &&
        newPassword.contains(where: { $0.isNumber }) &&
        newPassword == confirmPassword
    }

    private func changePassword() async {
        isLoading = true
        error = nil

        do {
            try await authManager.changePassword(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
            showSuccess = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }

        isLoading = false
    }
}

struct PasswordRequirement: View {
    let text: String
    let isMet: Bool

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: isMet ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isMet ? .green : .secondary)
                .font(.caption2)
            Text(text)
                .font(.caption)
                .foregroundStyle(isMet ? .primary : .secondary)
        }
    }
}

#Preview {
    NavigationStack {
        ChangePasswordView()
    }
    .environmentObject(AuthManager())
}
