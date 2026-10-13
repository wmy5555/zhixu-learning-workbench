// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ZhixuStorage", platforms: [.macOS(.v12), .iOS(.v15)],
    products: [.library(name: "ZhixuStorage", targets: ["ZhixuStorage"])],
    targets: [.target(name: "ZhixuStorage"), .testTarget(name: "ZhixuStorageTests", dependencies: ["ZhixuStorage"])])
