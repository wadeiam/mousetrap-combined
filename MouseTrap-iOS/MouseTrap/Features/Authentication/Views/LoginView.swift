import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authManager: AuthManager

    @State private var email = ""
    @State private var password = ""
    @State private var totpCode = ""
    @State private var showTwoFactor = false
    @State private var showPassword = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 32) {
                    // Logo and Title
                    VStack(spacing: 16) {
                        Image(systemName: "sensor.fill")
                            .font(.system(size: 60))
                            .foregroundStyle(.blue)

                        Text("MouseTrap")
                            .font(.largeTitle)
                            .fontWeight(.bold)

                        Text("IoT Monitoring System")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 40)

                    // Login Form
                    VStack(spacing: 20) {
                        if showTwoFactor {
                            twoFactorFields
                        } else {
                            loginFields
                        }

                        // Error Message
                        if let error = authManager.error, error != "2FA_REQUIRED" {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.center)
                        }

                        // Login Button
                        Button {
                            Task {
                                await performLogin()
                            }
                        } label: {
                            HStack {
                                if authManager.isLoading {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Text(showTwoFactor ? "Verify" : "Sign In")
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(isFormValid ? Color.blue : Color.gray)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .disabled(!isFormValid || authManager.isLoading)

                        // Back button for 2FA
                        if showTwoFactor {
                            Button("Back to Login") {
                                showTwoFactor = false
                                totpCode = ""
                                authManager.error = nil
                            }
                            .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal)

                    Spacer()
                }
            }
            .navigationBarHidden(true)
        }
        .onChange(of: authManager.error) { newValue in
            if newValue == "2FA_REQUIRED" {
                showTwoFactor = true
                authManager.error = nil
            }
        }
    }

    // MARK: - View Components

    private var loginFields: some View {
        VStack(spacing: 16) {
            // Email Field
            VStack(alignment: .leading, spacing: 8) {
                Text("Email")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                TextField("Enter your email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .padding()
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            // Password Field
            VStack(alignment: .leading, spacing: 8) {
                Text("Password")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack {
                    if showPassword {
                        TextField("Enter your password", text: $password)
                    } else {
                        SecureField("Enter your password", text: $password)
                    }

                    Button {
                        showPassword.toggle()
                    } label: {
                        Image(systemName: showPassword ? "eye.slash" : "eye")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private var twoFactorFields: some View {
        VStack(spacing: 16) {
            Text("Two-Factor Authentication")
                .font(.headline)

            Text("Enter the 6-digit code from your authenticator app")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            TextField("000000", text: $totpCode)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .font(.title2.monospaced())
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .onChange(of: totpCode) { newValue in
                    // Limit to 6 digits
                    if newValue.count > 6 {
                        totpCode = String(newValue.prefix(6))
                    }
                    // Auto-submit when 6 digits entered
                    if totpCode.count == 6 {
                        Task {
                            await performLogin()
                        }
                    }
                }
        }
    }

    // MARK: - Computed Properties

    private var isFormValid: Bool {
        if showTwoFactor {
            return totpCode.count == 6
        }
        return !email.isEmpty && !password.isEmpty
    }

    // MARK: - Actions

    private func performLogin() async {
        await authManager.login(
            email: email,
            password: password,
            totpCode: showTwoFactor ? totpCode : nil
        )
    }
}

#Preview {
    LoginView()
        .environmentObject(AuthManager())
}
