// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "opchain-keychain-helper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "opchain-keychain-helper", targets: ["opchain-keychain-helper"])
    ],
    targets: [
        .executableTarget(
            name: "opchain-keychain-helper",
            swiftSettings: [
                .unsafeFlags(["-strict-concurrency=complete"]),
                .unsafeFlags(["-warnings-as-errors"])
            ]
        )
    ]
)
