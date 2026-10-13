import Foundation

// Reject ambiguous duplicate keys before Foundation decoding. Inputs remain data.
enum UniqueJSON {
    static func parse(_ data: Data, maxBytes: Int) throws -> Any {
        guard data.count <= maxBytes else { throw SourceError("LIMIT_REACHED", "文件超过容量上限。") }
        var cursor = Cursor(bytes: Array(data))
        try cursor.value(depth: 0)
        cursor.whitespace()
        guard cursor.index == cursor.bytes.count else { throw SourceError("INVALID", "JSON 文件包含多余内容。") }
        return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }
    static func keys(_ object: Any, _ allowed: Set<String>, required: Set<String>? = nil) throws -> [String: Any] {
        guard let dictionary = object as? [String: Any], Set(dictionary.keys).isSubset(of: allowed),
              required.map({ $0.isSubset(of: Set(dictionary.keys)) }) ?? true else {
            throw SourceError("INVALID", "文件包含缺失或不支持的字段。")
        }
        return dictionary
    }
    private struct Cursor {
        let bytes: [UInt8]
        var index = 0
        mutating func whitespace() { while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 } }
        mutating func string() throws -> String {
            let start = index
            guard index < bytes.count, bytes[index] == 34 else { throw SourceError("INVALID", "JSON 字符串无效。") }
            index += 1
            while index < bytes.count {
                let byte = bytes[index]; index += 1
                if byte == 92 { guard index < bytes.count else { break }; index += 1 }
                else if byte == 34 {
                    guard let result = try JSONSerialization.jsonObject(with: Data(bytes[start..<index]), options: [.fragmentsAllowed]) as? String else { break }
                    return result
                }
            }
            throw SourceError("INVALID", "JSON 字符串未结束。")
        }
        mutating func value(depth: Int) throws {
            guard depth <= 24 else { throw SourceError("LIMIT_REACHED", "JSON 层级过深。") }
            whitespace()
            guard index < bytes.count else { throw SourceError("INVALID", "JSON 文件不完整。") }
            if bytes[index] == 34 { _ = try string(); return }
            if bytes[index] == 123 {
                index += 1; whitespace(); var keys = Set<String>(); var count = 0
                if index < bytes.count && bytes[index] == 125 { index += 1; return }
                while index < bytes.count {
                    whitespace(); let key = try string()
                    guard keys.insert(key).inserted else { throw SourceError("INVALID", "JSON 文件包含重复字段。") }
                    count += 1
                    guard count <= 4000 else { throw SourceError("LIMIT_REACHED", "JSON 字段过多。") }
                    whitespace()
                    guard index < bytes.count && bytes[index] == 58 else { throw SourceError("INVALID", "JSON 字段缺少冒号。") }
                    index += 1; try value(depth: depth + 1); whitespace()
                    guard index < bytes.count else { break }
                    let delimiter = bytes[index]; index += 1
                    if delimiter == 125 { return }
                    guard delimiter == 44 else { break }
                }
                throw SourceError("INVALID", "JSON 对象无效。")
            }
            if bytes[index] == 91 {
                index += 1; whitespace(); var count = 0
                if index < bytes.count && bytes[index] == 93 { index += 1; return }
                while index < bytes.count {
                    count += 1
                    guard count <= 4000 else { throw SourceError("LIMIT_REACHED", "JSON 列表过长。") }
                    try value(depth: depth + 1); whitespace()
                    guard index < bytes.count else { break }
                    let delimiter = bytes[index]; index += 1
                    if delimiter == 93 { return }
                    guard delimiter == 44 else { break }
                }
                throw SourceError("INVALID", "JSON 列表无效。")
            }
            let start = index
            while index < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[index]) { index += 1 }
            guard index > start else { throw SourceError("INVALID", "JSON 值无效。") }
            _ = try JSONSerialization.jsonObject(with: Data(bytes[start..<index]), options: [.fragmentsAllowed])
        }
    }
}
