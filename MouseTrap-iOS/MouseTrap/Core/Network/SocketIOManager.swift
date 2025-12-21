import Foundation
import Combine

// Full Socket.IO implementation
// Requires: .package(url: "https://github.com/socketio/socket.io-client-swift", from: "16.0.0")

#if canImport(SocketIO)
import SocketIO

@MainActor
class SocketIOManager: ObservableObject {
    static let shared = SocketIOManager()

    @Published var isConnected = false
    @Published var lastDeviceUpdate: DeviceStatusEvent?
    @Published var lastAlert: AlertEvent?
    @Published var lastSnapshot: SnapshotEvent?

    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private var currentTenantId: String?

    private let serverURL = "http://192.168.133.110:4000"

    private init() {}

    func connect(tenantId: String) {
        disconnect() // Clean up any existing connection

        currentTenantId = tenantId

        var config: SocketIOClientConfiguration = [
            .log(false),
            .compress,
            .forceWebsockets(true),
            .reconnects(true),
            .reconnectWait(2),
            .reconnectAttempts(10)
        ]

        // Add auth token if available
        if let token = KeychainService.shared.getAccessToken() {
            config.insert(.extraHeaders(["Authorization": "Bearer \(token)"]))
        }

        manager = SocketManager(socketURL: URL(string: serverURL)!, config: config)
        socket = manager?.defaultSocket

        setupEventHandlers()

        socket?.connect()
    }

    func disconnect() {
        socket?.disconnect()
        socket = nil
        manager = nil
        isConnected = false
        currentTenantId = nil
    }

    private func setupEventHandlers() {
        guard let socket = socket else { return }

        // Connection events
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            Task { @MainActor in
                self?.isConnected = true
                print("[SocketIO] Connected")

                // Join tenant room
                if let tenantId = self?.currentTenantId {
                    self?.socket?.emit("join:tenant", tenantId)
                }
            }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            Task { @MainActor in
                self?.isConnected = false
                print("[SocketIO] Disconnected")
            }
        }

        socket.on(clientEvent: .error) { _, args in
            print("[SocketIO] Error: \(args)")
        }

        // Device events
        socket.on("device:status") { [weak self] data, _ in
            Task { @MainActor in
                self?.handleDeviceStatus(data)
            }
        }

        socket.on("device:update") { [weak self] data, _ in
            Task { @MainActor in
                self?.handleDeviceStatus(data)
            }
        }

        socket.on("device:online") { [weak self] data, _ in
            Task { @MainActor in
                self?.handleDeviceOnline(data)
            }
        }

        socket.on("device:offline") { [weak self] data, _ in
            Task { @MainActor in
                self?.handleDeviceOffline(data)
            }
        }

        // Alert events
        socket.on("device:alert") { [weak self] data, _ in
            Task { @MainActor in
                self?.handleAlert(data)
            }
        }

        socket.on("alert:new") { [weak self] data, _ in
            Task { @MainActor in
                self?.handleAlert(data)
            }
        }

        socket.on("alert:resolved") { [weak self] data, _ in
            Task { @MainActor in
                self?.handleAlertResolved(data)
            }
        }

        // Snapshot events
        socket.on("snapshot") { [weak self] data, _ in
            Task { @MainActor in
                self?.handleSnapshot(data)
            }
        }
    }

    // MARK: - Event Handlers

    private func handleDeviceStatus(_ data: [Any]) {
        guard let dict = data.first as? [String: Any] else { return }

        lastDeviceUpdate = DeviceStatusEvent(
            macAddress: dict["macAddress"] as? String ?? dict["mac_address"] as? String ?? "",
            status: dict["status"] as? String ?? "",
            online: dict["online"] as? Bool,
            timestamp: Date()
        )
    }

    private func handleDeviceOnline(_ data: [Any]) {
        guard let dict = data.first as? [String: Any] else { return }

        lastDeviceUpdate = DeviceStatusEvent(
            macAddress: dict["macAddress"] as? String ?? "",
            status: "online",
            online: true,
            timestamp: Date()
        )
    }

    private func handleDeviceOffline(_ data: [Any]) {
        guard let dict = data.first as? [String: Any] else { return }

        lastDeviceUpdate = DeviceStatusEvent(
            macAddress: dict["macAddress"] as? String ?? "",
            status: "offline",
            online: false,
            timestamp: Date()
        )
    }

    private func handleAlert(_ data: [Any]) {
        guard let dict = data.first as? [String: Any] else { return }

        lastAlert = AlertEvent(
            id: dict["id"] as? String ?? "",
            deviceId: dict["deviceId"] as? String ?? dict["device_id"] as? String,
            severity: dict["severity"] as? String ?? "medium",
            message: dict["message"] as? String ?? "",
            timestamp: Date()
        )
    }

    private func handleAlertResolved(_ data: [Any]) {
        // Could notify UI that an alert was resolved
        print("[SocketIO] Alert resolved: \(data)")
    }

    private func handleSnapshot(_ data: [Any]) {
        guard let dict = data.first as? [String: Any] else { return }

        lastSnapshot = SnapshotEvent(
            macAddress: dict["macAddress"] as? String ?? dict["mac_address"] as? String ?? "",
            imageData: dict["imageData"] as? String ?? dict["image_data"] as? String ?? "",
            timestamp: Date()
        )
    }

    // MARK: - Public Methods

    func switchTenant(_ tenantId: String) {
        if let oldTenant = currentTenantId {
            socket?.emit("leave:tenant", oldTenant)
        }
        currentTenantId = tenantId
        socket?.emit("join:tenant", tenantId)
    }

    func requestSnapshot(macAddress: String) {
        socket?.emit("request:snapshot", ["macAddress": macAddress])
    }
}

#else

// Fallback when Socket.IO is not available - uses basic WebSocket
@MainActor
class SocketIOManager: ObservableObject {
    static let shared = SocketIOManager()

    @Published var isConnected = false
    @Published var lastDeviceUpdate: DeviceStatusEvent?
    @Published var lastAlert: AlertEvent?
    @Published var lastSnapshot: SnapshotEvent?

    private let webSocketManager = WebSocketManager()
    private var cancellables = Set<AnyCancellable>()

    private init() {
        // Observe WebSocketManager's isConnected and forward to our published property
        webSocketManager.$isConnected
            .receive(on: DispatchQueue.main)
            .assign(to: &$isConnected)

        // Forward device updates
        webSocketManager.$lastDeviceUpdate
            .receive(on: DispatchQueue.main)
            .assign(to: &$lastDeviceUpdate)

        // Forward alerts
        webSocketManager.$lastAlert
            .receive(on: DispatchQueue.main)
            .assign(to: &$lastAlert)

        // Forward snapshots
        webSocketManager.$lastSnapshot
            .receive(on: DispatchQueue.main)
            .assign(to: &$lastSnapshot)
    }

    func connect(tenantId: String) {
        webSocketManager.connect(tenantId: tenantId)
    }

    func disconnect() {
        webSocketManager.disconnect()
    }

    func switchTenant(_ tenantId: String) {
        disconnect()
        connect(tenantId: tenantId)
    }

    func requestSnapshot(macAddress: String) {
        // Not supported without full Socket.IO
    }
}

#endif
