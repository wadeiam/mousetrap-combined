import Foundation
import Combine

// Note: This is a basic WebSocket implementation using URLSessionWebSocketTask
// For full Socket.IO compatibility, you'll need to add the Socket.IO-Client-Swift package
// via SPM: https://github.com/socketio/socket.io-client-swift

@MainActor
class WebSocketManager: ObservableObject {
    @Published var isConnected = false
    @Published var lastDeviceUpdate: DeviceStatusEvent?
    @Published var lastAlert: AlertEvent?
    @Published var lastSnapshot: SnapshotEvent?

    private var webSocketTask: URLSessionWebSocketTask?
    private var pingTimer: Timer?
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5
    private var pendingTenantId: String?
    private var handshakeComplete = false
    private var serverPingInterval: TimeInterval = 25.0

    private let baseURL = "ws://192.168.133.110:4000"

    func connect(tenantId: String) {
        disconnect() // Clean up any existing connection first

        guard let url = URL(string: "\(baseURL)/socket.io/?EIO=4&transport=websocket") else {
            print("[WebSocket] Invalid URL")
            return
        }

        pendingTenantId = tenantId
        handshakeComplete = false

        var request = URLRequest(url: url)

        // Add auth token
        if let token = KeychainService.shared.getAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        webSocketTask = URLSession.shared.webSocketTask(with: request)
        webSocketTask?.resume()

        reconnectAttempts = 0

        // Start receiving messages - handshake will complete when we get "0{...}"
        receiveMessage()

        print("[WebSocket] Connecting to tenant: \(tenantId)")
    }

    func disconnect() {
        pingTimer?.invalidate()
        pingTimer = nil

        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil

        isConnected = false
        handshakeComplete = false
        pendingTenantId = nil
        print("[WebSocket] Disconnected")
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                Task { @MainActor in
                    self?.handleMessage(message)
                    // Continue receiving
                    self?.receiveMessage()
                }

            case .failure(let error):
                print("[WebSocket] Receive error: \(error)")
                Task { @MainActor in
                    self?.handleDisconnection()
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            parseSocketIOMessage(text)
        case .data(let data):
            if let text = String(data: data, encoding: .utf8) {
                parseSocketIOMessage(text)
            }
        @unknown default:
            break
        }
    }

    private func parseSocketIOMessage(_ text: String) {
        // Socket.IO message format: "42[\"eventName\",{...data...}]"
        // Engine.IO codes: 0=open, 2=ping, 3=pong, 4=message, 40=connect, 42=event

        if text.hasPrefix("0{") || text == "0" {
            // Engine.IO open packet - parse handshake data
            handleEngineIOOpen(text)
            return
        }

        if text == "40" {
            // Socket.IO connect acknowledgment
            print("[WebSocket] Socket.IO connected")
            completeHandshake()
            return
        }

        if text == "2" {
            // Ping from server - respond with pong
            sendMessage("3")
            return
        }

        if text == "3" {
            // Pong response from server (if we sent ping)
            return
        }

        if text.hasPrefix("42") {
            // Event message
            let jsonPart = String(text.dropFirst(2))

            guard let data = jsonPart.data(using: .utf8),
                  let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
                  let eventName = array.first as? String else {
                return
            }

            let eventData = array.count > 1 ? array[1] : nil

            handleEvent(name: eventName, data: eventData)
        }
    }

    private func handleEvent(name: String, data: Any?) {
        print("[WebSocket] Event: \(name)")

        switch name {
        case "device:status", "device:update":
            if let dict = data as? [String: Any] {
                lastDeviceUpdate = DeviceStatusEvent(
                    macAddress: dict["macAddress"] as? String ?? dict["mac_address"] as? String ?? "",
                    status: dict["status"] as? String ?? "",
                    online: dict["online"] as? Bool,
                    timestamp: Date()
                )
            }

        case "device:alert", "alert:new":
            if let dict = data as? [String: Any] {
                lastAlert = AlertEvent(
                    id: dict["id"] as? String ?? "",
                    deviceId: dict["deviceId"] as? String ?? dict["device_id"] as? String,
                    severity: dict["severity"] as? String ?? "medium",
                    message: dict["message"] as? String ?? "",
                    timestamp: Date()
                )
            }

        case "snapshot":
            if let dict = data as? [String: Any] {
                lastSnapshot = SnapshotEvent(
                    macAddress: dict["macAddress"] as? String ?? dict["mac_address"] as? String ?? "",
                    imageData: dict["imageData"] as? String ?? dict["image_data"] as? String ?? "",
                    timestamp: Date()
                )
            }

        case "device:online":
            if let dict = data as? [String: Any] {
                lastDeviceUpdate = DeviceStatusEvent(
                    macAddress: dict["macAddress"] as? String ?? "",
                    status: "online",
                    online: true,
                    timestamp: Date()
                )
            }

        case "device:offline":
            if let dict = data as? [String: Any] {
                lastDeviceUpdate = DeviceStatusEvent(
                    macAddress: dict["macAddress"] as? String ?? "",
                    status: "offline",
                    online: false,
                    timestamp: Date()
                )
            }

        default:
            print("[WebSocket] Unhandled event: \(name)")
        }
    }

    private func sendMessage(_ text: String) {
        webSocketTask?.send(.string(text)) { error in
            if let error = error {
                print("[WebSocket] Send error: \(error)")
            }
        }
    }

    private func handleEngineIOOpen(_ text: String) {
        // Parse the open packet: 0{"sid":"xxx","upgrades":[],"pingInterval":25000,"pingTimeout":20000}
        print("[WebSocket] Engine.IO open received")

        if text.count > 1 {
            let jsonPart = String(text.dropFirst(1))
            if let data = jsonPart.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {

                if let pingInterval = json["pingInterval"] as? Int {
                    // Convert from milliseconds to seconds, use slightly less to be safe
                    serverPingInterval = Double(pingInterval) / 1000.0 * 0.8
                    print("[WebSocket] Server ping interval: \(pingInterval)ms, using: \(serverPingInterval)s")
                }
            }
        }

        // After Engine.IO open, Socket.IO will send "40" (connect)
        // We wait for that before considering the connection complete
    }

    private func completeHandshake() {
        guard !handshakeComplete else { return }
        handshakeComplete = true
        isConnected = true

        // Join tenant room
        if let tenantId = pendingTenantId {
            sendMessage("42[\"join:tenant\",\"\(tenantId)\"]")
            print("[WebSocket] Joined tenant: \(tenantId)")
        }

        // Start ping timer with server's interval
        startPingTimer()
    }

    private func startPingTimer() {
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: serverPingInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.sendMessage("2") // Ping
            }
        }
    }

    private func handleDisconnection() {
        isConnected = false
        handshakeComplete = false
        pingTimer?.invalidate()
        pingTimer = nil

        // Attempt reconnection
        if reconnectAttempts < maxReconnectAttempts {
            reconnectAttempts += 1
            let delay = Double(reconnectAttempts * 2)
            print("[WebSocket] Reconnecting in \(delay)s (attempt \(reconnectAttempts))")

            let tenantToReconnect = pendingTenantId ?? KeychainService.shared.getCurrentTenantId()

            Task {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                if let tenantId = tenantToReconnect {
                    connect(tenantId: tenantId)
                }
            }
        } else {
            print("[WebSocket] Max reconnection attempts reached")
            pendingTenantId = nil
        }
    }
}

// MARK: - Event Types

struct DeviceStatusEvent: Equatable {
    let macAddress: String
    let status: String
    let online: Bool?
    let timestamp: Date
}

struct AlertEvent: Equatable {
    let id: String
    let deviceId: String?
    let severity: String
    let message: String
    let timestamp: Date
}

struct SnapshotEvent: Equatable {
    let macAddress: String
    let imageData: String
    let timestamp: Date
}
