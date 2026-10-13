package io.github.wmy5555.zhixu.sharedtest;

import android.content.Context;
import android.os.SystemClock;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.util.AtomicFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.TreeMap;
import java.util.function.LongSupplier;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Private append-only journal with reviewed single-source puts. No transport, backup or history pruning. */
public final class LocalSourceSyncStore {
    static final int MAX_STATE_BYTES = 32 * 1024 * 1024;
    private static final int MAX_FILE_BYTES = MAX_STATE_BYTES + 1024;
    private static final Object LOCK = new Object();
    private static final String UUID_PATTERN = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
    private static final String[] SOURCE_FIELDS = { "platform", "author", "url", "date", "locator", "topic" };
    private final String context;
    private final File root;
    private final File file;
    private FailurePoint failurePoint;
    private final Map<String, SourcePreview> sourcePreviews = new HashMap<>();
    private LongSupplier previewClock = SystemClock::elapsedRealtime;
    private static final long PREVIEW_TTL_MS = 5 * 60 * 1000;
    private static final class SourcePreview {
        final String sourceId, revision, eventId, originalHash;
        final long issued;
        SourcePreview(String sourceId, String revision, String eventId, String originalHash, long issued) {
            this.sourceId = sourceId; this.revision = revision; this.eventId = eventId; this.originalHash = originalHash; this.issued = issued;
        }
    }
    void setPreviewClockForTests(LongSupplier clock) { synchronized (LOCK) { previewClock = clock; } }
    interface FailurePoint { void at(String stage) throws IOException; }
    void setFailurePoint(FailurePoint point) { synchronized (LOCK) { failurePoint = point; } }
    private void inject(String stage) throws IOException { if (failurePoint != null) failurePoint.at(stage); }

    public LocalSourceSyncStore(Context application, String context) throws LocalSourceStore.StoreException {
        this(privateBase(application), context);
    }
    private static File privateBase(Context application) throws LocalSourceStore.StoreException {
        try { return new File(application.getFilesDir().getCanonicalFile(), "local-source-sync-v1"); }
        catch (IOException exception) { throw storageError(exception); }
    }
    // Only instrumentation supplies a disposable cache parent. Plugin never accepts paths.
    LocalSourceSyncStore(File parent, String context) throws LocalSourceStore.StoreException {
        LocalLearningStore.validateContext(context);
        this.context = context;
        synchronized (LOCK) {
            try {
                directory(parent); syncDirectory(parent.getParentFile()); root = child(parent, context); directory(root);
                syncDirectory(parent); file = child(root, "journal.json");
                atomicPaths();
                if (!file.exists() && !child(root, "journal.json.bak").exists()) {
                    JSONObject state = new JSONObject().put("format", "zhixu-source-sync").put("version", 1)
                        .put("replicaId", UUID.randomUUID().toString()).put("libraryId", UUID.randomUUID().toString())
                        .put("context", context).put("events", new JSONArray());
                    install(envelope("0", state));
                }
                read(); // Corruption is not replaced by a fresh identity.
            } catch (IOException | JSONException exception) { throw storageError(exception); }
        }
    }
    public JSONObject load() throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            try { return read(); } catch (IOException | JSONException exception) { throw storageError(exception); }
        }
    }
    public JSONObject commit(String expectedRevision, JSONObject state) throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            try {
                JSONObject current = read();
                long revision = revision(expectedRevision);
                if (!current.getString("revision").equals(expectedRevision)) throw error("SYNC_STALE", "同步日记已变化，请重新读取。");
                JSONObject next = validateState(state), previous = current.getJSONObject("state");
                for (String key : Arrays.asList("libraryId", "replicaId")) {
                    if (!previous.getString(key).equals(next.getString(key))) throw invalid();
                }
                JSONArray oldEvents = previous.getJSONArray("events"), events = next.getJSONArray("events");
                if (events.length() < oldEvents.length()) throw invalid();
                for (int i = 0; i < oldEvents.length(); i++) {
                    if (!canonical(oldEvents.get(i)).equals(canonical(events.get(i)))) throw invalid();
                }
                if (canonical(previous).equals(canonical(next))) return current;
                if (revision == Long.MAX_VALUE) throw limit();
                JSONObject result = envelope(Long.toString(revision + 1), next);
                inject("before-install"); install(result);
                try { inject("after-install"); } catch (IOException exception) { throw unknown(exception); }
                return read(); // Success is based only on the installed main file, never .new.
            } catch (IOException | JSONException exception) { throw storageError(exception); }
        }
    }
    public JSONObject sourcePreview(LocalSourceStore sources, String sourceId) throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            requireFormal(); uuid(sourceId);
            try {
                JSONObject journal = read(); JSONArray versions = sourceHeads(journal.getJSONObject("state"), sourceId);
                JSONArray heads = new JSONArray(); for (int i = 0; i < versions.length(); i++) heads.put(versions.getJSONObject(i).getString("id"));
                JSONObject original = original(sources, sourceId);
                JSONObject result = new JSONObject().put("context", context).put("sourceId", sourceId).put("revision", journal.getString("revision"))
                    .put("heads", heads).put("versions", versions).put("original", original == null ? JSONObject.NULL : original)
                    .put("canApply", false).put("identical", false).put("token", JSONObject.NULL);
                if (versions.length() != 1) return result.put("reason", versions.length() == 0 ? "同步日记没有这份原文。" : "仍有冲突分支，请先核对并保留明确版本。");
                JSONObject event = versions.getJSONObject(0);
                if (!"put".equals(event.getString("operation"))) return result.put("reason", "这是删除记录；手机不会通过同步删除原文。");
                JSONObject value = event.getJSONObject("value");
                if (identical(original, value)) return result.put("identical", true).put("reason", "原文已经相同，无需重复保存。");
                try { sources.previewSynced(sourceId, value); }
                catch (LocalSourceStore.StoreException exception) {
                    if (!Arrays.asList("VALIDATION", "LIMIT_REACHED", "CONFLICT").contains(exception.code)) throw exception;
                    return result.put("reason", exception.getMessage());
                }
                long now = previewClock.getAsLong();
                sourcePreviews.entrySet().removeIf(entry -> expired(entry.getValue(), now));
                if (sourcePreviews.size() >= 100) return result.put("reason", "预览过多，请完成已有预览或稍后重试。");
                String token = UUID.randomUUID().toString();
                sourcePreviews.put(token, new SourcePreview(sourceId, journal.getString("revision"), event.getString("id"), original == null ? null : original.getString("hash"), now));
                return result.put("canApply", true).put("token", token);
            } catch (IOException | JSONException exception) { throw storageError(exception); }
        }
    }
    public JSONObject sourceApply(LocalSourceStore sources, String token) throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            requireFormal();
            if (token == null || !token.matches(UUID_PATTERN)) throw stalePreview();
            SourcePreview preview = sourcePreviews.remove(token); // Single use, including a stale or failed attempt.
            if (preview == null || expired(preview, previewClock.getAsLong())) throw stalePreview();
            try {
                JSONObject journal = read(); JSONArray heads = sourceHeads(journal.getJSONObject("state"), preview.sourceId);
                if (!preview.revision.equals(journal.getString("revision")) || heads.length() != 1
                    || !preview.eventId.equals(heads.getJSONObject(0).getString("id"))) throw stalePreview();
                JSONObject original = original(sources, preview.sourceId);
                String hash = original == null ? null : original.getString("hash");
                if (!java.util.Objects.equals(preview.originalHash, hash)) throw stalePreview();
                JSONObject event = heads.getJSONObject(0); if (!"put".equals(event.getString("operation"))) throw stalePreview();
                JSONObject value = event.getJSONObject("value"); boolean unchanged = identical(original, value);
                JSONObject note = unchanged ? original : sources.saveSynced(preview.sourceId, value, hash);
                JSONObject saved = sources.read(preview.sourceId);
                if (!saved.getString("hash").equals(note.getString("hash"))) throw stalePreview();
                return new JSONObject().put("sourceId", preview.sourceId).put("eventId", preview.eventId).put("note", saved).put("unchanged", unchanged);
            } catch (IOException | JSONException exception) { throw storageError(exception); }
        }
    }
    private void requireFormal() throws LocalSourceStore.StoreException {
        if (!"formal".equals(context)) throw error("SYNC_SCOPE", "练习同步日记不能写入正式原文。");
    }
    private static boolean expired(SourcePreview preview, long now) { return now < preview.issued || now - preview.issued >= PREVIEW_TTL_MS; }
    private static LocalSourceStore.StoreException stalePreview() { return error("SYNC_STALE", "同步预览已失效，请重新核对；原文不会被覆盖。"); }
    private static JSONObject original(LocalSourceStore sources, String id) throws LocalSourceStore.StoreException {
        try { return sources.read(id); }
        catch (LocalSourceStore.StoreException exception) { if ("NOT_FOUND".equals(exception.code)) return null; throw exception; }
    }
    private static boolean identical(JSONObject original, JSONObject value) throws JSONException {
        if (original == null || !original.getString("title").equals(value.getString("title")) || !original.getString("body").equals(value.getString("body"))) return false;
        JSONObject meta = original.getJSONObject("meta"), source = value.getJSONObject("source");
        for (String key : SOURCE_FIELDS) if (!meta.optString(key, "").equals(source.getString(key))) return false;
        return true;
    }
    private static JSONArray sourceHeads(JSONObject state, String sourceId) throws JSONException {
        Map<String, JSONObject> known = new HashMap<>(), heads = new TreeMap<>(); JSONArray events = state.getJSONArray("events");
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.getJSONObject(i); String id = event.getString("id"); known.put(id, event);
            if (!sourceId.equals(event.getString("sourceId"))) continue;
            Set<String> ancestors = new HashSet<>(); List<String> visit = new ArrayList<>(); JSONArray parents = event.getJSONArray("parents");
            for (int j = 0; j < parents.length(); j++) visit.add(parents.getString(j));
            while (!visit.isEmpty()) {
                String parent = visit.remove(visit.size() - 1); if (!ancestors.add(parent)) continue; heads.remove(parent);
                JSONArray older = known.get(parent).getJSONArray("parents"); for (int j = 0; j < older.length(); j++) visit.add(older.getString(j));
            }
            heads.put(id, event);
        }
        JSONArray result = new JSONArray(); for (JSONObject event : heads.values()) result.put(event); return result;
    }
    private JSONObject read() throws IOException, JSONException, LocalSourceStore.StoreException {
        atomicPaths();
        File backup = child(root, "journal.json.bak");
        if (backup.exists()) {
            // Legacy AtomicFile backup is committed authority, unlike an unfinished .new.
            try (java.io.InputStream ignored = new AtomicFile(file).openRead()) { /* restores .bak */ }
            syncDirectory(root);
        }
        String raw;
        try (FileInputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (bytes.size() + count > MAX_FILE_BYTES) throw invalid();
                bytes.write(buffer, 0, count);
            }
            raw = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
        }
        Object parsed = new StrictJson(raw).parse(); if (!(parsed instanceof JSONObject)) throw invalid();
        JSONObject result = (JSONObject) parsed;
        fields(result, "revision", "state");
        String revision = string(result, "revision");
        revision(revision);
        JSONObject normalized = envelope(revision, validateState(object(result, "state")));
        // Strict canonical equality also rejects lenient JSON, duplicate fields and trailing data.
        if (!raw.equals(canonical(normalized))) throw error("CORRUPT", "同步日记不一致，请保留应用数据。");
        syncDirectory(root); // A reopened load also establishes durability after a lost commit response.
        return normalized;
    }
    private void install(JSONObject result) throws IOException, LocalSourceStore.StoreException, JSONException {
        atomicPaths(); String raw = canonical(result);
        AtomicFile atomic = new AtomicFile(file); FileOutputStream output = null; boolean finished = false;
        try {
            output = atomic.startWrite(); output.write(raw.getBytes(StandardCharsets.UTF_8)); output.getFD().sync();
            inject("before-atomic-finish"); atomic.finishWrite(output); finished = true;
        } finally { if (!finished && output != null) atomic.failWrite(output); }
        try {
            syncDirectory(root);
            if (!raw.equals(canonical(read()))) throw new IOException("Installed sync journal differs from commit");
        } catch (IOException | JSONException exception) { throw unknown(exception); }
    }
    private JSONObject validateState(JSONObject state) throws LocalSourceStore.StoreException, JSONException {
        fields(state, "format", "version", "replicaId", "libraryId", "context", "events");
        if (!context.equals(string(state, "context"))) throw error("SYNC_SCOPE", "同步日记不属于当前资料库。");
        if (!"zhixu-source-sync".equals(string(state, "format")) || number(state.opt("version"), 1) != 1) throw invalid();
        uuid(string(state, "replicaId")); uuid(string(state, "libraryId"));
        JSONArray rawEvents = array(state, "events"), events = new JSONArray();
        if (rawEvents.length() > 2000) throw limit();
        Map<String, JSONObject> known = new HashMap<>(); Map<String, Long> vector = new HashMap<>();
        Map<String, String> authored = new HashMap<>(); Set<String> sources = new HashSet<>();
        for (int i = 0; i < rawEvents.length(); i++) {
            Object raw = rawEvents.opt(i); if (!(raw instanceof JSONObject)) throw invalid();
            JSONObject item = (JSONObject) raw;
            fields(item, "id", "replicaId", "sequence", "sourceId", "parents", "operation", "value");
            String replica = string(item, "replicaId"), source = string(item, "sourceId"), id = string(item, "id");
            uuid(replica); uuid(source); long sequence = number(item.opt("sequence"), 1);
            if (!id.equals(replica + ":" + sequence) || known.containsKey(id)) throw invalid();
            if (sequence != vector.getOrDefault(replica, 0L) + 1) throw error("SYNC_GAP", "同步序号缺少前序记录。");
            JSONArray rawParents = array(item, "parents"); if (rawParents.length() > 32) throw invalid();
            List<String> parents = new ArrayList<>(); Set<String> ancestors = new HashSet<>();
            for (int j = 0; j < rawParents.length(); j++) {
                Object parent = rawParents.opt(j); if (!(parent instanceof String) || parents.contains(parent)) throw invalid();
                JSONObject old = known.get(parent);
                if (old == null || !source.equals(old.getString("sourceId"))) throw error("SYNC_GAP", "同步父版本缺失或属于其他原文。");
                parents.add((String) parent);
            }
            List<String> visit = new ArrayList<>(parents);
            while (!visit.isEmpty()) {
                String parent = visit.remove(visit.size() - 1); if (!ancestors.add(parent)) continue;
                JSONArray previous = known.get(parent).getJSONArray("parents");
                for (int j = 0; j < previous.length(); j++) visit.add(previous.getString(j));
            }
            String authorKey = replica + "/" + source, previous = authored.get(authorKey);
            if (previous != null && !ancestors.contains(previous)) throw error("SYNC_GAP", "同一设备不能分叉自己的原文版本。");
            String operation = string(item, "operation"); Object value;
            if ("delete".equals(operation)) {
                if (item.opt("value") != JSONObject.NULL) throw invalid(); value = JSONObject.NULL;
            } else if ("put".equals(operation)) value = validateSource(object(item, "value"));
            else throw invalid();
            Collections.sort(parents); JSONArray sorted = new JSONArray(); for (String parent : parents) sorted.put(parent);
            JSONObject event = new JSONObject().put("id", id).put("replicaId", replica).put("sequence", sequence)
                .put("sourceId", source).put("parents", sorted).put("operation", operation).put("value", value);
            known.put(id, event); events.put(event); vector.put(replica, sequence); sources.add(source); authored.put(authorKey, id);
            if (sources.size() > 100 || vector.size() > 32) throw limit();
        }
        JSONObject result = new JSONObject().put("format", "zhixu-source-sync").put("version", 1)
            .put("replicaId", state.getString("replicaId")).put("libraryId", state.getString("libraryId"))
            .put("context", context).put("events", events);
        if (LocalSourceStore.validateUtf8(canonical(result)) > MAX_STATE_BYTES) throw limit();
        return result;
    }
    private static JSONObject validateSource(JSONObject input) throws LocalSourceStore.StoreException, JSONException {
        fields(input, "title", "body", "source"); JSONObject source = object(input, "source"); fields(source, SOURCE_FIELDS);
        String title = text(string(input, "title"), 800, true), body = text(string(input, "body"), 128 * 1024, false);
        // JS trim for titles includes BOM but excludes NEL. Bodies follow Android's blank definition instead.
        if (title.isEmpty() || title.codePointCount(0, title.length()) > 200 || jsTrimSpace(title.codePointAt(0))
            || jsTrimSpace(title.codePointBefore(title.length())) || body.indexOf('\0') >= 0 || blank(body)) throw invalid();
        JSONObject provenance = new JSONObject();
        for (String key : SOURCE_FIELDS) provenance.put(key, text(string(source, key), 8192, true));
        return new JSONObject().put("title", title).put("body", body).put("source", provenance);
    }
    private static boolean blank(String body) {
        for (int i = 0; i < body.length();) {
            int point = body.codePointAt(i); if (!Character.isWhitespace(point) && !Character.isSpaceChar(point)) return false;
            i += Character.charCount(point);
        }
        return true;
    }
    private static boolean jsTrimSpace(int point) {
        return point == 0xfeff || point == 0x9 || point == 0xa || point == 0xb || point == 0xc || point == 0xd
            || point == 0x2028 || point == 0x2029 || Character.isSpaceChar(point);
    }
    private static String text(String value, int limit, boolean singleLine) throws LocalSourceStore.StoreException {
        if (LocalSourceStore.validateUtf8(value) > limit) throw invalid();
        if (singleLine) for (int i = 0; i < value.length(); i++) if (value.charAt(i) < 32 || value.charAt(i) == 127) throw invalid();
        return value;
    }
    private static void uuid(String value) throws LocalSourceStore.StoreException { if (!value.matches(UUID_PATTERN)) throw invalid(); }
    private static long revision(String value) throws LocalSourceStore.StoreException {
        if (value == null || !value.matches("0|[1-9][0-9]{0,18}")) throw invalid();
        try { return Long.parseLong(value); } catch (NumberFormatException exception) { throw invalid(); }
    }
    private static long number(Object value, long min) throws LocalSourceStore.StoreException {
        if (!(value instanceof Number)) throw invalid(); double n = ((Number) value).doubleValue();
        if (!Double.isFinite(n) || n < min || n > 9007199254740991L || n != Math.floor(n)) throw invalid(); return (long) n;
    }
    private static String string(JSONObject input, String key) throws LocalSourceStore.StoreException { return LocalSourceStore.requireString(input, key); }
    private static JSONObject object(JSONObject input, String key) throws LocalSourceStore.StoreException {
        Object value = input.opt(key); if (!(value instanceof JSONObject)) throw invalid(); return (JSONObject) value;
    }
    private static JSONArray array(JSONObject input, String key) throws LocalSourceStore.StoreException {
        Object value = input.opt(key); if (!(value instanceof JSONArray)) throw invalid(); return (JSONArray) value;
    }
    private static void fields(JSONObject input, String... keys) throws LocalSourceStore.StoreException {
        if (input == null || input.length() != keys.length) throw invalid();
        for (String key : keys) if (!input.has(key)) throw invalid();
    }
    private static JSONObject envelope(String revision, JSONObject state) throws JSONException { return new JSONObject().put("revision", revision).put("state", state); }
    private static String canonical(Object value) throws LocalSourceStore.StoreException {
        StringBuilder out = new StringBuilder(); append(value, out, 0); return out.toString();
    }
    private static void append(Object value, StringBuilder out, int depth) throws LocalSourceStore.StoreException {
        if (depth > 10 || out.length() > MAX_FILE_BYTES) throw limit();
        if (value == JSONObject.NULL) out.append("null");
        else if (value instanceof String) quote((String) value, out);
        else if (value instanceof Number) out.append(number(value, 0));
        else if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value; List<String> keys = new ArrayList<>();
            for (Iterator<String> i = object.keys(); i.hasNext();) keys.add(i.next()); Collections.sort(keys);
            out.append('{'); boolean first = true;
            for (String key : keys) { if (!first) out.append(','); first = false; quote(key, out); out.append(':'); append(object.opt(key), out, depth + 1); } out.append('}');
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value; out.append('[');
            for (int i = 0; i < array.length(); i++) { if (i > 0) out.append(','); append(array.opt(i), out, depth + 1); } out.append(']');
        } else throw invalid();
        if (out.length() > MAX_FILE_BYTES) throw limit();
    }
    private static void quote(String value, StringBuilder out) throws LocalSourceStore.StoreException {
        LocalSourceStore.validateUtf8(value); out.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break; case '\\': out.append("\\\\"); break;
                case '\b': out.append("\\b"); break; case '\f': out.append("\\f"); break;
                case '\n': out.append("\\n"); break; case '\r': out.append("\\r"); break; case '\t': out.append("\\t"); break;
                default: if (c < 32) { out.append("\\u00").append(Character.forDigit(c >> 4, 16)).append(Character.forDigit(c & 15, 16)); } else out.append(c);
            }
        }
        out.append('"');
    }
    /** Bound recursion before Android's permissive JSONTokener can see corrupt private bytes. */
    private static final class StrictJson {
        final String raw; int offset; int nodes;
        StrictJson(String raw) { this.raw = raw; }
        Object parse() throws LocalSourceStore.StoreException, JSONException {
            Object result = value(0); whitespace(); if (offset != raw.length()) throw invalid(); return result;
        }
        Object value(int depth) throws LocalSourceStore.StoreException, JSONException {
            if (depth > 10 || ++nodes > 100000) throw limit(); whitespace(); if (offset >= raw.length()) throw invalid();
            char c = raw.charAt(offset);
            if (c == '{') {
                offset++; JSONObject result = new JSONObject(); Set<String> keys = new HashSet<>(); whitespace(); if (take('}')) return result;
                for (;;) {
                    whitespace(); String key = quoted(); if (!keys.add(key)) throw invalid(); whitespace(); require(':');
                    result.put(key, value(depth + 1)); whitespace(); if (take('}')) return result; require(',');
                }
            }
            if (c == '[') {
                offset++; JSONArray result = new JSONArray(); whitespace(); if (take(']')) return result;
                for (;;) { result.put(value(depth + 1)); whitespace(); if (take(']')) return result; require(','); }
            }
            if (c == '"') return quoted();
            if (raw.startsWith("null", offset)) { offset += 4; return JSONObject.NULL; }
            int start = offset;
            while (offset < raw.length() && "0123456789".indexOf(raw.charAt(offset)) >= 0) offset++;
            String number = raw.substring(start, offset);
            if (!number.matches("0|[1-9][0-9]{0,15}")) throw invalid();
            try { return Long.parseLong(number); } catch (NumberFormatException exception) { throw invalid(); }
        }
        String quoted() throws LocalSourceStore.StoreException {
            require('"'); StringBuilder result = new StringBuilder();
            while (offset < raw.length()) {
                char c = raw.charAt(offset++);
                if (c == '"') { String value = result.toString(); LocalSourceStore.validateUtf8(value); return value; }
                if (c < 32) throw invalid(); if (c != '\\') { result.append(c); continue; }
                if (offset >= raw.length()) throw invalid(); char escaped = raw.charAt(offset++);
                switch (escaped) {
                    case '"': case '\\': case '/': result.append(escaped); break;
                    case 'b': result.append('\b'); break; case 'f': result.append('\f'); break;
                    case 'n': result.append('\n'); break; case 'r': result.append('\r'); break; case 't': result.append('\t'); break;
                    case 'u':
                        if (offset + 4 > raw.length()) throw invalid(); String hex = raw.substring(offset, offset + 4);
                        if (!hex.matches("[0-9a-fA-F]{4}")) throw invalid(); result.append((char) Integer.parseInt(hex, 16)); offset += 4; break;
                    default: throw invalid();
                }
            }
            throw invalid();
        }
        void whitespace() { while (offset < raw.length() && " \t\r\n".indexOf(raw.charAt(offset)) >= 0) offset++; }
        boolean take(char c) { if (offset < raw.length() && raw.charAt(offset) == c) { offset++; return true; } return false; }
        void require(char c) throws LocalSourceStore.StoreException { if (!take(c)) throw invalid(); }
    }
    private static File child(File parent, String name) throws IOException {
        File absolute = parent.getAbsoluteFile(), result = new File(absolute, name);
        if (!absolute.equals(absolute.getCanonicalFile()) || !result.equals(result.getCanonicalFile())) throw new IOException("Unsafe private sync path");
        if (result.exists() && !result.isFile() && !result.isDirectory()) throw new IOException("Unsafe private sync type"); return result;
    }
    private static void directory(File directory) throws IOException {
        if (!directory.getAbsoluteFile().equals(directory.getCanonicalFile()) || (!directory.isDirectory() && !directory.mkdirs())) throw new IOException("Unsafe sync directory");
    }
    private void atomicPaths() throws IOException {
        for (String name : Arrays.asList("journal.json", "journal.json.new", "journal.json.bak")) {
            File target = child(root, name); if (target.exists() && !target.isFile()) throw new IOException("Unsafe sync file type");
        }
    }
    private static void syncDirectory(File directory) throws IOException {
        FileDescriptor fd = null;
        try { fd = Os.open(directory.getPath(), OsConstants.O_RDONLY, 0); Os.fsync(fd); }
        catch (ErrnoException exception) { throw new IOException("Cannot sync journal directory", exception); }
        finally { if (fd != null) try { Os.close(fd); } catch (ErrnoException exception) { throw new IOException(exception); } }
    }
    private static LocalSourceStore.StoreException error(String code, String message) { return new LocalSourceStore.StoreException(code, message); }
    private static LocalSourceStore.StoreException invalid() { return error("SYNC_INVALID", "同步状态或身份无效；不能替换已有历史。"); }
    private static LocalSourceStore.StoreException limit() { return error("SYNC_LIMIT", "同步日记超过容量；不能丢弃历史或墓碑。"); }
    private static LocalSourceStore.StoreException storageError(Exception cause) {
        LocalSourceStore.StoreException result = error("STORE_ERROR", "同步提交可能未完成；请保留输入并重新读取已保存日记核对，勿直接确认游标。"); result.initCause(cause); return result;
    }
    private static LocalSourceStore.StoreException unknown(Exception cause) {
        LocalSourceStore.StoreException result = error("SYNC_COMMIT_UNKNOWN", "同步日记可能已提交，但回执或持久性未确认；请重新读取，勿直接确认游标。"); result.initCause(cause); return result;
    }
}
