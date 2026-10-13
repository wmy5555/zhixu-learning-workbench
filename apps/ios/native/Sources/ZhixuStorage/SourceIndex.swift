import Foundation
import SQLite3

// Derived cache only. Its contents never overwrite Markdown or commit/history metadata.
final class SourceIndex {
    private var database: OpaquePointer?
    init(url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular, ((attributes[.referenceCount] as? NSNumber)?.intValue ?? 1) == 1 else { throw SourceError("UNSAFE_PATH", "索引文件不是普通文件。") }
        }
        guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            if let database = database { sqlite3_close(database) }; self.database = nil
            throw SourceError("INDEX_ERROR", "无法打开派生索引。")
        }
        do { try execute("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, version TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (revision TEXT NOT NULL);") }
        catch { if let database = database { sqlite3_close(database) }; self.database = nil; throw error }
    }
    deinit { if let database = database { sqlite3_close(database) } }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw SourceError("INDEX_ERROR", "派生索引需要重建；原文保留。") }
    }
    func replace(_ notes: [SourceNote], revision: String) throws {
        try execute("BEGIN IMMEDIATE; DELETE FROM sources; DELETE FROM metadata;")
        do {
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, "INSERT INTO sources VALUES (?,?,?,?)", -1, &statement, nil) == SQLITE_OK else { throw SourceError("INDEX_ERROR", "派生索引写入未准备。") }
            defer { sqlite3_finalize(statement) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            for note in notes {
                sqlite3_reset(statement); sqlite3_clear_bindings(statement)
                for (offset, value) in [note.id, note.title, note.body, note.hash].enumerated() {
                    let result = value.withCString { sqlite3_bind_text(statement, Int32(offset + 1), $0, -1, transient) }
                    guard result == SQLITE_OK else { throw SourceError("INDEX_ERROR", "派生索引参数未绑定。") }
                }
                guard sqlite3_step(statement) == SQLITE_DONE else { throw SourceError("INDEX_ERROR", "派生索引写入未完成。") }
            }
            var metadata: OpaquePointer?
            guard sqlite3_prepare_v2(database, "INSERT INTO metadata VALUES (?)", -1, &metadata, nil) == SQLITE_OK else { throw SourceError("INDEX_ERROR", "索引版本写入未准备。") }
            defer { sqlite3_finalize(metadata) }
            guard revision.withCString({ sqlite3_bind_text(metadata, 1, $0, -1, transient) }) == SQLITE_OK,
                  sqlite3_step(metadata) == SQLITE_DONE else { throw SourceError("INDEX_ERROR", "索引版本写入未完成。") }
            try execute("COMMIT;")
        } catch { try? execute("ROLLBACK;"); throw error }
    }
}
