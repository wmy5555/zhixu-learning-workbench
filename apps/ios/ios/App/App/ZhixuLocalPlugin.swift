import Foundation
import UIKit
import WebKit
import UniformTypeIdentifiers
import Capacitor

@objc(ZhixuLocalPlugin)
public final class ZhixuLocalPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "ZhixuLocalPlugin"
    public let jsName = "ZhixuIOSLocal"
    public let pluginMethods: [CAPPluginMethod] = ["list", "read", "save", "history", "restoreVersion", "pickSource", "exportSource", "exportBackup", "previewBackup", "restoreBackup", "rebuildIndex", "learningLoad", "learningCommit", "learningReset", "exportLearningBackup", "previewLearningBackup", "restoreLearningBackup"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    private let queue = DispatchQueue(label: "zhixu.ios.local-store")
    private var storage: SourceStore?
    private var learningStores: [String: LearningStore] = [:]
    private struct Pending {
        let call: CAPPluginCall, kind: String
        let temporary: URL?
        let context: String?
    }
    private var pending: Pending?
    private func learning(_ context: String) throws -> LearningStore {
        guard ["formal", "practice"].contains(context) else { throw SourceError("INVALID", "学习库范围无效。") }
        if let saved = learningStores[context] { return saved }
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let folder = support.appendingPathComponent("zhixu-ios-learning-v1", isDirectory: true).appendingPathComponent(context, isDirectory: true)
        let created = try LearningStore(root: folder, context: context); learningStores[context] = created; return created
    }
    private func performLearning(_ call: CAPPluginCall, allowed: Set<String>, _ operation: @escaping (LearningStore) throws -> [String: Any]) {
        queue.async {
            do { try self.keys(call, allowed); call.resolve(try operation(self.learning(self.string(call, "context")))) }
            catch { self.reject(call, error) }
        }
    }
    @objc func learningLoad(_ call: CAPPluginCall) { performLearning(call, allowed: ["context"]) { try $0.load() } }
    @objc func learningCommit(_ call: CAPPluginCall) {
        performLearning(call, allowed: ["context", "expectedRevision", "state", "sourceVersions", "requestId"]) { learning in
            guard let state = call.getObject("state"), let versions = call.getObject("sourceVersions") as? [String: String], versions.count <= 100,
                  versions.allSatisfy({ SourceStore.validID($0.key) && SourceStore.validID($0.value) }) else { throw SourceError("INVALID", "学习草稿或原文版本清单无效。") }
            let current = learning.context == "formal" ? Dictionary(uniqueKeysWithValues: try self.store().list().map { ($0.id, $0.hash) }) : [:]
            return try learning.commit(expectedRevision: self.string(call, "expectedRevision"), state: state, requestID: self.string(call, "requestId"), sourceVersions: versions, currentSourceVersions: current)
        }
    }
    @objc func learningReset(_ call: CAPPluginCall) { performLearning(call, allowed: ["context", "expectedRevision", "requestId"]) { try $0.reset(expectedRevision: self.string(call, "expectedRevision"), requestID: self.string(call, "requestId")) } }
    @objc func restoreLearningBackup(_ call: CAPPluginCall) { performLearning(call, allowed: ["context", "token", "requestId"]) { try $0.restoreBackup(token: self.string(call, "token"), requestID: self.string(call, "requestId")) } }
    @objc func previewLearningBackup(_ call: CAPPluginCall) { select(call, kind: "learning") }
    @objc func exportLearningBackup(_ call: CAPPluginCall) {
        export(call, allowed: ["context"], filename: "zhixu-ios-learning-backup.json") { try self.learning(self.string(call, "context")).exportBackup() }
    }
    private func store() throws -> SourceStore {
        if let storage = storage { return storage }
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let created = try SourceStore(root: support.appendingPathComponent("zhixu-ios-sources-v1", isDirectory: true))
        storage = created; return created
    }
    private func reject(_ call: CAPPluginCall, _ error: Error) {
        if let known = error as? SourceError { call.reject(known.message, known.code) }
        else { call.reject("本地文件操作未完成，请保留草稿后重新核对。", "STORE_ERROR") }
    }
    private func keys(_ call: CAPPluginCall, _ keys: Set<String>) throws {
        guard Set(call.jsObjectRepresentation.keys).isSubset(of: keys) else { throw SourceError("INVALID", "操作包含不支持的字段。") }
    }
    private func string(_ call: CAPPluginCall, _ key: String) throws -> String {
        guard let value = call.getString(key) else { throw SourceError("INVALID", "操作缺少必要文本字段。") }
        return value
    }
    private func perform(_ call: CAPPluginCall, allowed: Set<String>, _ operation: @escaping (SourceStore) throws -> [String: Any]) {
        queue.async {
            do { try self.keys(call, allowed); call.resolve(try operation(self.store())) }
            catch { self.reject(call, error) }
        }
    }
    @objc func list(_ call: CAPPluginCall) { perform(call, allowed: []) { store in ["notes": try store.list().map(\.dictionary), "indexPending": store.indexPending] } }
    @objc func rebuildIndex(_ call: CAPPluginCall) { perform(call, allowed: []) { ["rebuilt": try $0.rebuildIndex()] } }
    @objc func read(_ call: CAPPluginCall) { perform(call, allowed: ["id"]) { ["note": try $0.read(id: self.string(call, "id")).dictionary] } }
    @objc func save(_ call: CAPPluginCall) {
        perform(call, allowed: ["title", "body", "meta", "id", "expectedHash", "requestId"]) { store in
            for key in ["id", "expectedHash"] where call.jsObjectRepresentation[key] != nil {
                guard call.getString(key) != nil else { throw SourceError("INVALID", "原文身份或版本必须是文本。") }
            }
            guard let meta = call.getObject("meta"), Set(meta.keys) == ["platform", "author", "url", "date", "locator", "topic"] else { throw SourceError("INVALID", "来源字段无效。") }
            let source = try JSONDecoder().decode(SourceMetadata.self, from: JSONSerialization.data(withJSONObject: meta))
            return ["note": try store.save(title: self.string(call, "title"), body: self.string(call, "body"), source: source,
                id: call.getString("id"), expectedHash: call.getString("expectedHash"), requestID: self.string(call, "requestId")).dictionary]
        }
    }
    @objc func history(_ call: CAPPluginCall) { perform(call, allowed: ["id"]) { ["versions": try $0.history(id: self.string(call, "id")).map(\.dictionary)] } }
    @objc func restoreVersion(_ call: CAPPluginCall) {
        perform(call, allowed: ["id", "versionId", "expectedHash", "requestId"]) { store in
            ["note": try store.restoreVersion(id: self.string(call, "id"), versionID: self.string(call, "versionId"), expectedHash: self.string(call, "expectedHash"), requestID: self.string(call, "requestId")).dictionary]
        }
    }
    @objc func restoreBackup(_ call: CAPPluginCall) {
        perform(call, allowed: ["token", "requestId"]) { try $0.restoreBackup(token: self.string(call, "token"), requestID: self.string(call, "requestId")) }
    }
    @objc func pickSource(_ call: CAPPluginCall) { select(call, kind: "source") }
    @objc func previewBackup(_ call: CAPPluginCall) { select(call, kind: "backup") }
    private func select(_ call: CAPPluginCall, kind: String) {
        DispatchQueue.main.async {
            var context: String?
            do {
                try self.keys(call, kind == "learning" ? ["context"] : [])
                if kind == "learning" { context = try self.string(call, "context"); guard ["formal", "practice"].contains(context!) else { throw SourceError("INVALID", "学习库范围无效。") } }
                try self.ensureDialogAvailable()
            }
            catch { self.reject(call, error); return }
            let types: [UTType] = kind == "backup" || kind == "learning" ? [.json] : [.plainText, UTType(filenameExtension: "md") ?? .text]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
            picker.allowsMultipleSelection = false; picker.delegate = self
            self.pending = Pending(call: call, kind: kind, temporary: nil, context: context)
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }
    private func ensureDialogAvailable() throws {
        guard pending == nil, let controller = bridge?.viewController, controller.presentedViewController == nil else {
            throw SourceError("DOCUMENT_BUSY", "请先完成当前文件窗口。")
        }
    }
    @objc func exportSource(_ call: CAPPluginCall) {
        export(call, allowed: ["id", "expectedHash"], filename: "zhixu-source.md") {
            let note = try self.store().read(id: self.string(call, "id"))
            guard note.hash == (try self.string(call, "expectedHash")) else { throw SourceError("CONFLICT", "原文已修改，请重新打开后导出。") }
            let metadata: [String: Any] = ["format": "zhixu-source-exchange", "version": 1, "title": note.title, "source": note.source.dictionary]
            let json = try JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys, .withoutEscapingSlashes])
            guard let text = String(data: json, encoding: .utf8) else { throw SourceError("INVALID", "原文无法编码。") }
            return Data(("---\n" + text + "\n---\n" + note.body).utf8)
        }
    }
    @objc func exportBackup(_ call: CAPPluginCall) { export(call, allowed: [], filename: "zhixu-ios-source-backup.json") { try self.store().exportBackup() } }
    private func export(_ call: CAPPluginCall, allowed: Set<String>, filename: String, bytes: @escaping () throws -> Data) {
        queue.async {
            do {
                try self.keys(call, allowed)
                let data = try bytes()
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("zhixu-ios-export-" + UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.protectionKey: FileProtectionType.complete])
                let url = folder.appendingPathComponent(filename)
                try data.write(to: url, options: [.atomic, .completeFileProtection])
                DispatchQueue.main.async {
                    do { try self.ensureDialogAvailable() }
                    catch { self.removeExport(url); self.reject(call, error); return }
                    let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
                    picker.delegate = self
                    self.pending = Pending(call: call, kind: "export", temporary: url, context: nil)
                    self.bridge?.viewController?.present(picker, animated: true)
                }
            } catch { self.reject(call, error) }
        }
    }
    private func removeExport(_ url: URL?) {
        guard let url = url else { return }
        let folder = url.deletingLastPathComponent()
        guard folder.lastPathComponent.hasPrefix("zhixu-ios-export-"), folder.deletingLastPathComponent().standardizedFileURL == FileManager.default.temporaryDirectory.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: folder)
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let operation = pending else { return }
        pending = nil; removeExport(operation.temporary)
        operation.call.reject("已取消文件操作，资料未改变。", "CANCELLED")
    }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let operation = pending else { return }
        pending = nil
        if operation.kind == "export" { removeExport(operation.temporary); operation.call.resolve(["saved": true]); return }
        guard urls.count == 1, let url = urls.first else { operation.call.reject("请选择一个文件。", "INVALID"); return }
        queue.async {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let limit = operation.kind == "backup" ? SourceStore.backupLimit : operation.kind == "learning" ? LearningStore.backupLimit : 160 * 1024
                let handle = try FileHandle(forReadingFrom: url)
                defer { try? handle.close() }
                var bytes = Data()
                while let chunk = try handle.read(upToCount: min(64 * 1024, limit + 1 - bytes.count)), !chunk.isEmpty {
                    bytes.append(chunk)
                    guard bytes.count <= limit else { throw SourceError("LIMIT_REACHED", "文件超过允许上限。") }
                }
                if operation.kind == "backup" { operation.call.resolve(try self.store().previewBackup(bytes).dictionary) }
                else if operation.kind == "learning" { operation.call.resolve(try self.learning(operation.context!).previewBackup(bytes)) }
                else {
                    guard ["txt", "md"].contains(url.pathExtension.lowercased()), let text = String(data: bytes, encoding: .utf8) else { throw SourceError("INVALID", "请选择 UTF-8 txt 或 md 文件。") }
                    operation.call.resolve(["name": url.lastPathComponent, "text": text])
                }
            } catch { self.reject(operation.call, error) }
        }
    }
    public override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return true }
        return (url.scheme == "capacitor" && url.host == "localhost") ? nil : true
    }
}
