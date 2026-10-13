import XCTest
@testable import ZhixuStorage

final class SourceStoreTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("zhixu-ios-test-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    }
    override func tearDownWithError() throws {
        XCTAssertTrue(root.lastPathComponent.hasPrefix("zhixu-ios-test-"))
        XCTAssertEqual(root.deletingLastPathComponent().standardizedFileURL, FileManager.default.temporaryDirectory.standardizedFileURL)
        try FileManager.default.removeItem(at: root)
    }
    private func id() -> String { UUID().uuidString.lowercased() }
    private func create(_ store: SourceStore, request: String? = nil, body: String = "原文\n\n保留空白与 🧠。\n") throws -> SourceNote {
        try store.save(title: "合成原文", body: body, source: SourceMetadata(date: "2024年春"), requestID: request ?? id())
    }
    func testExactSourceAndHistorySurviveReopenAndStaleEditsReject() throws {
        let store = try SourceStore(root: root), original = try create(store)
        let edited = try store.save(title: original.title, body: "新正文\n", source: original.source, id: original.id, expectedHash: original.hash, requestID: id())
        let reopened = try SourceStore(root: root)
        XCTAssertEqual(try reopened.read(id: original.id), edited)
        XCTAssertEqual(try reopened.history(id: original.id), [original])
        XCTAssertThrowsError(try reopened.save(title: original.title, body: "旧页面写入", source: original.source, id: original.id, expectedHash: original.hash, requestID: id())) { XCTAssertEqual(($0 as? SourceError)?.code, "CONFLICT") }
        let restored = try reopened.restoreVersion(id: original.id, versionID: original.hash, expectedHash: edited.hash, requestID: id())
        XCTAssertEqual(restored.body, original.body); XCTAssertEqual(restored.source.date, "2024年春")
        XCTAssertEqual(try reopened.history(id: original.id).first, edited)
    }
    func testSameSourceAndRequestRetriesDoNotDuplicate() throws {
        let store = try SourceStore(root: root), request = id(), first = try create(store, request: request)
        XCTAssertEqual(try create(store, request: request), first)
        XCTAssertEqual(try create(store), first)
        XCTAssertEqual(try store.list().count, 1)
        XCTAssertThrowsError(try create(store, request: request, body: "不同正文")) { XCTAssertEqual(($0 as? SourceError)?.code, "REQUEST_CONFLICT") }
    }
    func testBeforePublishFailureDoesNotExposeSourceAndRetrySucceeds() throws {
        let store = try SourceStore(root: root), request = id()
        store.fault = { phase in if phase == "beforePublish" { throw SourceError("TEST", "合成中断") } }
        XCTAssertThrowsError(try create(store, request: request))
        XCTAssertTrue(try SourceStore(root: root).list().isEmpty)
        store.fault = nil
        _ = try create(store, request: request)
        XCTAssertEqual(try store.list().count, 1)
    }
    func testInstalledCandidateIsReconciledAndUnknownRetryUsesReceipt() throws {
        let store = try SourceStore(root: root), request = id()
        store.fault = { phase in if ["afterPublish", "reconcile"].contains(phase) { throw SourceError("TEST", "合成同步失败") } }
        XCTAssertThrowsError(try create(store, request: request)) { XCTAssertEqual(($0 as? SourceError)?.code, "COMMIT_UNKNOWN") }
        let reopened = try SourceStore(root: root)
        let saved = try create(reopened, request: request)
        XCTAssertEqual(try reopened.list(), [saved])
    }
    func testBackupPreviewIsReadOnlyAndRestorePreservesConflicts() throws {
        let source = try SourceStore(root: root), original = try create(source), bytes = try source.exportBackup()
        let targetRoot = root.appendingPathComponent("other", isDirectory: true), target = try SourceStore(root: targetRoot)
        let preview = try target.previewBackup(bytes)
        XCTAssertEqual(preview.newCount, 1); XCTAssertTrue(try target.list().isEmpty)
        let request = id(), result = try target.restoreBackup(token: preview.token, requestID: request)
        XCTAssertEqual(result["imported"] as? Int, 1)
        XCTAssertEqual(try target.restoreBackup(token: preview.token, requestID: request)["imported"] as? Int, 1)
        XCTAssertEqual(try target.read(id: original.id), original)
        let edited = try target.save(title: original.title, body: "本机编辑", source: original.source, id: original.id, expectedHash: original.hash, requestID: id())
        let conflict = try target.previewBackup(bytes)
        XCTAssertEqual(conflict.conflicts.count, 1)
        _ = try target.restoreBackup(token: conflict.token, requestID: id())
        XCTAssertEqual(try target.read(id: original.id), edited)
    }
    func testPreviewExpiresAndAnyCommittedMutationInvalidatesIt() throws {
        var time = Date(timeIntervalSince1970: 1_800_000_000)
        let store = try SourceStore(root: root, clock: { time }), bytes = try store.exportBackup(), preview = try store.previewBackup(bytes)
        time = time.addingTimeInterval(301)
        XCTAssertThrowsError(try store.restoreBackup(token: preview.token, requestID: id())) { XCTAssertEqual(($0 as? SourceError)?.code, "PREVIEW_EXPIRED") }
        let next = try store.previewBackup(bytes)
        _ = try create(store)
        XCTAssertThrowsError(try store.restoreBackup(token: next.token, requestID: id())) { XCTAssertEqual(($0 as? SourceError)?.code, "PREVIEW_EXPIRED") }
    }
    func testMalformedBackupAndDuplicateKeysNeverWrite() throws {
        let store = try SourceStore(root: root)
        for json in ["{\"format\":\"bad\",\"format\":\"zhixu-ios-source-backup\",\"version\":1,\"createdAt\":\"2026-10-13T00:00:00Z\",\"entries\":[]}", "{\"unknown\":true}", "[]"] {
            XCTAssertThrowsError(try store.previewBackup(Data(json.utf8)))
            XCTAssertTrue(try store.list().isEmpty)
        }
    }
    func testUTF16TitleAndUnsafeDirectoriesReject() throws {
        let store = try SourceStore(root: root)
        XCTAssertThrowsError(try store.save(title: String(repeating: "🧠", count: 101), body: "正文", source: SourceMetadata(), requestID: id()))
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root)
        XCTAssertThrowsError(try SourceStore(root: link)) { XCTAssertEqual(($0 as? SourceError)?.code, "UNSAFE_PATH") }
    }
    func testChangedMarkdownFailsClosed() throws {
        let store = try SourceStore(root: root), note = try create(store)
        let file = root.appendingPathComponent("documents/\(note.id).\(note.hash).md")
        try Data("篡改的合成内容".utf8).write(to: file)
        XCTAssertThrowsError(try SourceStore(root: root)) { XCTAssertEqual(($0 as? SourceError)?.code, "STORE_CORRUPT") }
    }
    func testDerivedSQLiteCanBeDiscardedAndRebuiltWithoutChangingSources() throws {
        let store = try SourceStore(root: root), note = try create(store)
        XCTAssertEqual(try store.rebuildIndex(), 1)
        let index = root.appendingPathComponent("cache/index.sqlite3")
        try Data("损坏的派生索引".utf8).write(to: index)
        XCTAssertEqual(try store.list(), [note]); XCTAssertTrue(store.indexPending)
        XCTAssertEqual(try store.rebuildIndex(), 1); XCTAssertFalse(store.indexPending)
        XCTAssertEqual(try SourceStore(root: root).read(id: note.id), note)
    }
}
