// swift-tools-version: 6.0
import PackageDescription

// KathaKit — pure, platform-agnostic value logic shared by the iOS app's feature
// modules. It holds NO business authority (the server owns prices and entitlements);
// it only powers optimistic UI and display formatting, mirroring the backend ledger.
let package = Package(
    name: "KathaKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "KathaKit", targets: ["KathaKit"]),
    ],
    targets: [
        .target(name: "KathaKit"),
        .testTarget(name: "KathaKitTests", dependencies: ["KathaKit"]),
    ]
)
