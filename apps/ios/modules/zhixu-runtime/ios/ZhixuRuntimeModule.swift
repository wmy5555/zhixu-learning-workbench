import ExpoModulesCore
import Foundation
import CryptoKit
import Security
import Darwin

private struct RuntimeError: LocalizedError {
  let code: String
  let message: String
  var errorDescription: String? { message }
}

public final class ZhixuRuntimeModule: Module {
  private let fm = FileManager.default
  private var calls: [String: PinnedCall] = [:]
  private let lock = NSLock()
  private lazy var root: String = {
    let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    var url = base.appendingPathComponent("Zhixu", isDirectory: true)
    try? fm.createDirectory(at: url, withIntermediateDirectories: true)
    try? fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
    var backup = URLResourceValues()
    backup.isExcludedFromBackup = true
    try? url.setResourceValues(backup)
    return url.path
  }()

  public func definition() -> ModuleDefinition {
    Name("ZhixuRuntime")
    Constant("root") { self.root }
    Function("uuid") { UUID().uuidString.lowercased() }
    Function("random") { (count: Int) throws -> String in
      guard count > 0 && count <= 4096 else { throw RuntimeError(code: "INVALID", message: "随机字节长度无效") }
      var bytes = [UInt8](repeating: 0, count: count)
      guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { throw RuntimeError(code: "RANDOM", message: "系统随机源不可用") }
      return Data(bytes).base64EncodedString()
    }
    Function("files") { (operation: String, input: String) -> String in
      do {
        let arguments = try JSONSerialization.jsonObject(with: Data(input.utf8)) as? [String: Any] ?? [:]
        let value = try self.files(operation, arguments)
        return self.json(["value": value])
      } catch {
        let err = error as? RuntimeError
        return self.json(["error": ["code": err?.code ?? "IO_ERROR", "message": err?.message ?? "本地文件操作失败，请保留草稿后重试。"]])
      }
    }
    Function("sealSecret") { (value: String) throws -> String in
      let box = try AES.GCM.seal(Data(value.utf8), using: self.masterKey())
      guard let combined = box.combined else { throw RuntimeError(code: "SECRET_LOCKED", message: "凭据加密失败") }
      return combined.base64EncodedString()
    }
    Function("openSecret") { (value: String) throws -> String in
      guard let data = Data(base64Encoded: value) else { throw RuntimeError(code: "SECRET_LOCKED", message: "凭据记录损坏") }
      let plaintext = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: self.masterKey())
      guard let result = String(data: plaintext, encoding: .utf8) else { throw RuntimeError(code: "SECRET_LOCKED", message: "凭据记录损坏") }
      return result
    }
    AsyncFunction("resolve") { (hostname: String) throws -> [[String: Any]] in
      guard hostname.count <= 253 && !hostname.contains("\0") else { throw RuntimeError(code: "INVALID_URL", message: "主机名无效") }
      var hints = addrinfo()
      hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM
      var head: UnsafeMutablePointer<addrinfo>?
      guard getaddrinfo(hostname, nil, &hints, &head) == 0 else { throw RuntimeError(code: "DNS_FAILED", message: "无法解析目标主机") }
      defer { if let head { freeaddrinfo(head) } }
      var node = head
      var results: [[String: Any]] = []
      while let current = node {
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(current.pointee.ai_addr, current.pointee.ai_addrlen, &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
          results.append(["address": String(cString: host), "family": current.pointee.ai_family == AF_INET ? 4 : 6])
        }
        node = current.pointee.ai_next
      }
      return results
    }
    AsyncFunction("request") { (id: String, input: String, promise: Promise) in
      do {
        let args = try JSONSerialization.jsonObject(with: Data(input.utf8)) as? [String: Any] ?? [:]
        let call = try PinnedCall(arguments: args) { result in
          self.lock.lock(); self.calls.removeValue(forKey: id); self.lock.unlock()
          promise.resolve(self.json(result))
        }
        self.lock.lock(); self.calls[id] = call; self.lock.unlock()
        call.start()
      } catch { promise.resolve(self.json(["error": ["code": "INVALID_URL", "message": "网络请求参数无效"]])) }
    }
    Function("cancel") { (id: String) in
      self.lock.lock(); let call = self.calls[id]; self.lock.unlock(); call?.cancel()
    }
    OnDestroy {
      self.lock.lock(); let pending = Array(self.calls.values); self.calls.removeAll(); self.lock.unlock()
      pending.forEach { $0.cancel() }
    }
  }

  private func json(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]), let text = String(data: data, encoding: .utf8) else { return "{\"error\":{\"code\":\"SERIALIZATION\",\"message\":\"原生结果格式无效\"}}" }
    return text
  }

  private func masterKey() throws -> SymmetricKey {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.zhixu.learning.runtime", kSecAttrAccount as String: "master-v1"]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query.merging([kSecReturnData as String: true]) { _, new in new } as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data { return SymmetricKey(data: data) }
    guard status == errSecItemNotFound else { throw RuntimeError(code: "SECRET_LOCKED", message: "Keychain 未解锁") }
    let key = SymmetricKey(size: .bits256)
    let data = key.withUnsafeBytes { Data($0) }
    let add = query.merging([kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]) { _, new in new }
    guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw RuntimeError(code: "SECRET_LOCKED", message: "无法保存设备凭据密钥") }
    return key
  }

  private func checked(_ raw: String, followLast: Bool = true) throws -> String {
    guard !raw.contains("\0") else { throw RuntimeError(code: "PATH_ESCAPE", message: "文件路径无效") }
    let path = URL(fileURLWithPath: raw).standardizedFileURL.path
    guard path == root || path.hasPrefix(root + "/") else { throw RuntimeError(code: "PATH_ESCAPE", message: "只能访问本 App 的知序目录") }
    let parts = String(path.dropFirst(root.count)).split(separator: "/")
    var current = root
    for (index, part) in parts.enumerated() {
      current += "/" + part
      var statbuf = Darwin.stat()
      if lstat(current, &statbuf) == 0 && (statbuf.st_mode & S_IFMT) == S_IFLNK && (followLast || index < parts.count - 1) {
        throw RuntimeError(code: "SYMLINK", message: "不允许通过链接访问文件")
      }
    }
    return path
  }

  private func posixError() -> RuntimeError {
    let code: String
    switch errno { case ENOENT: code="ENOENT"; case EEXIST: code="EEXIST"; case EACCES: code="EACCES"; case EBUSY: code="EBUSY"; default: code="IO_ERROR" }
    return RuntimeError(code: code, message: "本地文件操作失败（\(code)）")
  }

  private func files(_ operation: String, _ args: [String: Any]) throws -> Any {
    let path = try checked(args["path"] as? String ?? "", followLast: operation != "stat" || args["follow"] as? Bool != false)
    switch operation {
    case "exists": return fm.fileExists(atPath: path)
    case "mkdir": try fm.createDirectory(atPath: path, withIntermediateDirectories: args["recursive"] as? Bool == true); return NSNull()
    case "read": return try Data(contentsOf: URL(fileURLWithPath: path)).base64EncodedString()
    case "write":
      guard let data = Data(base64Encoded: args["data"] as? String ?? "") else { throw RuntimeError(code: "INVALID", message: "文件编码无效") }
      let flags = O_WRONLY | O_CREAT | (args["exclusive"] as? Bool == true ? O_EXCL : O_TRUNC) | O_NOFOLLOW
      let fd = Darwin.open(path, flags, S_IRUSR | S_IWUSR)
      guard fd >= 0 else { throw posixError() }; defer { Darwin.close(fd) }
      try data.withUnsafeBytes { buffer in
        var offset = 0
        while offset < buffer.count {
          let n = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
          if n < 0 && errno == EINTR { continue }
          guard n > 0 else { throw posixError() }; offset += n
        }
      }
      guard fsync(fd) == 0 else { throw posixError() }
      return NSNull()
    case "rename", "link":
      let target = try checked(args["to"] as? String ?? "")
      guard path != root && target != root else { throw RuntimeError(code: "PATH_ESCAPE", message: "不能替换根目录") }
      let code = operation == "rename" ? Darwin.rename(path, target) : Darwin.link(path, target)
      guard code == 0 else { throw posixError() }; return NSNull()
    case "unlink", "remove":
      guard path != root else { throw RuntimeError(code: "PATH_ESCAPE", message: "不能删除根目录") }
      if !fm.fileExists(atPath: path) && args["force"] as? Bool == true { return NSNull() }
      if operation == "unlink" { guard Darwin.unlink(path) == 0 else { throw posixError() } }
      else {
        var isDirectory: ObjCBool = false
        if fm.fileExists(atPath: path, isDirectory: &isDirectory) && isDirectory.boolValue && args["recursive"] as? Bool != true { throw RuntimeError(code: "EISDIR", message: "删除目录需要显式 recursive") }
        try fm.removeItem(atPath: path)
      }
      return NSNull()
    case "stat":
      var info = Darwin.stat()
      // checked() rejects symlink traversal for follow=true, so lstat is sufficient
      // and avoids Darwin's Swift struct/function stat name ambiguity.
      let code = lstat(path, &info)
      guard code == 0 else { throw posixError() }
      let kind = (info.st_mode & S_IFMT) == S_IFDIR ? "directory" : (info.st_mode & S_IFMT) == S_IFLNK ? "symlink" : "file"
      return ["kind":kind,"size":info.st_size,"nlink":info.st_nlink,"mtimeMs":Double(info.st_mtimespec.tv_sec)*1000+Double(info.st_mtimespec.tv_nsec)/1_000_000]
    case "list": return try fm.contentsOfDirectory(atPath: path)
    case "realpath": return path
    case "sync":
      let fd = Darwin.open(path, O_RDWR | O_NOFOLLOW); guard fd >= 0 else { throw posixError() }; defer { Darwin.close(fd) }
      guard fsync(fd) == 0 else { throw posixError() }; return NSNull()
    default: throw RuntimeError(code: "UNSUPPORTED", message: "文件操作未实现")
    }
  }
}
