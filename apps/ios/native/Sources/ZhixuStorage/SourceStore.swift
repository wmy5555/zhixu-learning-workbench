import Foundation
import CryptoKit
import Darwin

public struct SourceError: Error, LocalizedError {
    public let code: String
    public let message: String
    public init(_ code: String, _ message: String) { self.code = code; self.message = message }
    public var errorDescription: String? { message }
}
public struct SourceMetadata: Codable, Equatable {
    public var platform: String, author: String, url: String, date: String, locator: String, topic: String
    public init(platform: String = "", author: String = "", url: String = "", date: String = "", locator: String = "", topic: String = "") {
        self.platform = platform; self.author = author; self.url = url; self.date = date; self.locator = locator; self.topic = topic
    }
    public func validate() throws {
        for (key, value) in dictionary {
            let limit = ["url", "locator"].contains(key) ? 2048 : 200
            guard value.utf16.count <= limit, value == value.trimmingCharacters(in: .whitespacesAndNewlines),
                  value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
                throw SourceError("INVALID", "来源字段过长，或含控制字符、首尾空白。")
            }
        }
        if !url.isEmpty {
            guard let value = URLComponents(string: url), ["http", "https"].contains(value.scheme?.lowercased() ?? ""),
                  let host = value.host, !host.isEmpty, value.user == nil, value.password == nil else {
                throw SourceError("INVALID", "来源地址应为不含凭据的 HTTP/HTTPS 网址。")
            }
        }
    }
    public var dictionary: [String: String] { ["platform": platform, "author": author, "url": url, "date": date, "locator": locator, "topic": topic] }
}
public struct SourceNote: Codable, Equatable {
    public let id: String, hash: String, title: String, body: String, createdAt: String, updatedAt: String
    public let source: SourceMetadata
    public init(id: String, hash: String, title: String, body: String, createdAt: String, updatedAt: String, source: SourceMetadata) {
        self.id = id; self.hash = hash; self.title = title; self.body = body; self.createdAt = createdAt; self.updatedAt = updatedAt; self.source = source
    }
    public func validate() throws {
        guard SourceStore.validID(id), SourceStore.validID(hash), !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              title == title.trimmingCharacters(in: .whitespacesAndNewlines), title.utf16.count <= 200,
              title.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
              !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !body.contains("\0"), body.utf8.count <= 128 * 1024,
              ISO8601DateFormatter().date(from: createdAt) != nil, ISO8601DateFormatter().date(from: updatedAt) != nil else {
            throw SourceError("INVALID", "原文身份、版本、标题、正文或时间格式无效。")
        }
        try source.validate()
    }
    public var dictionary: [String: Any] {
        var meta: [String: Any] = source.dictionary
        meta["stage"] = "reference"; meta["privacy"] = "local"; meta["effectivePrivacy"] = "local"
        return ["id": id, "hash": hash, "title": title, "body": body, "kind": "source", "meta": meta, "createdAt": createdAt, "updatedAt": updatedAt]
    }
}
public struct SourceBackupEntry: Codable, Equatable {
    public var current: SourceNote, original: SourceNote, versions: [SourceNote]
}
public struct SourceBackup: Codable, Equatable {
    public let format: String, version: Int, createdAt: String
    public var entries: [SourceBackupEntry]
}
public struct SourceRestorePreview {
    public let token: String, newCount: Int, sameCount: Int, versionCount: Int
    public let conflicts: [[String: String]]
    public var dictionary: [String: Any] { ["token": token, "newCount": newCount, "sameCount": sameCount, "versionCount": versionCount, "conflicts": conflicts] }
}
private struct Reference: Codable, Equatable {
    let id: String, version: String, checksum: String
    var name: String { "\(id).\(version).md" }
}
private struct Entry: Codable, Equatable { var current: Reference, original: Reference, versions: [Reference] }
private struct Receipt: Codable, Equatable { let intent: String; let result: [String: String] }
private struct Manifest: Codable, Equatable {
    var schemaVersion = 1
    var revision = "empty"
    var entries: [String: Entry] = [:]
    var receipts: [String: Receipt] = [:]
}
private struct Header: Codable {
    let id: String, hash: String, title: String, createdAt: String, updatedAt: String
    let source: SourceMetadata
}
private struct Preview {
    let revision: String, backup: SourceBackup, deadline: Date
}

// Calls must be serialized by the native plugin. There is no API accepting a filesystem path.
public final class SourceStore {
    public static let backupLimit = 32 * 1024 * 1024
    private let root: URL, documents: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()
    private var previews: [String: Preview] = [:]
    private let clock: () -> Date
    public private(set) var indexPending = false
    // Internal fault hook is available to XCTest, never to JavaScript.
    var fault: ((String) throws -> Void)?
    public init(root: URL, clock: @escaping () -> Date = Date.init) throws {
        try Self.directory(root)
        self.root = root.resolvingSymlinksInPath().standardizedFileURL
        self.documents = self.root.appendingPathComponent("documents", isDirectory: true)
        self.clock = clock
        encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try Self.directory(documents)
        #if os(iOS)
        var protectedRoot = self.root
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try protectedRoot.setResourceValues(values)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: self.root.path)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: documents.path)
        #endif
        _ = try load()
    }
    public static func validID(_ value: String) -> Bool {
        guard value == value.lowercased(), let parsed = UUID(uuidString: value) else { return false }
        return parsed.uuidString.lowercased() == value
    }
    private static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func timestamp() -> String { ISO8601DateFormatter().string(from: clock()) }
    private static func directory(_ url: URL) throws {
        let manager = FileManager.default
        if manager.fileExists(atPath: url.path) {
            guard try manager.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType == .typeDirectory else {
                throw SourceError("UNSAFE_PATH", "资料目录不是普通目录。")
            }
        } else { try manager.createDirectory(at: url, withIntermediateDirectories: true) }
    }
    private func safeFile(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) {
            let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
            guard attrs[.type] as? FileAttributeType == .typeRegular, ((attrs[.referenceCount] as? NSNumber)?.intValue ?? 1) == 1 else {
                throw SourceError("UNSAFE_PATH", "资料文件类型无效。")
            }
        }
        guard url.deletingLastPathComponent().resolvingSymlinksInPath().path == url.deletingLastPathComponent().path else {
            throw SourceError("UNSAFE_PATH", "资料目录包含链接。")
        }
    }
    private func syncDirectory(_ directory: URL) throws {
        let fd = Darwin.open(directory.path, O_RDONLY)
        guard fd >= 0 else { throw SourceError("STORE_ERROR", "无法同步资料目录。") }
        defer { Darwin.close(fd) }
        guard Darwin.fsync(fd) == 0 else { throw SourceError("STORE_ERROR", "资料目录同步未完成。") }
    }
    private func writeFile(_ data: Data, to url: URL) throws {
        try safeFile(url)
        try data.write(to: url, options: .withoutOverwriting)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        #endif
        let handle = try FileHandle(forWritingTo: url)
        do {
            try handle.synchronize()
            guard Darwin.fcntl(handle.fileDescriptor, F_FULLFSYNC, 0) == 0 else { throw SourceError("STORE_ERROR", "文件完整同步未完成，尚未发布新版本。") }
            try handle.close()
        }
        catch { try? handle.close(); throw error }
    }
    private func load() throws -> Manifest {
        let url = root.appendingPathComponent("current.json")
        try safeFile(url)
        guard FileManager.default.fileExists(atPath: url.path) else { return Manifest() }
        let data = try readData(url, limit: Self.backupLimit)
        let raw = try UniqueJSON.parse(data, maxBytes: Self.backupLimit)
        _ = try UniqueJSON.keys(raw, ["schemaVersion", "revision", "entries", "receipts"], required: ["schemaVersion", "revision", "entries", "receipts"])
        let manifest = try decoder.decode(Manifest.self, from: data)
        guard manifest.schemaVersion == 1, Self.validID(manifest.revision), manifest.entries.count <= 100, manifest.receipts.count <= 2000 else {
            throw SourceError("STORE_CORRUPT", "资料提交清单无效；请保留文件并从已核对的备份恢复。")
        }
        for (id, entry) in manifest.entries {
            guard Self.validID(id), entry.current.id == id, entry.original.id == id else { throw SourceError("STORE_CORRUPT", "原文身份不一致。") }
            for reference in [entry.current, entry.original] + entry.versions {
                guard reference.id == id else { throw SourceError("STORE_CORRUPT", "历史身份不一致。") }
                _ = try read(reference)
            }
        }
        return manifest
    }
    private func document(_ note: SourceNote) throws -> Data {
        try note.validate()
        let header = Header(id: note.id, hash: note.hash, title: note.title, createdAt: note.createdAt, updatedAt: note.updatedAt, source: note.source)
        let encoded = try encoder.encode(header).base64EncodedString()
        return Data(("<!-- zhixu-ios-source-v1 \(encoded) -->\n" + note.body).utf8)
    }
    private func readData(_ url: URL, limit: Int) throws -> Data {
        let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }
        var bytes = Data()
        while let chunk = try file.read(upToCount: min(64 * 1024, limit + 1 - bytes.count)), !chunk.isEmpty {
            bytes.append(chunk)
            guard bytes.count <= limit else { throw SourceError("STORE_CORRUPT", "资料文件超过受支持的上限。") }
        }
        return bytes
    }
    private func read(_ reference: Reference) throws -> SourceNote {
        guard Self.validID(reference.id), Self.validID(reference.version), reference.checksum.count == 64,
              reference.checksum.allSatisfy({ $0.isHexDigit }) else { throw SourceError("STORE_CORRUPT", "资料引用无效。") }
        let url = documents.appendingPathComponent(reference.name)
        try safeFile(url)
        let data = try readData(url, limit: 160 * 1024)
        guard data.count <= 160 * 1024, Self.digest(data) == reference.checksum,
              let text = String(data: data, encoding: .utf8), let newline = text.firstIndex(of: "\n") else {
            throw SourceError("STORE_CORRUPT", "原文文件损坏或校验不一致。")
        }
        let firstLine = String(text[..<newline]), prefix = "<!-- zhixu-ios-source-v1 "
        guard firstLine.hasPrefix(prefix), firstLine.hasSuffix(" -->"),
              let bytes = Data(base64Encoded: String(firstLine.dropFirst(prefix.count).dropLast(4))) else {
            throw SourceError("STORE_CORRUPT", "原文元数据无效。")
        }
        _ = try UniqueJSON.parse(bytes, maxBytes: 32 * 1024)
        let header = try decoder.decode(Header.self, from: bytes)
        let note = SourceNote(id: header.id, hash: header.hash, title: header.title, body: String(text[text.index(after: newline)...]), createdAt: header.createdAt, updatedAt: header.updatedAt, source: header.source)
        try note.validate()
        guard note.id == reference.id, note.hash == reference.version else { throw SourceError("STORE_CORRUPT", "原文身份或版本不一致。") }
        return note
    }
    private func stage(_ note: SourceNote) throws -> Reference {
        let bytes = try document(note)
        let reference = Reference(id: note.id, version: note.hash, checksum: Self.digest(bytes))
        let output = documents.appendingPathComponent(reference.name)
        if FileManager.default.fileExists(atPath: output.path) {
            guard try read(reference) == note else { throw SourceError("CONFLICT", "同版本原文内容冲突。") }
        } else {
            guard try FileManager.default.contentsOfDirectory(atPath: documents.path).count < 1000 else { throw SourceError("LIMIT_REACHED", "文件及历史达到 1000 份上限，请保留并导出备份。") }
            try writeFile(bytes, to: output)
        }
        return reference
    }
    private func backup(_ manifest: Manifest) throws -> SourceBackup {
        let entries = try manifest.entries.keys.sorted().map { id -> SourceBackupEntry in
            let entry = manifest.entries[id]!
            return try SourceBackupEntry(current: read(entry.current), original: read(entry.original), versions: entry.versions.map(read))
        }
        let result = SourceBackup(format: "zhixu-ios-source-backup", version: 1, createdAt: timestamp(), entries: entries)
        guard try encoder.encode(result).count <= Self.backupLimit else { throw SourceError("LIMIT_REACHED", "完整原文及历史超过 32 MiB 备份上限。") }
        return result
    }
    private func publish(_ candidate: Manifest, requestID: String) throws {
        _ = try backup(candidate) // Every accepted write must remain exportable.
        let bytes = try encoder.encode(candidate)
        try fault?("beforeDocumentsSync"); try syncDirectory(documents)
        let temporary = root.appendingPathComponent(".new-\(requestID).json")
        try safeFile(temporary)
        if FileManager.default.fileExists(atPath: temporary.path) { try FileManager.default.removeItem(at: temporary) }
        try writeFile(bytes, to: temporary)
        try fault?("beforePublish")
        let current = root.appendingPathComponent("current.json"); try safeFile(current)
        guard Darwin.rename(temporary.path, current.path) == 0 else { throw SourceError("STORE_ERROR", "资料清单发布未完成。") }
        do { try fault?("afterPublish"); try syncDirectory(root) }
        catch {
            // Reconcile this exact committed candidate. Never call it a failed create after a proven durable install.
            do {
                guard try load() == candidate else { throw SourceError("COMMIT_UNKNOWN", "保存结果尚不明确，请保留草稿并用同一请求重试。") }
                try fault?("reconcile"); try syncDirectory(root)
            } catch { throw SourceError("COMMIT_UNKNOWN", "保存可能已提交，请保留草稿并用同一请求重试。") }
        }
    }
    private func receipt(_ requestID: String, intent: String, in manifest: Manifest) throws -> Receipt? {
        guard Self.validID(requestID) else { throw SourceError("INVALID", "请求标识无效。") }
        if let receipt = manifest.receipts[requestID] {
            guard receipt.intent == intent else { throw SourceError("REQUEST_CONFLICT", "同一请求标识不能用于不同内容。") }
            try syncDirectory(root)
            return receipt
        }
        guard manifest.receipts.count < 2000 else { throw SourceError("LIMIT_REACHED", "保存回执已达到容量上限。") }
        return nil
    }
    private func intent(_ object: [String: Any]) throws -> String { Self.digest(try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])) }
    public func list() throws -> [SourceNote] {
        let current = try load(), notes = try current.entries.values.map { try read($0.current) }.sorted { $0.updatedAt > $1.updatedAt }
        do { try updateIndex(notes, revision: current.revision); indexPending = false } catch { indexPending = true }
        return notes
    }
    private func updateIndex(_ notes: [SourceNote], revision: String) throws {
        let folder = root.appendingPathComponent("cache", isDirectory: true); try Self.directory(folder)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: folder.path)
        #endif
        for suffix in ["", "-journal", "-wal", "-shm"] { try safeFile(folder.appendingPathComponent("index.sqlite3" + suffix)) }
        let index = try SourceIndex(url: folder.appendingPathComponent("index.sqlite3"))
        try index.replace(notes, revision: revision)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: folder.appendingPathComponent("index.sqlite3").path)
        #endif
    }
    public func rebuildIndex() throws -> Int {
        let current = try load(), notes = try current.entries.values.map { try read($0.current) }
        let folder = root.appendingPathComponent("cache", isDirectory: true); try Self.directory(folder)
        for suffix in ["", "-journal", "-wal", "-shm"] {
            let file = folder.appendingPathComponent("index.sqlite3" + suffix); try safeFile(file)
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        }
        try updateIndex(notes, revision: current.revision); indexPending = false; return notes.count
    }
    public func read(id: String) throws -> SourceNote {
        guard Self.validID(id), let entry = try load().entries[id] else { throw SourceError("NOT_FOUND", "原文不存在。") }
        return try read(entry.current)
    }
    public func save(title: String, body: String, source: SourceMetadata, id: String? = nil, expectedHash: String? = nil, requestID: String) throws -> SourceNote {
        var manifest = try load()
        let digest = try intent(["action": "save", "id": id ?? "", "expectedHash": expectedHash ?? "", "title": title, "body": body, "source": source.dictionary])
        if let receipt = try receipt(requestID, intent: digest, in: manifest), let id = receipt.result["id"], let version = receipt.result["hash"] {
            guard let entry = manifest.entries[id], let ref = ([entry.current, entry.original] + entry.versions).first(where: { $0.version == version }) else { throw SourceError("STORE_CORRUPT", "保存回执与原文不一致。") }
            return try read(ref)
        }
        let previous: SourceNote?
        if let id = id {
            guard let entry = manifest.entries[id] else { throw SourceError("NOT_FOUND", "原文不存在。") }
            previous = try read(entry.current)
            guard expectedHash == previous?.hash else { throw SourceError("CONFLICT", "原文已修改，请刷新后核对。") }
        } else { guard expectedHash == nil else { throw SourceError("INVALID", "新原文不能携带旧版本。") }; previous = nil }
        if let previous = previous, previous.title == title, previous.body == body, previous.source == source { return previous }
        if previous == nil {
            if let duplicate = try list().first(where: { $0.title == title && $0.body == body && $0.source == source }) { return duplicate }
            guard manifest.entries.count < 100 else { throw SourceError("LIMIT_REACHED", "原文达到 100 份上限。") }
        }
        let note = SourceNote(id: previous?.id ?? UUID().uuidString.lowercased(), hash: UUID().uuidString.lowercased(), title: title, body: body, createdAt: previous?.createdAt ?? timestamp(), updatedAt: timestamp(), source: source)
        let ref = try stage(note)
        if var entry = manifest.entries[note.id] { entry.versions.append(entry.current); entry.current = ref; manifest.entries[note.id] = entry }
        else { manifest.entries[note.id] = Entry(current: ref, original: ref, versions: []) }
        manifest.revision = UUID().uuidString.lowercased()
        manifest.receipts[requestID] = Receipt(intent: digest, result: ["id": note.id, "hash": note.hash])
        try publish(manifest, requestID: requestID)
        return note
    }
    public func history(id: String) throws -> [SourceNote] {
        guard let entry = try load().entries[id] else { throw SourceError("NOT_FOUND", "原文不存在。") }
        return try entry.versions.reversed().map(read)
    }
    public func restoreVersion(id: String, versionID: String, expectedHash: String, requestID: String) throws -> SourceNote {
        let manifest = try load()
        guard let entry = manifest.entries[id], let reference = ([entry.original] + entry.versions).first(where: { $0.version == versionID }) else { throw SourceError("NOT_FOUND", "原文历史版本不存在。") }
        let note = try read(reference)
        return try save(title: note.title, body: note.body, source: note.source, id: id, expectedHash: expectedHash, requestID: requestID)
    }
    public func exportBackup() throws -> Data { try encoder.encode(backup(load())) }
    private func decodeBackup(_ data: Data) throws -> SourceBackup {
        let raw = try UniqueJSON.keys(UniqueJSON.parse(data, maxBytes: Self.backupLimit), ["format", "version", "createdAt", "entries"], required: ["format", "version", "createdAt", "entries"])
        guard let entries = raw["entries"] as? [Any] else { throw SourceError("INVALID", "备份条目无效。") }
        for item in entries {
            let entry = try UniqueJSON.keys(item, ["current", "original", "versions"], required: ["current", "original", "versions"])
            guard let versions = entry["versions"] as? [Any] else { throw SourceError("INVALID", "备份历史无效。") }
            for item in [entry["current"]!, entry["original"]!] + versions {
                let note = try UniqueJSON.keys(item, ["id", "hash", "title", "body", "createdAt", "updatedAt", "source"], required: ["id", "hash", "title", "body", "createdAt", "updatedAt", "source"])
                _ = try UniqueJSON.keys(note["source"]!, ["platform", "author", "url", "date", "locator", "topic"], required: ["platform", "author", "url", "date", "locator", "topic"])
            }
        }
        let backup = try decoder.decode(SourceBackup.self, from: data)
        guard backup.format == "zhixu-ios-source-backup", backup.version == 1, backup.entries.count <= 100,
              ISO8601DateFormatter().date(from: backup.createdAt) != nil else { throw SourceError("INVALID", "文件不是受支持的 iOS 原文备份。") }
        var ids = Set<String>(), versionCount = 0
        for entry in backup.entries {
            guard ids.insert(entry.current.id).inserted, entry.current.id == entry.original.id else { throw SourceError("INVALID", "备份原文身份重复或不一致。") }
            guard Set(entry.versions.map(\.hash)).count == entry.versions.count,
                  !entry.versions.contains(where: { $0.hash == entry.current.hash }) else { throw SourceError("INVALID", "备份包含重复的历史版本。") }
            var versions: [String: SourceNote] = [:]
            for note in [entry.current, entry.original] + entry.versions {
                try note.validate(); versionCount += 1
                guard note.id == entry.current.id, versions[note.hash].map({ $0 == note }) ?? true else { throw SourceError("INVALID", "同一历史身份的内容冲突。") }
                versions[note.hash] = note
            }
        }
        guard versionCount <= 1200 else { throw SourceError("LIMIT_REACHED", "备份历史超过限制。") }
        return backup
    }
    private func merge(_ backup: SourceBackup, into current: Manifest, stageFiles: Bool) throws -> (Manifest, Int, Int, Int, [[String: String]]) {
        var result = current, added = 0, same = 0, versionsAdded = 0, conflicts: [[String: String]] = []
        for incoming in backup.entries {
            let id = incoming.current.id
            if let existing = current.entries[id] {
                var known: [String: SourceNote] = [:]
                for ref in [existing.current, existing.original] + existing.versions { known[ref.version] = try read(ref) }
                let currentNote = try read(existing.current), originalNote = try read(existing.original)
                if currentNote != incoming.current || originalNote != incoming.original {
                    conflicts.append(["id": id, "title": incoming.current.title]); continue
                }
                var entry = existing, conflict = false
                for note in incoming.versions where known[note.hash] != nil { if known[note.hash] != note { conflict = true } }
                if conflict { conflicts.append(["id": id, "title": incoming.current.title]); continue }
                for note in incoming.versions where known[note.hash] == nil {
                    versionsAdded += 1
                    if stageFiles { entry.versions.append(try stage(note)) }
                    known[note.hash] = note
                }
                result.entries[id] = entry; same += 1
            } else {
                added += 1; versionsAdded += incoming.versions.count
                if stageFiles { result.entries[id] = try Entry(current: stage(incoming.current), original: stage(incoming.original), versions: incoming.versions.map(stage)) }
            }
        }
        guard current.entries.count + added <= 100 else { throw SourceError("LIMIT_REACHED", "恢复后原文超过 100 份。") }
        return (result, added, same, versionsAdded, conflicts)
    }
    public func previewBackup(_ data: Data) throws -> SourceRestorePreview {
        let incoming = try decodeBackup(data), current = try load()
        let (_, added, same, versions, conflicts) = try merge(incoming, into: current, stageFiles: false)
        previews = previews.filter { $0.value.deadline > clock() }
        guard previews.count < 8 else { throw SourceError("LIMIT_REACHED", "待确认预览过多，请重开后重新预览。") }
        let token = UUID().uuidString.lowercased()
        previews[token] = Preview(revision: current.revision, backup: incoming, deadline: clock().addingTimeInterval(300))
        return SourceRestorePreview(token: token, newCount: added, sameCount: same, versionCount: versions, conflicts: conflicts)
    }
    public func restoreBackup(token: String, requestID: String) throws -> [String: Any] {
        var current = try load()
        let digest = try intent(["action": "restore", "token": token])
        if let saved = try receipt(requestID, intent: digest, in: current) { return ["imported": Int(saved.result["imported"] ?? "0") ?? 0, "same": Int(saved.result["same"] ?? "0") ?? 0, "conflicts": Int(saved.result["conflicts"] ?? "0") ?? 0] }
        guard let selected = previews[token], selected.deadline > clock(), selected.revision == current.revision else { throw SourceError("PREVIEW_EXPIRED", "预览已失效，请重新选择并核对。") }
        let (candidate, added, same, _, conflicts) = try merge(selected.backup, into: current, stageFiles: true)
        current = candidate; current.revision = UUID().uuidString.lowercased()
        current.receipts[requestID] = Receipt(intent: digest, result: ["imported": String(added), "same": String(same), "conflicts": String(conflicts.count)])
        try publish(current, requestID: requestID)
        previews.removeValue(forKey: token)
        return ["imported": added, "same": same, "conflicts": conflicts.count]
    }
}
