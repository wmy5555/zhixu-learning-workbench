import Foundation
import CoreFoundation

// This native gate duplicates the persisted offline contract. The WebView also
// validates every draft and imported candidate before asking for a commit.
enum LearningSchema {
    static let stateLimit = 16 * 1024 * 1024
    static let recordsLimit = 8 * 1024 * 1024
    static let bodyLimit = 128 * 1024
    static var empty: [String: Any] { ["notes": [[String: Any]](), "records": [String: Any](), "settings": [String: Any](), "guide": [String: Any]()] }
    static func invalid(_ message: String = "离线学习数据格式无效。") -> SourceError { SourceError("INVALID", message) }
    static func json(_ value: Any) throws -> Data {
        guard JSONSerialization.isValidJSONObject(value) else { throw invalid() }
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }
    static func object(_ value: Any?) throws -> [String: Any] {
        guard let result = value as? [String: Any] else { throw invalid() }
        return result
    }
    static func text(_ value: Any?, limit: Int = bodyLimit, empty: Bool = false) throws -> String {
        guard let value = value as? String, (empty || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
              !value.contains("\0"), value.utf8.count <= limit else { throw invalid() }
        return value
    }
    static func boolean(_ value: Any?, equals expected: Bool? = nil) throws -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID(),
              expected.map({ number.boolValue == $0 }) ?? true else { throw invalid() }
        return number.boolValue
    }
    static func number(_ value: Any?, range: ClosedRange<Int>) throws -> Int {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue == Double(number.intValue), range.contains(number.intValue) else { throw invalid() }
        return number.intValue
    }
    static func values(_ value: Any, depth: Int = 0) throws {
        guard depth <= 24 else { throw SourceError("LIMIT_REACHED", "学习数据层级过深。") }
        if value is NSNull { return }
        if let value = value as? String { _ = try text(value, empty: true); return }
        if let value = value as? NSNumber { guard value.doubleValue.isFinite else { throw invalid() }; return }
        if let list = value as? [Any] {
            guard list.count <= 2000 else { throw invalid() }
            for item in list { try values(item, depth: depth + 1) }; return
        }
        let dictionary = try object(value)
        guard dictionary.count <= 2000 else { throw invalid() }
        for (key, item) in dictionary {
            guard !key.isEmpty, key.utf16.count <= 256, !["__proto__", "prototype", "constructor"].contains(key) else { throw invalid() }
            try values(item, depth: depth + 1)
        }
    }
    static func strings(_ value: Any?, limit: Int) throws {
        guard let array = value as? [String], array.count <= limit else { throw invalid() }
        for item in array { _ = try text(item, limit: 256) }
    }
    static func note(_ raw: Any, context: String) throws -> [String: Any] {
        let note = try UniqueJSON.keys(raw, ["id", "kind", "title", "body", "hash", "meta"], required: ["id", "kind", "title", "body", "hash", "meta"])
        guard SourceStore.validID(try text(note["id"], limit: 256)), SourceStore.validID(try text(note["hash"], limit: 256)) else { throw invalid() }
        let kind = try text(note["kind"], limit: 64), title = try text(note["title"], limit: 800)
        guard ["knowledge", "topic", "mistake"].contains(kind) || context == "practice" && kind == "source",
              title.utf16.count <= 200, title.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { throw invalid() }
        _ = try text(note["body"])
        let meta = try object(note["meta"]); try values(meta)
        if let privacy = meta["privacy"] as? String, privacy != "local" { throw invalid("离线学习库不能恢复外发权限。") }
        for (key, allowed) in ["stage": ["reference", "candidate", "learning", "integrated", "core", "retired"], "depth": ["aware", "find", "explain", "apply"]] {
            if let value = meta[key] { guard allowed.contains(try text(value, limit: 1024)) else { throw invalid() } }
        }
        for key in ["paused", "userEdited", "userStructured", "demo", "practice"] where meta[key] != nil { _ = try boolean(meta[key]) }
        for key in ["noteIds", "prerequisites", "researchLimitations", "sessions"] where meta[key] != nil { try strings(meta[key], limit: key == "noteIds" ? 500 : key == "sessions" ? 1000 : 100) }
        return note
    }
    static func evidence(_ raw: Any?) throws {
        let evidence = try object(raw)
        guard evidence["assessment"] as? String == "unassessed" else { throw invalid("离线证据必须保留未评估状态。") }
        for key in ["reviewSettled", "independent", "explanationPractice", "applicationPractice", "spacedRecall"] { _ = try boolean(evidence[key], equals: false) }
    }
    static func validate(_ raw: Any, context: String) throws -> [String: Any] {
        guard ["formal", "practice"].contains(context) else { throw invalid("学习库范围无效。") }
        let state = try UniqueJSON.keys(raw, ["notes", "records", "settings", "guide"], required: ["notes", "records", "settings", "guide"])
        try values(state)
        guard let notes = state["notes"] as? [Any], notes.count <= 200 else { throw invalid() }
        var ids = Set<String>()
        for raw in notes { let item = try note(raw, context: context); guard ids.insert(item["id"] as! String).inserted else { throw invalid("学习条目身份重复。") } }
        let records = try UniqueJSON.keys(state["records"] as Any, ["sessions", "plans", "reviews", "studyEvidence", "topics", "jobs", "relations"])
        var count = 0
        for (namespace, raw) in records {
            let items = try object(raw); count += items.count
            if namespace == "jobs" && !items.isEmpty { throw invalid("离线数据不能包含自动评估任务。") }
            if namespace == "reviews" && !items.isEmpty { throw invalid("离线练习不能恢复自动评估的复习间隔。") }
            for (key, value) in items {
                _ = try text(key, limit: 256); let record = try object(value)
                if namespace == "studyEvidence" { try evidence(record) }
                if namespace == "sessions" {
                    for key in ["id", "noteId", "sourceHash"] { _ = try text(record[key], limit: 256) }
                    guard ["reading", "unassessed", "completed"].contains(record["status"] as? String ?? ""), record["pendingJobId"] == nil, record["feedback"] == nil,
                          let turns = record["turns"] as? [[String: Any]], turns.count <= 500 else { throw invalid() }
                    _ = try text(record["material"]); _ = try number(record["hintCount"], range: 0...1000)
                    for turn in turns {
                        _ = try text(turn["id"], limit: 256); _ = try text(turn["requestId"], limit: 128); _ = try text(turn["answer"]); _ = try boolean(turn["hintUsed"])
                        guard turn["assessment"] as? String == "unassessed", turn["feedback"] == nil else { throw invalid() }
                    }
                    if record["status"] as? String == "completed" {
                        let completion = try object(record["completion"])
                        guard !turns.isEmpty, completion["interval"] is NSNull else { throw invalid() }
                        _ = try boolean(completion["reviewSettled"], equals: false); try evidence(completion["evidence"])
                    }
                }
                if namespace == "plans" {
                    guard ["pending", "done", "skip", "defer", "pause", "budget_deferred", "paused"].contains(record["state"] as? String ?? ""),
                          let minutes = record["minutes"] as? NSNumber, CFGetTypeID(minutes) != CFBooleanGetTypeID(), minutes.doubleValue.isFinite else { throw invalid() }
                }
            }
        }
        guard count <= 2000, try json(records).count <= recordsLimit, try json(state).count <= stateLimit else { throw SourceError("LIMIT_REACHED", "学习数据超过容量上限，请保留并导出备份。") }
        let settings = try UniqueJSON.keys(state["settings"] as Any, ["dailyMinutes", "timezone", "scheduleTime", "focusTopics", "pausedIds", "discoveryDays"])
        if settings["dailyMinutes"] != nil { _ = try number(settings["dailyMinutes"], range: 5...240) }
        if settings["discoveryDays"] != nil { _ = try number(settings["discoveryDays"], range: 1...365) }
        if settings["timezone"] != nil { guard TimeZone(identifier: try text(settings["timezone"], limit: 128)) != nil else { throw invalid("学习时区无效。") } }
        if settings["scheduleTime"] != nil { guard try text(settings["scheduleTime"], limit: 16).range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) != nil else { throw invalid() } }
        for key in ["focusTopics", "pausedIds"] where settings[key] != nil { try strings(settings[key], limit: key == "focusTopics" ? 100 : 200) }
        _ = try object(state["guide"])
        return state
    }
}
