import Foundation
import CryptoKit
import Darwin

// Immutable Markdown is authoritative for notes. One manifest publishes note
// references, history and learning records together; no SQLite cache can vote.
public final class LearningStore {
    public static let backupLimit = 32 * 1024 * 1024
    private let root: URL, documents: URL
    public let context: String
    private let clock: () -> Date
    private struct Snapshot { var manifest: [String: Any], state: [String: Any], documents: [String: String] }
    private struct Preview { let snapshot: Snapshot, revision: String, deadline: Date }
    private var previews: [String: Preview] = [:]
    var fault: ((String) throws -> Void)?
    public init(root: URL, context: String, clock: @escaping () -> Date = Date.init) throws {
        guard ["formal", "practice"].contains(context) else { throw LearningSchema.invalid() }
        try Self.directory(root)
        self.root = root.resolvingSymlinksInPath().standardizedFileURL
        self.documents = self.root.appendingPathComponent("documents", isDirectory: true)
        self.context = context; self.clock = clock
        try Self.directory(documents)
        #if os(iOS)
        var folder = self.root; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        for url in [self.root, documents] { try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path) }
        #endif
        _ = try snapshot()
    }
    private static func directory(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) {
            guard try FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType == .typeDirectory,
                  url.resolvingSymlinksInPath().standardizedFileURL == url.standardizedFileURL else { throw SourceError("UNSAFE_PATH", "学习目录不能包含链接。") }
        } else {
            guard url.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL == url.deletingLastPathComponent().standardizedFileURL else { throw SourceError("UNSAFE_PATH", "学习目录父路径无效。") }
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }
    private func safeFile(_ url: URL) throws {
        guard url.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL == url.deletingLastPathComponent().standardizedFileURL else { throw SourceError("UNSAFE_PATH", "学习文件路径包含链接。") }
        if FileManager.default.fileExists(atPath: url.path) {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular, (attributes[.referenceCount] as? NSNumber)?.intValue == 1 else { throw SourceError("UNSAFE_PATH", "学习文件必须是普通独立文件。") }
        }
    }
    private func read(_ url: URL, limit: Int) throws -> Data {
        try safeFile(url); let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var bytes = Data()
        while let chunk = try handle.read(upToCount: min(64 * 1024, limit + 1 - bytes.count)), !chunk.isEmpty {
            bytes.append(chunk); guard bytes.count <= limit else { throw SourceError("LIMIT_REACHED", "学习文件超过容量上限。") }
        }
        return bytes
    }
    private func sync(_ url: URL) throws {
        let fd = Darwin.open(url.path, O_RDONLY); guard fd >= 0 else { throw SourceError("STORE_ERROR", "学习目录无法同步。") }
        defer { Darwin.close(fd) }
        guard Darwin.fsync(fd) == 0 else { throw SourceError("STORE_ERROR", "学习目录同步未完成。") }
    }
    private func write(_ data: Data, to url: URL) throws {
        try safeFile(url); try data.write(to: url, options: .withoutOverwriting)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        #endif
        let handle = try FileHandle(forWritingTo: url)
        do {
            try handle.synchronize()
            guard Darwin.fcntl(handle.fileDescriptor, F_FULLFSYNC, 0) == 0 else { throw SourceError("STORE_ERROR", "学习文件尚未完成持久化。") }
            try handle.close()
        } catch { try? handle.close(); throw error }
    }
    private static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func blank() -> Snapshot {
        Snapshot(manifest: ["format": "zhixu-ios-learning-manifest", "version": 1, "context": context, "revision": "empty", "notes": [[String: String]](), "history": [[String: String]](), "records": [String: Any](), "settings": [String: Any](), "guide": [String: Any](), "receipts": [String: Any]()], state: LearningSchema.empty, documents: [:])
    }
    private func markdown(_ note: [String: Any]) throws -> String {
        var header = note; header.removeValue(forKey: "body")
        return "<!-- zhixu-ios-learning-v1 " + (try LearningSchema.json(header)).base64EncodedString() + " -->\n" + (try LearningSchema.text(note["body"]))
    }
    private func decoded(_ text: String, file: String, id: String) throws -> [String: Any] {
        let bytes = Data(text.utf8), prefix = "<!-- zhixu-ios-learning-v1 "
        guard bytes.count <= 512 * 1024, file == Self.digest(bytes) + ".md", let newline = text.firstIndex(of: "\n") else { throw SourceError("STORE_CORRUPT", "学习 Markdown 校验不一致。") }
        let line = String(text[..<newline])
        guard line.hasPrefix(prefix), line.hasSuffix(" -->"), let header = Data(base64Encoded: String(line.dropFirst(prefix.count).dropLast(4))) else { throw SourceError("STORE_CORRUPT", "学习 Markdown 元数据损坏。") }
        var note = try UniqueJSON.keys(UniqueJSON.parse(header, maxBytes: 256 * 1024), ["id", "kind", "title", "hash", "meta"], required: ["id", "kind", "title", "hash", "meta"])
        note["body"] = String(text[text.index(after: newline)...]); let checked = try LearningSchema.note(note, context: context)
        guard checked["id"] as? String == id else { throw SourceError("STORE_CORRUPT", "学习 Markdown 身份不一致。") }
        return checked
    }
    private func validate(_ manifest: [String: Any], texts: [String: String]) throws -> Snapshot {
        _ = try UniqueJSON.keys(manifest, ["format", "version", "context", "revision", "notes", "history", "records", "settings", "guide", "receipts"], required: ["format", "version", "context", "revision", "notes", "history", "records", "settings", "guide", "receipts"])
        guard manifest["format"] as? String == "zhixu-ios-learning-manifest", try LearningSchema.number(manifest["version"], range: 1...1) == 1, manifest["context"] as? String == context,
              manifest["revision"] as? String == "empty" || SourceStore.validID(manifest["revision"] as? String ?? ""),
              let refs = manifest["notes"] as? [[String: String]], refs.count <= 200, let history = manifest["history"] as? [[String: String]], refs.count + history.count <= 1000 else { throw SourceError("STORE_CORRUPT", "学习清单格式或范围无效。") }
        var seen = Set<String>(), notes = [[String: Any]]()
        for (offset, reference) in (refs + history).enumerated() {
            guard Set(reference.keys) == ["id", "file"], let id = reference["id"], SourceStore.validID(id), let file = reference["file"], file.range(of: "^[a-f0-9]{64}\\.md$", options: .regularExpression) != nil,
                  let text = texts[file], seen.insert(id + ":" + file).inserted else { throw SourceError("STORE_CORRUPT", "学习清单存在重复或缺失引用。") }
            let note = try decoded(text, file: file, id: id); if offset < refs.count { notes.append(note) }
        }
        guard Set(texts.keys) == Set((refs + history).compactMap { $0["file"] }) else { throw SourceError("STORE_CORRUPT", "学习包含未引用文件。") }
        let receipts = try LearningSchema.object(manifest["receipts"])
        guard receipts.count <= 2000 else { throw SourceError("LIMIT_REACHED", "学习回执超过容量上限。") }
        for (key, raw) in receipts {
            let value = try UniqueJSON.keys(raw, ["intent", "revision"], required: ["intent", "revision"])
            guard SourceStore.validID(key), SourceStore.validID(value["revision"] as? String ?? ""), (value["intent"] as? String ?? "").range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw SourceError("STORE_CORRUPT", "学习回执无效。") }
        }
        let state = try LearningSchema.validate(["notes": notes, "records": manifest["records"] as Any, "settings": manifest["settings"] as Any, "guide": manifest["guide"] as Any], context: context)
        return Snapshot(manifest: manifest, state: state, documents: texts)
    }
    private func snapshot() throws -> Snapshot {
        let url = root.appendingPathComponent("current.json"); try safeFile(url)
        guard FileManager.default.fileExists(atPath: url.path) else { return blank() }
        let raw = try LearningSchema.object(UniqueJSON.parse(read(url, limit: Self.backupLimit), maxBytes: Self.backupLimit))
        guard let refs = raw["notes"] as? [[String: String]], let history = raw["history"] as? [[String: String]], refs.count + history.count <= 1000 else { throw SourceError("STORE_CORRUPT", "学习引用清单无效。") }
        var texts = [String: String]()
        for reference in refs + history {
            guard let file = reference["file"], file.range(of: "^[a-f0-9]{64}\\.md$", options: .regularExpression) != nil else { throw SourceError("STORE_CORRUPT", "学习文件名无效。") }
            if texts[file] == nil {
                guard let text = String(data: try read(documents.appendingPathComponent(file), limit: 512 * 1024), encoding: .utf8) else { throw SourceError("STORE_CORRUPT", "学习文件不是有效 UTF-8。") }; texts[file] = text
            }
        }
        return try validate(raw, texts: texts)
    }
    public func load() throws -> [String: Any] { let value = try snapshot(); return ["context": context, "revision": value.manifest["revision"] as Any, "state": value.state] }
    private func package(_ value: Snapshot) throws -> [String: Any] {
        var manifest = value.manifest; manifest["receipts"] = [String: Any]()
        let pack: [String: Any] = ["format": "zhixu-ios-learning-backup", "version": 1, "context": context, "manifest": manifest, "documents": value.documents]
        guard try LearningSchema.json(pack).count <= Self.backupLimit else { throw SourceError("LIMIT_REACHED", "学习库与历史超过 32 MiB 备份上限。") }
        return pack
    }
    private func persist(_ candidate: Snapshot, requestID: String) throws {
        _ = try package(candidate)
        for (name, text) in candidate.documents {
            let url = documents.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: url.path) {
                guard try read(url, limit: 512 * 1024) == Data(text.utf8) else { throw SourceError("STORE_CORRUPT", "已有学习文件校验不一致。") }
            } else {
                guard try FileManager.default.contentsOfDirectory(atPath: documents.path).count < 1000 else { throw SourceError("LIMIT_REACHED", "学习文件及中断遗留文件已达上限。") }
                try write(Data(text.utf8), to: url)
            }
        }
        try sync(documents); try fault?("beforePublish")
        let temporary = root.appendingPathComponent(".new-" + requestID + ".json"); try safeFile(temporary)
        if FileManager.default.fileExists(atPath: temporary.path) { try FileManager.default.removeItem(at: temporary) }
        try write(LearningSchema.json(candidate.manifest), to: temporary)
        let current = root.appendingPathComponent("current.json"); try safeFile(current)
        guard Darwin.rename(temporary.path, current.path) == 0 else { throw SourceError("STORE_ERROR", "学习提交发布未完成。") }
        do { try fault?("afterPublish"); try sync(root) }
        catch {
            do {
                guard try LearningSchema.json(snapshot().manifest) == LearningSchema.json(candidate.manifest) else { throw SourceError("COMMIT_UNKNOWN", "学习提交结果待核对。") }
                try fault?("reconcile"); try sync(root)
            } catch { throw SourceError("COMMIT_UNKNOWN", "学习可能已提交，请保留输入并用同一操作重试。") }
        }
    }
    private func checkReceipt(_ current: Snapshot, requestID: String, intent: String) throws -> [String: Any]? {
        guard SourceStore.validID(requestID) else { throw LearningSchema.invalid("学习请求标识无效。") }
        let receipts = try LearningSchema.object(current.manifest["receipts"])
        if let raw = receipts[requestID] {
            let receipt = try LearningSchema.object(raw)
            guard receipt["intent"] as? String == intent else { throw SourceError("REQUEST_CONFLICT", "同一学习请求不能改成不同内容。") }
            try sync(root); return ["revision": receipt["revision"] as Any, "committed": true, "replayed": true]
        }
        guard receipts.count < 2000 else { throw SourceError("LIMIT_REACHED", "学习回执已达容量上限，请导出并保留数据。") }
        return nil
    }
    public func commit(expectedRevision: String, state: [String: Any], requestID: String, sourceVersions: [String: String], currentSourceVersions: [String: String]) throws -> [String: Any] {
        let checked = try LearningSchema.validate(state, context: context), current = try snapshot()
        let intent = Self.digest(try LearningSchema.json(["action": "commit", "revision": expectedRevision, "state": checked, "sources": sourceVersions]))
        if let replay = try checkReceipt(current, requestID: requestID, intent: intent) { return replay }
        guard current.manifest["revision"] as? String == expectedRevision else { throw SourceError("CONFLICT", "学习库已变化，请刷新后重新核对输入。") }
        guard sourceVersions == currentSourceVersions, context == "formal" || sourceVersions.isEmpty else { throw SourceError("SOURCE_CHANGED", "原文版本已变化，请重新核对学习材料。") }
        var texts = current.documents, refs = [[String: String]](), history = current.manifest["history"] as! [[String: String]]
        for raw in checked["notes"] as! [[String: Any]] {
            let text = try markdown(raw), file = Self.digest(Data(text.utf8)) + ".md"
            refs.append(["id": raw["id"] as! String, "file": file]); texts[file] = text
        }
        let nextKeys = Set(refs.map { $0["id"]! + ":" + $0["file"]! })
        let previous = current.manifest["notes"] as! [[String: String]]
        for ref in previous where !nextKeys.contains(ref["id"]! + ":" + ref["file"]!) { if !history.contains(ref) { history.append(ref) } }
        // A restored current snapshot can already occur in history. Keep each reference once.
        history.removeAll { nextKeys.contains($0["id"]! + ":" + $0["file"]!) }
        let used = Set((refs + history).compactMap { $0["file"] }); texts = texts.filter { used.contains($0.key) }
        var manifest = current.manifest; let revision = UUID().uuidString.lowercased()
        manifest["revision"] = revision; manifest["notes"] = refs; manifest["history"] = history
        for key in ["records", "settings", "guide"] { manifest[key] = checked[key] }
        var receipts = manifest["receipts"] as! [String: Any]; receipts[requestID] = ["intent": intent, "revision": revision]; manifest["receipts"] = receipts
        try persist(validate(manifest, texts: texts), requestID: requestID)
        return ["revision": revision, "committed": true, "replayed": false]
    }
    public func reset(expectedRevision: String, requestID: String) throws -> [String: Any] {
        guard context == "practice" else { throw LearningSchema.invalid("正式学习库不能由练习重置清空。") }
        // Publish empty practice state while retaining all old notes as immutable history.
        return try commit(expectedRevision: expectedRevision, state: LearningSchema.empty, requestID: requestID, sourceVersions: [:], currentSourceVersions: [:])
    }
    public func exportBackup() throws -> Data { try LearningSchema.json(package(snapshot())) }
    public func previewBackup(_ data: Data) throws -> [String: Any] {
        previews.removeAll()
        let pack = try UniqueJSON.keys(UniqueJSON.parse(data, maxBytes: Self.backupLimit), ["format", "version", "context", "manifest", "documents"], required: ["format", "version", "context", "manifest", "documents"])
        guard pack["format"] as? String == "zhixu-ios-learning-backup", try LearningSchema.number(pack["version"], range: 1...1) == 1, pack["context"] as? String == context,
              let texts = pack["documents"] as? [String: String] else { throw LearningSchema.invalid("备份类型或正式/练习范围不一致。") }
        let incoming = try validate(LearningSchema.object(pack["manifest"]), texts: texts)
        guard try LearningSchema.object(incoming.manifest["receipts"]).isEmpty else { throw LearningSchema.invalid("备份不能携带提交回执。") }
        _ = try package(incoming); let current = try snapshot(), token = UUID().uuidString.lowercased()
        let identical = try LearningSchema.json(current.state) == LearningSchema.json(incoming.state) && current.documents == incoming.documents
        previews[token] = Preview(snapshot: incoming, revision: current.manifest["revision"] as! String, deadline: clock().addingTimeInterval(300))
        return ["token": token, "context": context, "notes": (incoming.state["notes"] as! [Any]).count, "history": (incoming.manifest["history"] as! [Any]).count,
                "canRestore": isEmpty(current) || identical, "identical": identical, "candidateState": incoming.state]
    }
    private func isEmpty(_ value: Snapshot) -> Bool {
        (value.state["notes"] as! [Any]).isEmpty && (value.manifest["history"] as! [Any]).isEmpty && ["records", "settings", "guide"].allSatisfy { (value.state[$0] as! [String: Any]).isEmpty }
    }
    public func restoreBackup(token: String, requestID: String) throws -> [String: Any] {
        let current = try snapshot(), intent = Self.digest(Data(("restore:" + token).utf8))
        if let replay = try checkReceipt(current, requestID: requestID, intent: intent) { return replay.merging(["restored": true]) { $1 } }
        guard let preview = previews.removeValue(forKey: token), clock() <= preview.deadline, preview.revision == current.manifest["revision"] as? String else { throw SourceError("PREVIEW_EXPIRED", "学习备份预览已过期或当前数据已变化。") }
        guard try isEmpty(current) || current.documents == preview.snapshot.documents && LearningSchema.json(current.state) == LearningSchema.json(preview.snapshot.state) else { throw SourceError("CONFLICT", "当前学习库已有不同内容，不能覆盖恢复。") }
        var incoming = preview.snapshot; let revision = UUID().uuidString.lowercased(); incoming.manifest["revision"] = revision
        var receipts = current.manifest["receipts"] as! [String: Any]; receipts[requestID] = ["intent": intent, "revision": revision]; incoming.manifest["receipts"] = receipts
        try persist(validate(incoming.manifest, texts: incoming.documents), requestID: requestID)
        return ["revision": revision, "committed": true, "restored": true]
    }
}
