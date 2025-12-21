import SwiftUI

struct EmergencyContactsView: View {
    @StateObject private var viewModel = EmergencyContactsViewModel()
    @State private var showingAddContact = false

    var body: some View {
        List {
            Section {
                ForEach(viewModel.contacts) { contact in
                    EmergencyContactRow(contact: contact, viewModel: viewModel)
                }
                .onDelete { indexSet in
                    Task {
                        for index in indexSet {
                            await viewModel.deleteContact(viewModel.contacts[index])
                        }
                    }
                }

                Button {
                    showingAddContact = true
                } label: {
                    Label("Add Contact", systemImage: "plus")
                }
            } header: {
                Text("Emergency Contacts")
            } footer: {
                Text("Contacts will be notified based on their escalation level when alerts are not acknowledged.")
            }

            if !viewModel.contacts.isEmpty {
                Section("Escalation Order") {
                    ForEach(1...5, id: \.self) { level in
                        let contactsAtLevel = viewModel.contacts.filter { $0.escalationLevel == level }
                        if !contactsAtLevel.isEmpty {
                            HStack {
                                Text("Level \(level)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .frame(width: 60, alignment: .leading)
                                Text(contactsAtLevel.map { $0.name }.joined(separator: ", "))
                                    .font(.caption)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Emergency Contacts")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadContacts()
        }
        .sheet(isPresented: $showingAddContact) {
            AddEmergencyContactView(viewModel: viewModel)
        }
        .overlay {
            if viewModel.isLoading && viewModel.contacts.isEmpty {
                ProgressView()
            }
        }
    }
}

struct EmergencyContactRow: View {
    let contact: EmergencyContact
    @ObservedObject var viewModel: EmergencyContactsViewModel
    @State private var showingEdit = false

    var body: some View {
        Button {
            showingEdit = true
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(contact.name)
                        .font(.headline)
                        .foregroundStyle(.primary)

                    Text(contact.value)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 8) {
                        Label(contact.contactType.displayName, systemImage: contact.contactType.icon)
                        Text("Level \(contact.escalationLevel)")
                    }
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                }

                Spacer()

                if !contact.isEnabled {
                    Text("Disabled")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
        }
        .sheet(isPresented: $showingEdit) {
            EditEmergencyContactView(contact: contact, viewModel: viewModel)
        }
    }
}

struct AddEmergencyContactView: View {
    @ObservedObject var viewModel: EmergencyContactsViewModel
    @Environment(\.dismiss) var dismiss

    @State private var name = ""
    @State private var contactType: ContactType = .email
    @State private var value = ""
    @State private var escalationLevel = 2

    var body: some View {
        NavigationStack {
            Form {
                Section("Contact Info") {
                    TextField("Name", text: $name)

                    Picker("Type", selection: $contactType) {
                        ForEach(ContactType.allCases, id: \.self) { type in
                            Label(type.displayName, systemImage: type.icon)
                                .tag(type)
                        }
                    }

                    if contactType == .email {
                        TextField("Email Address", text: $value)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                    } else if contactType == .sms {
                        TextField("Phone Number", text: $value)
                            .keyboardType(.phonePad)
                    } else {
                        TextField("User Email", text: $value)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                    }
                }

                Section {
                    Picker("Level", selection: $escalationLevel) {
                        ForEach(1...5, id: \.self) { level in
                            Text("Level \(level)").tag(level)
                        }
                    }
                } header: {
                    Text("Escalation")
                } footer: {
                    Text("Lower levels are contacted first. Level 1 contacts are notified immediately.")
                }
            }
            .navigationTitle("Add Contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            await viewModel.addContact(
                                name: name,
                                type: contactType,
                                value: value,
                                level: escalationLevel
                            )
                            dismiss()
                        }
                    }
                    .disabled(name.isEmpty || value.isEmpty)
                }
            }
        }
    }
}

struct EditEmergencyContactView: View {
    let contact: EmergencyContact
    @ObservedObject var viewModel: EmergencyContactsViewModel
    @Environment(\.dismiss) var dismiss

    @State private var name: String
    @State private var value: String
    @State private var escalationLevel: Int
    @State private var isEnabled: Bool

    init(contact: EmergencyContact, viewModel: EmergencyContactsViewModel) {
        self.contact = contact
        self.viewModel = viewModel
        _name = State(initialValue: contact.name)
        _value = State(initialValue: contact.value)
        _escalationLevel = State(initialValue: contact.escalationLevel)
        _isEnabled = State(initialValue: contact.isEnabled)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Contact Info") {
                    TextField("Name", text: $name)

                    HStack {
                        Text("Type")
                        Spacer()
                        Label(contact.contactType.displayName, systemImage: contact.contactType.icon)
                            .foregroundStyle(.secondary)
                    }

                    TextField(contact.contactType == .email ? "Email" : "Phone", text: $value)
                }

                Section {
                    Picker("Escalation Level", selection: $escalationLevel) {
                        ForEach(1...5, id: \.self) { level in
                            Text("Level \(level)").tag(level)
                        }
                    }

                    Toggle("Enabled", isOn: $isEnabled)
                }
            }
            .navigationTitle("Edit Contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await viewModel.updateContact(
                                id: contact.id,
                                name: name,
                                value: value,
                                level: escalationLevel,
                                isEnabled: isEnabled
                            )
                            dismiss()
                        }
                    }
                    .disabled(name.isEmpty || value.isEmpty)
                }
            }
        }
    }
}

// MARK: - ViewModel

@MainActor
class EmergencyContactsViewModel: ObservableObject {
    @Published var contacts: [EmergencyContact] = []
    @Published var isLoading = false
    @Published var error: String?

    private let apiClient = APIClient.shared

    func loadContacts() async {
        isLoading = true

        do {
            struct Response: Codable {
                let success: Bool?
                let data: [EmergencyContact]?
                let contacts: [EmergencyContact]?
            }

            let response: Response = try await apiClient.get(endpoint: .emergencyContacts)
            contacts = response.data ?? response.contacts ?? []

        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }

        isLoading = false
    }

    func addContact(name: String, type: ContactType, value: String, level: Int) async {
        do {
            struct Request: Codable {
                let name: String
                let contactType: String
                let value: String
                let escalationLevel: Int

                enum CodingKeys: String, CodingKey {
                    case name
                    case contactType = "contact_type"
                    case value
                    case escalationLevel = "escalation_level"
                }
            }

            let _: EmptyResponse = try await apiClient.post(
                endpoint: .emergencyContacts,
                body: Request(
                    name: name,
                    contactType: type.rawValue,
                    value: value,
                    escalationLevel: level
                )
            )

            await loadContacts()

        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func updateContact(id: String, name: String, value: String, level: Int, isEnabled: Bool) async {
        do {
            struct Request: Codable {
                let name: String
                let value: String
                let escalationLevel: Int
                let isEnabled: Bool

                enum CodingKeys: String, CodingKey {
                    case name, value
                    case escalationLevel = "escalation_level"
                    case isEnabled = "is_enabled"
                }
            }

            let _: EmptyResponse = try await apiClient.put(
                endpoint: .emergencyContact(id: id),
                body: Request(
                    name: name,
                    value: value,
                    escalationLevel: level,
                    isEnabled: isEnabled
                )
            )

            await loadContacts()

        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func deleteContact(_ contact: EmergencyContact) async {
        do {
            let _: EmptyResponse = try await apiClient.delete(
                endpoint: .emergencyContact(id: contact.id)
            )

            contacts.removeAll { $0.id == contact.id }

        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Models

struct EmergencyContact: Codable, Identifiable {
    let id: String
    let name: String
    let contactType: ContactType
    let value: String
    let escalationLevel: Int
    let isEnabled: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, value
        case contactType = "contact_type"
        case escalationLevel = "escalation_level"
        case isEnabled = "is_enabled"
    }
}

enum ContactType: String, Codable, CaseIterable {
    case appUser = "app_user"
    case email = "email"
    case sms = "sms"

    var displayName: String {
        switch self {
        case .appUser: return "App User"
        case .email: return "Email"
        case .sms: return "SMS"
        }
    }

    var icon: String {
        switch self {
        case .appUser: return "person.fill"
        case .email: return "envelope.fill"
        case .sms: return "message.fill"
        }
    }
}

#Preview {
    NavigationStack {
        EmergencyContactsView()
    }
}
