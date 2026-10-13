import XCTest
@testable import ZhixuStorage

final class LearningStoreTests: XCTestCase {
    private let id = "11111111-1111-4111-8111-111111111111"
    private let version = "22222222-2222-4222-8222-222222222222"
    private func folder() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("zhixu-learning-test-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }; return url
    }
    private func state(_ body: String = "精确原文\r\n自己的理解。\n") -> [String: Any] {
        var state = LearningSchema.empty
        state["notes"] = [["id": id, "hash": version, "kind": "knowledge", "title": "合成学习条目", "body": body,
                           "meta": ["privacy": "local", "stage": "candidate", "claimType": "opinion", "userStructured": true]]]
        return state
    }
    private func commit(_ store: LearningStore, _ state: [String: Any], request: String = UUID().uuidString.lowercased()) throws -> [String: Any] {
        try store.commit(expectedRevision: store.load()["revision"] as! String, state: state, requestID: request, sourceVersions: [:], currentSourceVersions: [:])
    }
    func testAtomicMarkdownRecordsReopenAndHistoryPreservation() throws {
        let root = try folder(), store = try LearningStore(root: root, context: "formal")
        _ = try commit(store, state()); let oldRevision = try store.load()["revision"] as! String
        var changed = state("原文没有被建议覆盖。\n\n## 用户追加\n必须保留。")
        var note = (changed["notes"] as! [[String: Any]])[0]; note["hash"] = UUID().uuidString.lowercased(); changed["notes"] = [note]
        changed["guide"] = ["dismissed": true]
        _ = try commit(store, changed)
        let reopened = try LearningStore(root: root, context: "formal")
        XCTAssertEqual(try LearningSchema.json(reopened.load()["state"] as Any), try LearningSchema.json(changed))
        let pack = try LearningSchema.object(UniqueJSON.parse(store.exportBackup(), maxBytes: LearningStore.backupLimit))
        let manifest = try LearningSchema.object(pack["manifest"])
        XCTAssertEqual((manifest["history"] as! [Any]).count, 1)
        XCTAssertEqual((pack["documents"] as! [String: String]).count, 2)
        XCTAssertThrowsError(try store.commit(expectedRevision: oldRevision, state: state(), requestID: UUID().uuidString.lowercased(), sourceVersions: [:], currentSourceVersions: [:])) { XCTAssertEqual(($0 as? SourceError)?.code, "CONFLICT") }
    }
    func testCommitReceiptRecoversLostResponseWithoutDuplicateState() throws {
        let root = try folder(), store = try LearningStore(root: root, context: "formal"), request = UUID().uuidString.lowercased()
        store.fault = { stage in if ["afterPublish", "reconcile"].contains(stage) { throw SourceError("TEST_FAILURE", "合成中断") } }
        XCTAssertThrowsError(try store.commit(expectedRevision: "empty", state: state(), requestID: request, sourceVersions: [:], currentSourceVersions: [:])) { XCTAssertEqual(($0 as? SourceError)?.code, "COMMIT_UNKNOWN") }
        let reopened = try LearningStore(root: root, context: "formal")
        let revision = try reopened.load()["revision"] as! String
        let replay = try reopened.commit(expectedRevision: "empty", state: state(), requestID: request, sourceVersions: [:], currentSourceVersions: [:])
        XCTAssertEqual(replay["replayed"] as? Bool, true); XCTAssertEqual(replay["revision"] as? String, revision)
        XCTAssertThrowsError(try reopened.commit(expectedRevision: "empty", state: state("不同意图"), requestID: request, sourceVersions: [:], currentSourceVersions: [:])) { XCTAssertEqual(($0 as? SourceError)?.code, "REQUEST_CONFLICT") }
    }
    func testBeforePublishFailureAndSourceVersionRacePreservePreviousState() throws {
        let store = try LearningStore(root: folder(), context: "formal")
        store.fault = { stage in if stage == "beforePublish" { throw SourceError("TEST_FAILURE", "合成中断") } }
        XCTAssertThrowsError(try commit(store, state()))
        XCTAssertEqual(try store.load()["revision"] as? String, "empty")
        store.fault = nil
        XCTAssertThrowsError(try store.commit(expectedRevision: "empty", state: state(), requestID: UUID().uuidString.lowercased(), sourceVersions: [id: version], currentSourceVersions: [id: UUID().uuidString.lowercased()])) { XCTAssertEqual(($0 as? SourceError)?.code, "SOURCE_CHANGED") }
        XCTAssertEqual(try (store.load()["state"] as! [String: Any])["notes"] as? [String], [])
    }
    func testBackupReadOnlyPreviewConflictExpiryAndAtomicRestore() throws {
        let original = try LearningStore(root: folder(), context: "formal"); _ = try commit(original, state())
        let bytes = try original.exportBackup(), targetRoot = try folder(); var now = Date(timeIntervalSince1970: 1000)
        let target = try LearningStore(root: targetRoot, context: "formal", clock: { now })
        let preview = try target.previewBackup(bytes)
        XCTAssertEqual(preview["canRestore"] as? Bool, true); XCTAssertEqual(try target.load()["revision"] as? String, "empty")
        let request = UUID().uuidString.lowercased(), token = preview["token"] as! String
        _ = try target.restoreBackup(token: token, requestID: request)
        XCTAssertEqual(try LearningSchema.json(target.load()["state"] as Any), try LearningSchema.json(state()))
        XCTAssertEqual(try target.restoreBackup(token: token, requestID: request)["replayed"] as? Bool, true)
        _ = try commit(target, state("新的用户修改"))
        let conflict = try target.previewBackup(bytes); XCTAssertEqual(conflict["canRestore"] as? Bool, false)
        XCTAssertThrowsError(try target.restoreBackup(token: conflict["token"] as! String, requestID: UUID().uuidString.lowercased())) { XCTAssertEqual(($0 as? SourceError)?.code, "CONFLICT") }
        let expiring = try target.previewBackup(bytes); now.addTimeInterval(301)
        XCTAssertThrowsError(try target.restoreBackup(token: expiring["token"] as! String, requestID: UUID().uuidString.lowercased())) { XCTAssertEqual(($0 as? SourceError)?.code, "PREVIEW_EXPIRED") }
    }
    func testPracticeResetIsIsolatedAndRejectsPermissionOrAssessmentEscalation() throws {
        let formal = try LearningStore(root: folder(), context: "formal"), practice = try LearningStore(root: folder(), context: "practice")
        _ = try commit(formal, state()); _ = try commit(practice, state())
        XCTAssertThrowsError(try formal.reset(expectedRevision: formal.load()["revision"] as! String, requestID: UUID().uuidString.lowercased()))
        _ = try practice.reset(expectedRevision: practice.load()["revision"] as! String, requestID: UUID().uuidString.lowercased())
        XCTAssertEqual((try practice.load()["state"] as! [String: Any])["notes"] as! [String], [])
        XCTAssertEqual(((try formal.load()["state"] as! [String: Any])["notes"] as! [Any]).count, 1)
        var unsafe = state(); unsafe["settings"] = ["ai": ["enabled": true]]
        XCTAssertThrowsError(try commit(formal, unsafe))
        unsafe = state(); unsafe["records"] = ["studyEvidence": ["fake": ["assessment": "correct", "reviewSettled": true]]]
        XCTAssertThrowsError(try commit(formal, unsafe))
        XCTAssertThrowsError(try practice.previewBackup(formal.exportBackup()))
    }
    func testCorruptMarkdownAndDuplicateBackupKeysNeverBecomeEmptyState() throws {
        let root = try folder(), store = try LearningStore(root: root, context: "formal"); _ = try commit(store, state())
        let url = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("documents"), includingPropertiesForKeys: nil).first)
        try Data("损坏".utf8).write(to: url)
        XCTAssertThrowsError(try LearningStore(root: root, context: "formal"))
        let empty = try LearningStore(root: folder(), context: "formal")
        XCTAssertThrowsError(try empty.previewBackup(Data("{\"format\":1,\"format\":2}".utf8)))
        XCTAssertEqual(try empty.load()["revision"] as? String, "empty")
    }
}
