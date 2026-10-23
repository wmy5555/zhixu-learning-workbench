import Foundation
import Network
import Security

// HTTP/1.1 over a validated literal IP. TLS still uses the original DNS hostname
// for SNI and certificate validation. No redirect, proxy, cookie or retry here.
final class PinnedCall {
  private let connection: NWConnection
  private let queue = DispatchQueue(label: "com.zhixu.pinned-request")
  private let completion: ([String: Any]) -> Void
  private let requestBytes: Data
  private var bytes = Data()
  private var finished = false
  private let maxBody = 3 * 1024 * 1024
  private var timer: DispatchWorkItem?

  init(arguments: [String: Any], completion: @escaping ([String: Any]) -> Void) throws {
    self.completion = completion
    let ip = arguments["hostname"] as? String ?? ""
    let original = arguments["servername"] as? String ?? ((arguments["headers"] as? [String: String])?["host"] ?? "")
    let portNumber = UInt16(String(describing: arguments["port"] ?? "443")) ?? 443
    guard let port = NWEndpoint.Port(rawValue: portNumber), !ip.isEmpty,
          IPv4Address(ip) != nil || IPv6Address(ip) != nil else { throw NSError(domain: "INVALID_URL", code: 1) }
    let secure = arguments["protocol"] as? String == "https:"
    if secure {
      let tls = NWProtocolTLS.Options()
      sec_protocol_options_set_tls_server_name(tls.securityProtocolOptions, original)
      sec_protocol_options_add_tls_application_protocol(tls.securityProtocolOptions, "http/1.1")
      // Apple performs trust-chain and hostname validation. No custom trust override.
      connection = NWConnection(host: NWEndpoint.Host(ip), port: port, using: NWParameters(tls: tls, tcp: NWProtocolTCP.Options()))
    } else { connection = NWConnection(host: NWEndpoint.Host(ip), port: port, using: .tcp) }
    let method = arguments["method"] as? String ?? "GET"
    let path = arguments["path"] as? String ?? "/"
    guard ["GET", "POST"].contains(method), path.hasPrefix("/"), !path.contains("\r"), !path.contains("\n"), !path.contains(" ") else { throw NSError(domain: "INVALID_URL", code: 2) }
    let body = Data(base64Encoded: arguments["body"] as? String ?? "") ?? Data()
    guard body.count <= 2 * 1024 * 1024 else { throw NSError(domain: "TOO_LARGE", code: 3) }
    var headers = arguments["headers"] as? [String: String] ?? [:]
    for (name, value) in headers {
      guard name.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil,
            !value.contains("\r"), !value.contains("\n"), !value.contains("\0") else { throw NSError(domain: "INVALID_HEADER", code: 4) }
    }
    headers = headers.filter { !["content-length","connection","accept-encoding","transfer-encoding"].contains($0.key.lowercased()) }
    headers["Connection"] = "close"; headers["Accept-Encoding"] = "identity"
    if !body.isEmpty { headers["Content-Length"] = String(body.count) }
    let lines = "\(method) \(path) HTTP/1.1\r\n" + headers.map { "\($0.key): \($0.value)" }.joined(separator: "\r\n") + "\r\n\r\n"
    requestBytes = Data(lines.utf8) + body
  }

  func start() {
    let timeout = DispatchWorkItem { [weak self] in self?.fail("REQUEST_TIMEOUT", "外部请求超时") }
    timer = timeout; queue.asyncAfter(deadline: .now() + 180, execute: timeout)
    connection.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        self.connection.send(content: self.requestBytes, completion: .contentProcessed { error in
          if error != nil { self.fail("NETWORK_ERROR", "无法发送请求") } else { self.receive() }
        })
      case .failed: self.fail("NETWORK_ERROR", "无法建立通过验证的网络连接")
      default: break
      }
    }
    connection.start(queue: queue)
  }
  func cancel() { queue.async { self.fail("CANCELLED", "请求已取消") } }
  private func fail(_ code: String, _ message: String) { finish(["error": ["code":code,"message":message]]) }
  private func finish(_ result: [String: Any]) {
    guard !finished else { return }; finished = true; timer?.cancel(); connection.cancel(); bytes.removeAll(); completion(result)
  }
  private func receive() {
    guard !finished else { return }
    connection.receive(minimumIncompleteLength: 1, maximumLength: 32768) { [weak self] content, _, eof, error in
      guard let self, !self.finished else { return }
      if let content { self.bytes.append(content) }
      guard self.bytes.count <= self.maxBody + 65536 else { self.fail("RESPONSE_TOO_LARGE", "外部响应超过大小限制"); return }
      if self.parse(eof: eof) { return }
      if error != nil || eof { self.fail("NETWORK_ERROR", "响应未完整接收"); return }
      self.receive()
    }
  }
  private func parse(eof: Bool) -> Bool {
    guard let delimiter = bytes.range(of: Data([13,10,13,10])) else {
      if bytes.count > 65536 { fail("RESPONSE_TOO_LARGE", "响应头超过限制"); return true }; return false
    }
    guard delimiter.lowerBound <= 65536,
          let text = String(data: bytes[..<delimiter.lowerBound], encoding: .isoLatin1) else { fail("INVALID_RESPONSE", "响应头无效"); return true }
    let lines = text.components(separatedBy: "\r\n")
    guard let first = lines.first, first.hasPrefix("HTTP/1."), let status = Int(first.split(separator:" ").dropFirst().first ?? ""), status >= 200 else { fail("INVALID_RESPONSE", "响应状态无效"); return true }
    var headers: [String:String] = [:]
    for line in lines.dropFirst() {
      guard let colon = line.firstIndex(of: ":") else { fail("INVALID_RESPONSE", "响应头格式无效"); return true }
      let key = line[..<colon].lowercased(), value = line[line.index(after:colon)...].trimmingCharacters(in:.whitespaces)
      if headers[key] != nil && ["content-length","transfer-encoding"].contains(key) { fail("INVALID_RESPONSE", "响应长度声明冲突"); return true }
      headers[key] = value
    }
    let body = Data(bytes[delimiter.upperBound...])
    var output = body
    if let transfer = headers["transfer-encoding"] {
      guard transfer.lowercased() == "chunked", headers["content-length"] == nil else { fail("INVALID_RESPONSE", "响应传输格式不受支持"); return true }
      var offset = 0; output = Data()
      while true {
        guard offset <= body.count, let end = body.range(of:Data([13,10]),in:offset..<body.count) else { return false }
        guard end.lowerBound - offset < 100, let raw = String(data:body[offset..<end.lowerBound],encoding:.ascii), let size=Int(raw.split(separator:";").first ?? "",radix:16), size >= 0 else { fail("INVALID_RESPONSE", "响应分块格式无效"); return true }
        offset=end.upperBound
        if size == 0 { break }
        guard size <= maxBody - output.count else { fail("RESPONSE_TOO_LARGE", "外部响应超过大小限制"); return true }
        guard body.count - offset >= size + 2 else { return false }
        guard body[offset+size] == 13 && body[offset+size+1] == 10 else { fail("INVALID_RESPONSE", "响应分块不完整"); return true }
        output.append(body[offset..<offset+size]); offset += size + 2
      }
    } else if let declared=headers["content-length"] {
      guard let length=Int(declared), length >= 0, length <= maxBody else { fail("RESPONSE_TOO_LARGE", "外部响应大小无效"); return true }
      if body.count < length { return false }
      guard body.count == length else { fail("INVALID_RESPONSE", "响应长度与声明不符"); return true }
    } else if !eof { return false }
    guard output.count <= maxBody else { fail("RESPONSE_TOO_LARGE", "外部响应超过大小限制"); return true }
    if let encoding=headers["content-encoding"], encoding.lowercased() != "identity" { fail("INVALID_RESPONSE", "服务忽略了未压缩响应要求"); return true }
    finish(["status":status,"headers":headers,"body":output.base64EncodedString()]); return true
  }
}
