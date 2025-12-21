// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MouseTrap",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(
            name: "MouseTrap",
            targets: ["MouseTrap"]
        ),
    ],
    dependencies: [
        // Socket.IO client for real-time WebSocket communication
        .package(url: "https://github.com/socketio/socket.io-client-swift", from: "16.0.0"),
    ],
    targets: [
        .target(
            name: "MouseTrap",
            dependencies: [
                .product(name: "SocketIO", package: "socket.io-client-swift"),
            ],
            path: "MouseTrap"
        ),
    ]
)
