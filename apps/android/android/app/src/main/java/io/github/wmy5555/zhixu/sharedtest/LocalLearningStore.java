package io.github.wmy5555.zhixu.sharedtest;

import android.content.Context;
import android.os.SystemClock;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.util.AtomicFile;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.CharacterCodingException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.LongSupplier;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Offline learning library. Immutable Markdown is authoritative; one manifest commits all runtime state. */
public final class LocalLearningStore {
    static final int MAX_BACKUP_BYTES = 16 * 1024 * 1024;
    static final int MAX_RUNTIME_BYTES = 8 * 1024 * 1024;
    static final int MAX_NOTES = 200;
    static final int MAX_SNAPSHOTS = 1000;
    static final int MAX_JSON_DEPTH = 16;
    static final int MAX_JSON_NODES = 100000;
    static final long PREVIEW_TTL_MS = 5 * 60 * 1000;
    static final String BACKUP_FORMAT = "zhixu-android-learning-backup";
    private static final String MANIFEST_FORMAT = "zhixu-local-learning-manifest";
    private static final String NOTE_FORMAT = "zhixu-local-learning-note";
    private static final int MAX_MARKDOWN_BYTES = 320 * 1024;
    private static final Object LOCK = new Object();
    private final String context;
    private final File root;
    private final File objects;
    private final File manifestFile;
    private Preview preview;
    private FailurePoint failurePoint;
    private CleanupFailurePoint cleanupFailurePoint;
    private String durableManifestHash;
    private LongSupplier clock = SystemClock::elapsedRealtime;

    // Only synthetic device regressions inject failures. No plugin or web entry point can set this.
    interface FailurePoint { void at(String stage) throws IOException; }
    interface CleanupFailurePoint { void at(String operation) throws IOException; }
    void setFailurePoint(FailurePoint value) { synchronized (LOCK) { failurePoint = value; } }
    void setCleanupFailurePointForTests(CleanupFailurePoint value) { synchronized (LOCK) { cleanupFailurePoint = value; } }
    void setClockForTests(LongSupplier value) { synchronized (LOCK) { clock = value; } }

    /** Only ordinary housekeeping I/O is deferrable; path/type checks keep their original hard failures. */
    private static final class DeferredCleanupException extends IOException {
        private static final long serialVersionUID = 1L;
        DeferredCleanupException(String message) { super(message); }
        DeferredCleanupException(IOException cause) { super(cause); }
    }

    private static final class Snapshot {
        final JSONObject manifest;
        final JSONObject state;
        final Map<String, String> documents;
        Snapshot(JSONObject manifest, JSONObject state, Map<String, String> documents) {
            this.manifest = manifest; this.state = state; this.documents = documents;
        }
        String revision() { return manifest.optString("revision"); }
    }

    private static final class Preview {
        final String token;
        final String revision;
        final long expiresAt;
        final Snapshot incoming;
        Preview(String revision, Snapshot incoming, long now) {
            token = UUID.randomUUID().toString(); this.revision = revision; this.incoming = incoming;
            expiresAt = now + PREVIEW_TTL_MS;
        }
    }

    public LocalLearningStore(Context application, String context) throws LocalSourceStore.StoreException {
        this(privateBase(application), context);
    }

    private static File privateBase(Context application) throws LocalSourceStore.StoreException {
        try { return new File(application.getFilesDir().getCanonicalFile(), "local-learning-v1"); }
        catch (IOException exception) { throw storageError(); }
    }

    // Parent is a disposable app-cache directory in instrumentation tests, never an arbitrary web path.
    LocalLearningStore(File parent, String context) throws LocalSourceStore.StoreException {
        validateContext(context);
        this.context = context;
        synchronized (LOCK) {
            try {
                safeDirectory(parent);
                root = safeChild(parent, context);
                safeDirectory(root);
                objects = safeChild(root, "objects");
                safeDirectory(objects);
                manifestFile = safeChild(root, "manifest.json");
                readSnapshot(); // Recovery validates references; corrupt data is never replaced with an empty library.
            } catch (IOException exception) { throw storageError(); }
        }
    }

    public JSONObject load() throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            try { return envelope(readSnapshot()); }
            catch (IOException | JSONException exception) { throw storageError(); }
        }
    }

    public JSONObject commit(String expectedRevision, JSONObject state) throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            try {
                Snapshot current = readSnapshot();
                requireRevision(current, expectedRevision);
                JSONObject nextState = validateState(state);
                if (canonical(current.state).equals(canonical(nextState))) return envelope(current);
                JSONArray refs = new JSONArray();
                Map<String, String> documents = new TreeMap<>();
                Map<String, JSONObject> nextById = new TreeMap<>();
                JSONArray notes = nextState.getJSONArray("notes");
                for (int index = 0; index < notes.length(); index++) {
                    JSONObject note = notes.getJSONObject(index);
                    String raw = markdown(note);
                    String file = digest(raw) + ".md";
                    JSONObject ref = reference(note.getString("id"), file);
                    refs.put(ref); documents.put(file, raw); nextById.put(note.getString("id"), ref);
                }
                Map<String, JSONObject> history = new TreeMap<>();
                JSONArray existingHistory = current.manifest.getJSONArray("history");
                for (int index = 0; index < existingHistory.length(); index++) {
                    JSONObject ref = existingHistory.getJSONObject(index);
                    history.put(refKey(ref), ref);
                }
                JSONArray previous = current.manifest.getJSONArray("notes");
                for (int index = 0; index < previous.length(); index++) {
                    JSONObject ref = previous.getJSONObject(index);
                    JSONObject next = nextById.get(ref.getString("id"));
                    if (next == null || !next.getString("file").equals(ref.getString("file"))) history.put(refKey(ref), ref);
                }
                JSONArray retained = new JSONArray();
                for (JSONObject ref : history.values()) {
                    retained.put(ref); documents.put(ref.getString("file"), current.documents.get(ref.getString("file")));
                }
                Snapshot next = snapshot(makeManifest(UUID.randomUUID().toString(), refs, retained, nextState), documents);
                ensureExportable(next);
                persist(next, current);
                return envelope(next);
            } catch (IOException | JSONException exception) { throw storageError(); }
        }
    }

    public JSONObject reset(String expectedRevision) throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            if (!"practice".equals(context)) throw invalid("正式学习库不能通过练习清空操作删除。");
            try {
                Snapshot current = readSnapshot();
                requireRevision(current, expectedRevision);
                Snapshot next = snapshot(makeManifest(UUID.randomUUID().toString(), new JSONArray(), new JSONArray(), emptyState()), new TreeMap<>());
                // Reset commits the empty manifest before old objects become eligible for deferred cleanup.
                persist(next, current);
                return envelope(next);
            } catch (IOException | JSONException exception) { throw storageError(); }
        }
    }

    public JSONObject backup() throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            try { return packageSnapshot(readSnapshot()); }
            catch (IOException | JSONException exception) { throw storageError(); }
        }
    }

    public JSONObject previewRestore(JSONObject pack) throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            try {
                Snapshot incoming = validatePackage(pack);
                Snapshot current = readSnapshot();
                boolean identical = identity(current).equals(identity(incoming));
                preview = new Preview(current.revision(), incoming, clock.getAsLong());
                return new JSONObject().put("token", preview.token).put("context", context)
                    .put("notes", incoming.state.getJSONArray("notes").length())
                    .put("history", incoming.manifest.getJSONArray("history").length())
                    .put("canRestore", empty(current) || identical).put("identical", identical)
                    // Transport validates with the exact JS schema, then removes this before presenting the summary.
                    .put("candidateState", copyObject(incoming.state));
            } catch (IOException | JSONException exception) { throw storageError(); }
        }
    }

    public JSONObject restoreBackup(String token) throws LocalSourceStore.StoreException {
        synchronized (LOCK) {
            Preview selected = preview;
            preview = null; // Single use, including conflicts and stale previews.
            if (selected == null || !selected.token.equals(token) || clock.getAsLong() > selected.expiresAt) throw expired();
            try {
                Snapshot current = readSnapshot();
                if (!selected.revision.equals(current.revision())) throw expired();
                // Recheck the same cached snapshot before either an idempotent response or a disk write.
                Snapshot incoming = snapshot(copyObject(selected.incoming.manifest), selected.incoming.documents);
                ensureExportable(incoming);
                if (identity(current).equals(identity(incoming))) {
                    return envelope(current).put("restored", false).put("unchanged", true);
                }
                if (!empty(current)) throw new LocalSourceStore.StoreException("CONFLICT", "当前学习库已有不同内容；请保留现有内容，不能覆盖恢复。");
                JSONObject manifest = copyObject(incoming.manifest);
                manifest.put("revision", UUID.randomUUID().toString());
                Snapshot next = snapshot(manifest, incoming.documents);
                ensureExportable(next);
                persist(next, current);
                return envelope(next).put("restored", true).put("unchanged", false);
            } catch (IOException | JSONException exception) { throw storageError(); }
        }
    }

    static JSONObject readPackage(InputStream input) throws IOException, LocalSourceStore.StoreException {
        return parseObject(SourceDocumentFiles.readUtf8(input, MAX_BACKUP_BYTES));
    }

    static void writePackage(JSONObject pack, OutputStream output) throws IOException, LocalSourceStore.StoreException {
        String raw = canonical(pack);
        if (LocalSourceStore.validateUtf8(raw) > MAX_BACKUP_BYTES) throw capacity();
        output.write(raw.getBytes(StandardCharsets.UTF_8));
        output.flush();
    }

    static void validateContext(String context) throws LocalSourceStore.StoreException {
        if (!"formal".equals(context) && !"practice".equals(context)) throw invalid("请选择正式学习或独立练习。");
    }

    private Snapshot readSnapshot() throws IOException, LocalSourceStore.StoreException {
        safeAtomicPath(manifestFile);
        if (!manifestFile.exists() && !safeChild(root, "manifest.json.bak").exists()) {
            // AtomicFile .new is uncommitted, including an interrupted first commit.
            try {
                Snapshot empty = snapshot(makeManifest("empty", new JSONArray(), new JSONArray(), emptyState()), new TreeMap<>());
                collectRecoveredSnapshot(empty, false);
                return empty;
            }
            catch (JSONException exception) { throw corrupt(); }
        }
        try {
            boolean atomicRecovery = safeChild(root, "manifest.json.bak").exists();
            JSONObject manifest = parseObject(readAtomic(manifestFile, MAX_RUNTIME_BYTES + 1024 * 1024));
            validateManifest(manifest);
            Map<String, String> documents = new TreeMap<>();
            for (String field : Arrays.asList("notes", "history")) {
                JSONArray refs = manifest.getJSONArray(field);
                for (int index = 0; index < refs.length(); index++) {
                    String name = refs.getJSONObject(index).getString("file");
                    if (!documents.containsKey(name)) {
                        File file = safeChild(objects, name);
                        if (!file.exists() && !safeChild(objects, name + ".bak").exists()) throw corrupt();
                        if (safeChild(objects, name + ".bak").exists()) atomicRecovery = true;
                        documents.put(name, readAtomic(file, MAX_MARKDOWN_BYTES));
                    }
                }
            }
            Snapshot result = snapshot(manifest, documents);
            ensureExportable(result);
            // All references are proven before cleanup. A corrupt manifest or Markdown never triggers guessing.
            collectRecoveredSnapshot(result, atomicRecovery);
            return result;
        } catch (LocalSourceStore.StoreException | JSONException exception) { throw corrupt(); }
    }

    private void persist(Snapshot next, Snapshot current) throws IOException, LocalSourceStore.StoreException {
        // A real new write must clear owned residue first, preserving the current authority/history.
        // Ordinary reads may defer cleanup, but accumulating new orphan bytes is not a capacity strategy.
        collectUnreferenced(current.documents.keySet(), true);
        for (Map.Entry<String, String> document : next.documents.entrySet()) {
            File file = safeChild(objects, document.getKey());
            safeAtomicPath(file);
            if (file.exists() || safeChild(objects, document.getKey() + ".bak").exists()) {
                if (!document.getValue().equals(readAtomic(file, MAX_MARKDOWN_BYTES))) throw corrupt();
            } else writeAtomic(file, document.getValue());
        }
        syncDirectory(objects);
        inject("before-manifest");
        String rawManifest = canonical(next.manifest);
        writeAtomic(manifestFile, rawManifest);
        inject("before-manifest-directory-sync");
        syncDirectory(root);
        durableManifestHash = digest(rawManifest);
        inject("after-manifest");
        // Orphaned staging documents from a previous pre-commit failure are never exported as history.
        collectAfterValidation(next.documents.keySet());
    }

    private void inject(String stage) throws IOException { if (failurePoint != null) failurePoint.at(stage); }

    private void collectRecoveredSnapshot(Snapshot snapshot, boolean atomicRecovery) throws IOException, LocalSourceStore.StoreException {
        // Seeing a renamed manifest is not proof that the rename survived a process/power interruption.
        // AtomicFile.openRead may also have restored .bak directory entries. Make the verified authority
        // durable before deleting objects that the previous authority could still reference.
        String manifestHash = digest(canonical(snapshot.manifest));
        if (atomicRecovery || !manifestHash.equals(durableManifestHash)) {
            inject("before-recovery-sync");
            requireCleanupPath(objects, true);
            requireCleanupPath(root, true);
            syncDirectory(objects);
            syncDirectory(root);
            durableManifestHash = manifestHash;
        }
        // An unchanged authority already synced by this instance needs no new mandatory fsync merely
        // because an orphan's cleanup sync failed. A fresh instance or any .bak recovery rechecks durability.
        collectAfterValidation(snapshot.documents.keySet());
    }

    private void collectAfterValidation(Set<String> retained) throws IOException {
        try { collectUnreferenced(retained, false); }
        catch (DeferredCleanupException ignored) {
            // References have been verified, or the new manifest and directory are already durable.
            // Cleanup can retry on the next read/reopen without converting the known revision into a failure.
        }
    }

    private void collectUnreferenced(Set<String> retained, boolean syncBeforeWrite) throws IOException {
        requireCleanupPath(objects, true);
        injectCleanupFailure("list");
        File[] files = objects.listFiles();
        if (files == null) throw new DeferredCleanupException("Cannot enumerate private documents");
        List<File> owned = new ArrayList<>();
        // Check the entire recognized set before deleting any bytes; unknown names remain untouched.
        for (File file : files) {
            String name = file.getName();
            String base = name.endsWith(".new") || name.endsWith(".bak") ? name.substring(0, name.length() - 4) : name;
            if (!base.matches("[0-9a-f]{64}\\.md")) continue;
            File candidate = safeChild(objects, name);
            requireCleanupPath(candidate, false);
            if (!retained.contains(base)) owned.add(candidate);
        }
        boolean removed = false;
        for (File file : owned) {
            requireCleanupPath(file, false);
            injectCleanupFailure("delete");
            if (!file.delete() && file.exists()) throw new DeferredCleanupException("Cannot remove unreferenced private document");
            removed = true;
        }
        if (removed || syncBeforeWrite) {
            requireCleanupPath(objects, true);
            injectCleanupFailure("sync");
            try { syncDirectory(objects); }
            catch (IOException exception) { throw new DeferredCleanupException(exception); }
        }
    }

    private void injectCleanupFailure(String operation) throws DeferredCleanupException {
        if (cleanupFailurePoint == null) return;
        try { cleanupFailurePoint.at(operation); }
        catch (IOException exception) { throw new DeferredCleanupException(exception); }
    }

    private static void requireCleanupPath(File file, boolean directory) throws IOException {
        if (!file.getAbsoluteFile().equals(file.getCanonicalFile())) throw new IOException("Unsafe private learning cleanup path");
        try {
            int mode = Os.lstat(file.getPath()).st_mode;
            if (directory ? !OsConstants.S_ISDIR(mode) : !OsConstants.S_ISREG(mode)) throw new IOException("Unsafe private learning cleanup entry");
        } catch (ErrnoException exception) { throw new IOException("Cannot inspect private learning cleanup path", exception); }
    }

    private Snapshot validatePackage(JSONObject pack) throws LocalSourceStore.StoreException {
        try {
            boundedJson(pack, MAX_BACKUP_BYTES);
            fields(pack, "format", "version", "context", "createdAt", "manifest", "documents");
            if (!BACKUP_FORMAT.equals(pack.opt("format")) || !versionOne(pack.opt("version"))) throw invalid("这不是受支持的手机学习备份；原始资料备份请在资料页恢复。");
            if (!context.equals(pack.opt("context"))) throw invalid("正式学习备份和练习备份不能混用。");
            if (!LocalSourceStore.validTimestamp(string(pack, "createdAt"))) throw invalid("备份时间格式不正确。");
            JSONObject manifest = object(pack, "manifest");
            validateManifest(manifest);
            JSONArray docs = array(pack, "documents");
            if (docs.length() > MAX_SNAPSHOTS) throw capacity();
            Map<String, String> documents = new TreeMap<>();
            for (int index = 0; index < docs.length(); index++) {
                JSONObject document = objectAt(docs, index);
                fields(document, "file", "raw");
                String file = string(document, "file");
                validateFile(file);
                if (documents.put(file, string(document, "raw")) != null) throw invalid("备份包含重复的笔记快照。");
            }
            Snapshot incoming = snapshot(copyObject(manifest), documents);
            ensureExportable(incoming);
            return incoming;
        } catch (JSONException exception) { throw invalid("学习备份字段格式不正确。"); }
    }

    private Snapshot snapshot(JSONObject manifest, Map<String, String> documents) throws JSONException, LocalSourceStore.StoreException {
        validateManifest(manifest);
        Map<String, JSONObject> parsed = new TreeMap<>();
        Set<String> referenced = new HashSet<>();
        JSONArray notes = new JSONArray();
        for (String field : Arrays.asList("notes", "history")) {
            JSONArray refs = manifest.getJSONArray(field);
            for (int index = 0; index < refs.length(); index++) {
                JSONObject ref = refs.getJSONObject(index);
                String file = ref.getString("file");
                String raw = documents.get(file);
                if (raw == null || !file.equals(digest(raw) + ".md")) throw corrupt();
                JSONObject note = parsed.get(file);
                if (note == null) { note = parseMarkdown(raw); parsed.put(file, note); }
                if (!ref.getString("id").equals(note.getString("id"))) throw corrupt();
                referenced.add(file);
                if ("notes".equals(field)) notes.put(note);
            }
        }
        if (!referenced.equals(documents.keySet())) throw corrupt();
        JSONObject state = new JSONObject().put("notes", notes).put("records", manifest.getJSONObject("records"))
            .put("settings", manifest.getJSONObject("settings")).put("guide", manifest.getJSONObject("guide"));
        return new Snapshot(manifest, validateState(state), new TreeMap<>(documents));
    }

    private void validateManifest(JSONObject manifest) throws LocalSourceStore.StoreException {
        fields(manifest, "format", "version", "context", "revision", "notes", "history", "records", "settings", "guide");
        if (!MANIFEST_FORMAT.equals(manifest.opt("format")) || !versionOne(manifest.opt("version")) || !context.equals(manifest.opt("context"))) throw corrupt();
        String revision = string(manifest, "revision");
        if (!"empty".equals(revision)) LocalSourceStore.validateId(revision);
        JSONArray notes = array(manifest, "notes");
        JSONArray history = array(manifest, "history");
        if (notes.length() > MAX_NOTES || notes.length() + history.length() > MAX_SNAPSHOTS) throw capacity();
        Set<String> ids = new HashSet<>();
        Set<String> versions = new HashSet<>();
        for (String field : Arrays.asList("notes", "history")) {
            JSONArray refs = array(manifest, field);
            for (int index = 0; index < refs.length(); index++) {
                JSONObject ref = objectAt(refs, index);
                fields(ref, "id", "file");
                LocalSourceStore.validateId(string(ref, "id"));
                validateFile(string(ref, "file"));
                if ("notes".equals(field) ? !ids.add(string(ref, "id")) : !versions.add(refKey(ref))) throw corrupt();
            }
        }
        validateRuntime(object(manifest, "records"), object(manifest, "settings"), object(manifest, "guide"));
    }

    private JSONObject validateState(JSONObject input) throws LocalSourceStore.StoreException {
        fields(input, "notes", "records", "settings", "guide");
        validateClientJson(input, 0, new int[] { 0 });
        JSONArray notes = array(input, "notes");
        if (notes.length() > MAX_NOTES) throw capacity();
        Set<String> ids = new HashSet<>();
        for (int index = 0; index < notes.length(); index++) {
            JSONObject note = objectAt(notes, index);
            validateNote(note);
            if (!ids.add(string(note, "id"))) throw invalid("学习库包含重复笔记标识。");
        }
        validateRuntime(object(input, "records"), object(input, "settings"), object(input, "guide"));
        boundedJson(input, MAX_BACKUP_BYTES);
        return copyObject(input);
    }

    private void validateNote(JSONObject note) throws LocalSourceStore.StoreException {
        fields(note, "id", "kind", "title", "body", "meta", "hash");
        validateClientJson(note, 0, new int[] { 0 });
        LocalSourceStore.validateId(string(note, "id"));
        String kind = string(note, "kind");
        if (!Arrays.asList("knowledge", "topic", "mistake").contains(kind) && !("practice".equals(context) && "source".equals(kind))) throw invalid("正式学习库只保存知识、专题和错题；原始资料保存在独立资料库。");
        String title = clientText(note.opt("title"), 800, false);
        // Match the persisted JavaScript string limit (UTF-16 units), including supplementary emoji.
        if (title.length() > 200 || title.matches("(?s).*[\\x00-\\x1f\\x7f-\\x9f].*")) throw invalid("笔记标题最多 200 个字符，不能包含控制字符。");
        clientText(note.opt("body"), 128 * 1024, false);
        clientText(note.opt("hash"), 256, false);
        JSONObject meta = object(note, "meta");
        for (String key : Arrays.asList("stage", "depth", "privacy", "claimType", "correctionState", "processKey", "reviewAfter", "supersededBy", "confirmedAt")) {
            if (meta.has(key) && !meta.isNull(key)) clientText(meta.opt(key), 1024, false);
        }
        optionalChoice(meta, "stage", "reference", "candidate", "learning", "integrated", "core", "retired");
        optionalChoice(meta, "depth", "aware", "find", "explain", "apply");
        optionalChoice(meta, "privacy", "local", "cloud");
        for (String key : Arrays.asList("noteIds", "prerequisites", "researchLimitations", "sessions")) {
            if (meta.has(key)) clientStrings(meta.opt(key), "noteIds".equals(key) ? 500 : "sessions".equals(key) ? 1000 : 100);
        }
        for (String key : Arrays.asList("paused", "userEdited", "userStructured", "demo", "practice")) {
            if (meta.has(key) && !(meta.opt(key) instanceof Boolean)) throw invalid("笔记属性中的开关格式不正确。");
        }
        // Date.parse and Intl have platform-specific accepted forms. Exact JS preflight also runs in transport.
        if (meta.has("sources")) {
            JSONArray sources = array(meta, "sources");
            if (sources.length() > 100) throw invalid("来源引用过多。");
            for (int index = 0; index < sources.length(); index++) {
                JSONObject ref = objectAt(sources, index);
                clientText(ref.opt("id"), 256, false);
                clientText(ref.opt("role"), 64, false);
                if (ref.has("hash")) clientText(ref.opt("hash"), 256, false);
            }
        }
        boundedJson(meta, 160 * 1024);
    }

    private static void validateRuntime(JSONObject records, JSONObject settings, JSONObject guide) throws LocalSourceStore.StoreException {
        try {
            JSONObject runtime = new JSONObject().put("records", records).put("settings", settings).put("guide", guide);
            validateClientJson(runtime, 0, new int[] { 0 });
            int count = 0;
            for (Iterator<String> keys = records.keys(); keys.hasNext();) {
                String namespace = keys.next();
                if (!Arrays.asList("sessions", "plans", "reviews", "studyEvidence", "topics", "jobs", "relations").contains(namespace)) throw invalid("学习记录包含不受支持的分类。");
                JSONObject entries = object(records, namespace);
                count += entries.length();
                if (count > 2000) throw invalid("学习记录条目过多。");
                for (Iterator<String> ids = entries.keys(); ids.hasNext();) {
                    String id = ids.next(); clientText(id, 256, false);
                    JSONObject record = object(entries, id);
                    if ("sessions".equals(namespace)) validateSession(record);
                    else if ("studyEvidence".equals(namespace)) validateOfflineEvidence(record);
                    else if ("jobs".equals(namespace)) throw invalid("手机学习库不能恢复模型任务。");
                    else if ("plans".equals(namespace)) {
                        requiredChoice(record, "state", "pending", "done", "skip", "defer", "pause", "budget_deferred", "paused");
                        finiteNumber(record.opt("minutes"));
                    }
                }
            }
            validateSettings(settings);
            boundedJson(runtime, MAX_RUNTIME_BYTES);
        }
        catch (JSONException exception) { throw invalid("学习记录格式不正确。"); }
    }

    private static void validateSession(JSONObject record) throws LocalSourceStore.StoreException {
        clientText(record.opt("id"), 256, false);
        clientText(record.opt("noteId"), 256, false);
        clientText(record.opt("sourceHash"), 256, false);
        requiredChoice(record, "status", "reading", "unassessed", "completed");
        clientText(record.opt("material"), 128 * 1024, false);
        if (truthy(record.opt("pendingJobId")) || record.has("feedback")) throw invalid("离线学习记录不能包含模型反馈或待处理模型任务。");
        integerRange(record.opt("hintCount"), 0, 1000);
        JSONArray turns = array(record, "turns");
        if (turns.length() > 500) throw invalid("单次学习回答过多。");
        for (int index = 0; index < turns.length(); index++) {
            JSONObject turn = objectAt(turns, index);
            clientText(turn.opt("id"), 256, false);
            clientText(turn.opt("requestId"), 128, false);
            clientText(turn.opt("answer"), 128 * 1024, false);
            if (!(turn.opt("hintUsed") instanceof Boolean) || !"unassessed".equals(turn.opt("assessment")) || turn.has("feedback")) throw invalid("回答必须保留为尚未评估的离线记录。");
        }
        if ("completed".equals(record.opt("status"))) {
            JSONObject completion = object(record, "completion");
            if (turns.length() == 0 || !Boolean.FALSE.equals(completion.opt("reviewSettled")) || !completion.has("interval") || completion.opt("interval") != JSONObject.NULL) throw invalid("离线完成记录不能结算复习间隔。");
            validateOfflineEvidence(object(completion, "evidence"));
        }
    }

    private static void validateOfflineEvidence(JSONObject record) throws LocalSourceStore.StoreException {
        if (!"unassessed".equals(record.opt("assessment"))) throw invalid("离线学习证据必须保留为尚未评估。");
        for (String key : Arrays.asList("reviewSettled", "independent", "explanationPractice", "applicationPractice", "spacedRecall")) {
            if (!Boolean.FALSE.equals(record.opt(key))) throw invalid("离线记录不能声明已评估掌握或已结算复习。");
        }
    }

    private static void validateSettings(JSONObject settings) throws LocalSourceStore.StoreException {
        Set<String> allowed = new HashSet<>(Arrays.asList("dailyMinutes", "timezone", "scheduleTime", "focusTopics", "pausedIds", "discoveryDays"));
        for (Iterator<String> keys = settings.keys(); keys.hasNext();) if (!allowed.contains(keys.next())) throw invalid("学习设置包含不受支持的字段。");
        if (settings.has("dailyMinutes")) integerRange(settings.opt("dailyMinutes"), 5, 240);
        if (settings.has("discoveryDays")) integerRange(settings.opt("discoveryDays"), 1, 365);
        if (settings.has("scheduleTime") && !clientText(settings.opt("scheduleTime"), 128, false).matches("([01][0-9]|2[0-3]):[0-5][0-9]")) throw invalid("学习提醒时间格式不正确。");
        if (settings.has("focusTopics")) clientStrings(settings.opt("focusTopics"), 100);
        if (settings.has("pausedIds")) clientStrings(settings.opt("pausedIds"), 200);
        if (settings.has("timezone")) validateTimezone(clientText(settings.opt("timezone"), 128, false));
    }

    private static void validateTimezone(String zone) throws LocalSourceStore.StoreException {
        boolean[] system = new boolean[1];
        android.icu.util.TimeZone.getCanonicalID(zone, system);
        if (system[0]) return;
        for (String id : android.icu.util.TimeZone.getAvailableIDs()) if (id.equalsIgnoreCase(zone)) return;
        // New Intl versions also support numeric offsets. JS preflight determines WebView support.
        if (zone.matches("[+-]([01][0-9]|2[0-3])(:?[0-5][0-9])?")) return;
        // Keep newly introduced IANA zones readable on devices with older ICU data; JS checks the actual name.
        if (zone.matches("[A-Za-z][A-Za-z0-9._+-]*(/[A-Za-z0-9._+-]+)+")) return;
        throw invalid("学习时区格式不正确。");
    }

    private static void optionalChoice(JSONObject object, String key, String... choices) throws LocalSourceStore.StoreException {
        if (object.has(key)) requiredChoice(object, key, choices);
    }
    private static void requiredChoice(JSONObject object, String key, String... choices) throws LocalSourceStore.StoreException {
        if (!Arrays.asList(choices).contains(object.opt(key))) throw invalid("学习内容包含无效状态。");
    }
    private static double finiteNumber(Object value) throws LocalSourceStore.StoreException {
        if (!(value instanceof Number)) throw invalid("学习内容的数值格式不正确。");
        double number = ((Number) value).doubleValue();
        if (Double.isInfinite(number) || Double.isNaN(number)) throw invalid("学习内容包含无效数值。");
        return number;
    }
    private static void integerRange(Object value, int minimum, int maximum) throws LocalSourceStore.StoreException {
        double number = finiteNumber(value);
        if (number != Math.rint(number) || number < minimum || number > maximum) throw invalid("学习设置或记录的数值超出范围。");
    }
    private static boolean truthy(Object value) {
        if (value == null || value == JSONObject.NULL || Boolean.FALSE.equals(value)) return false;
        if (value instanceof Number) return ((Number) value).doubleValue() != 0;
        return !(value instanceof String) || !((String) value).isEmpty();
    }
    private static void clientStrings(Object value, int maximum) throws LocalSourceStore.StoreException {
        if (!(value instanceof JSONArray) || ((JSONArray) value).length() > maximum) throw invalid("学习内容的文本列表格式不正确或过长。");
        JSONArray list = (JSONArray) value;
        for (int index = 0; index < list.length(); index++) clientText(list.opt(index), 256, false);
    }
    private static String clientText(Object value, int maximum, boolean emptyAllowed) throws LocalSourceStore.StoreException {
        if (!(value instanceof String)) throw invalid("学习内容的文本格式不正确。");
        String text = (String) value;
        if (text.length() > maximum || text.indexOf('\0') >= 0 || LocalSourceStore.validateUtf8(text) > maximum || !emptyAllowed && jsBlank(text)) throw invalid("学习内容的文本无效或过长。");
        return text;
    }
    private static boolean jsBlank(String text) {
        for (int index = 0; index < text.length(); index++) {
            char ch = text.charAt(index);
            if (!(ch >= '\t' && ch <= '\r' || ch == ' ' || ch == '\u00a0' || ch == '\u1680' || ch >= '\u2000' && ch <= '\u200a' || ch == '\u2028' || ch == '\u2029' || ch == '\u202f' || ch == '\u205f' || ch == '\u3000' || ch == '\ufeff')) return false;
        }
        return true;
    }
    // Mirror persisted JS JSON limits, separately from raw Markdown/backup strings which can be larger.
    private static void validateClientJson(Object value, int depth, int[] nodes) throws LocalSourceStore.StoreException {
        if (depth > MAX_JSON_DEPTH || ++nodes[0] > MAX_JSON_NODES) throw invalid("学习内容层级或条目数量超过手机保存上限。");
        if (value == null || value == JSONObject.NULL || value instanceof Boolean) return;
        if (value instanceof String) { clientText(value, 128 * 1024, true); return; }
        if (value instanceof Number) { finiteNumber(value); return; }
        if (value instanceof JSONArray) {
            JSONArray list = (JSONArray) value;
            if (list.length() > 2000) throw invalid("学习内容的列表项过多。");
            for (int index = 0; index < list.length(); index++) validateClientJson(list.opt(index), depth + 1, nodes);
            return;
        }
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            if (object.length() > 2000) throw invalid("学习内容的对象字段过多。");
            for (Iterator<String> keys = object.keys(); keys.hasNext();) {
                String key = keys.next();
                if (key.isEmpty() || key.length() > 256 || Arrays.asList("__proto__", "prototype", "constructor").contains(key)) throw invalid("学习内容包含无效字段名。");
                validateClientJson(object.opt(key), depth + 1, nodes);
            }
            return;
        }
        throw invalid("学习内容不是受支持的 JSON。");
    }

    private String markdown(JSONObject note) throws LocalSourceStore.StoreException, JSONException {
        JSONObject header = new JSONObject().put("format", NOTE_FORMAT).put("version", 1);
        for (String field : Arrays.asList("id", "kind", "title", "meta", "hash")) header.put(field, note.get(field));
        String raw = "---\n" + canonical(header) + "\n---\n" + note.getString("body");
        if (LocalSourceStore.validateUtf8(raw) > MAX_MARKDOWN_BYTES) throw capacity();
        return raw;
    }

    private JSONObject parseMarkdown(String raw) throws LocalSourceStore.StoreException {
        if (LocalSourceStore.validateUtf8(raw) > MAX_MARKDOWN_BYTES || !raw.startsWith("---\n")) throw corrupt();
        int end = raw.indexOf("\n---\n", 4);
        if (end < 4) throw corrupt();
        JSONObject header = parseObject(raw.substring(4, end));
        fields(header, "format", "version", "id", "kind", "title", "meta", "hash");
        if (!NOTE_FORMAT.equals(header.opt("format")) || !versionOne(header.opt("version"))) throw corrupt();
        try {
            JSONObject note = new JSONObject();
            for (String field : Arrays.asList("id", "kind", "title", "meta", "hash")) note.put(field, header.get(field));
            note.put("body", raw.substring(end + 5));
            validateNote(note);
            return note;
        } catch (JSONException exception) { throw corrupt(); }
    }

    private JSONObject makeManifest(String revision, JSONArray notes, JSONArray history, JSONObject state) throws JSONException {
        return new JSONObject().put("format", MANIFEST_FORMAT).put("version", 1).put("context", context)
            .put("revision", revision).put("notes", notes).put("history", history)
            .put("records", state.getJSONObject("records")).put("settings", state.getJSONObject("settings")).put("guide", state.getJSONObject("guide"));
    }

    private JSONObject packageSnapshot(Snapshot snapshot) throws JSONException, LocalSourceStore.StoreException {
        JSONArray documents = new JSONArray();
        for (Map.Entry<String, String> entry : snapshot.documents.entrySet()) documents.put(new JSONObject().put("file", entry.getKey()).put("raw", entry.getValue()));
        JSONObject pack = new JSONObject().put("format", BACKUP_FORMAT).put("version", 1).put("context", context)
            .put("createdAt", LocalSourceStore.timestamp()).put("manifest", snapshot.manifest).put("documents", documents);
        boundedJson(pack, MAX_BACKUP_BYTES);
        return pack;
    }

    private void ensureExportable(Snapshot snapshot) throws JSONException, LocalSourceStore.StoreException { packageSnapshot(snapshot); }

    private String identity(Snapshot snapshot) throws LocalSourceStore.StoreException, JSONException {
        JSONObject manifest = copyObject(snapshot.manifest);
        manifest.remove("revision");
        JSONObject documents = new JSONObject();
        for (Map.Entry<String, String> entry : snapshot.documents.entrySet()) documents.put(entry.getKey(), entry.getValue());
        return digest(canonical(new JSONObject().put("manifest", manifest).put("documents", documents)));
    }

    private static boolean empty(Snapshot snapshot) {
        return snapshot.documents.isEmpty() && snapshot.state.optJSONObject("records").length() == 0
            && snapshot.state.optJSONObject("settings").length() == 0 && snapshot.state.optJSONObject("guide").length() == 0;
    }

    private static JSONObject emptyState() throws JSONException {
        return new JSONObject().put("notes", new JSONArray()).put("records", new JSONObject()).put("settings", new JSONObject()).put("guide", new JSONObject());
    }

    private static JSONObject envelope(Snapshot snapshot) throws JSONException, LocalSourceStore.StoreException {
        return new JSONObject().put("revision", snapshot.revision()).put("state", copyObject(snapshot.state));
    }

    private static JSONObject reference(String id, String file) throws JSONException { return new JSONObject().put("id", id).put("file", file); }
    private static String refKey(JSONObject ref) throws LocalSourceStore.StoreException { return string(ref, "id") + "/" + string(ref, "file"); }
    private static void requireRevision(Snapshot snapshot, String expected) throws LocalSourceStore.StoreException {
        if (expected == null || expected.length() > 64 || !snapshot.revision().equals(expected)) throw new LocalSourceStore.StoreException("CONFLICT", "学习内容已变化，请重新读取后再保存；当前输入仍可保留。");
    }
    private static void validateFile(String file) throws LocalSourceStore.StoreException {
        if (file == null || !file.matches("[0-9a-f]{64}\\.md")) throw invalid("学习备份包含无效文件标识。");
    }
    private static boolean versionOne(Object value) { return value instanceof Number && ((Number) value).doubleValue() == 1.0; }

    private static File safeChild(File parent, String name) throws IOException {
        File directory = parent.getAbsoluteFile();
        if (!directory.equals(directory.getCanonicalFile()) || name.contains("/") || name.contains("\\") || name.equals(".") || name.equals("..")) throw new IOException("Unsafe private path");
        File file = new File(directory, name);
        if (!file.equals(file.getCanonicalFile())) throw new IOException("Private symlink is not allowed");
        return file;
    }

    private static void safeDirectory(File directory) throws IOException {
        File absolute = directory.getAbsoluteFile();
        if (!absolute.equals(absolute.getCanonicalFile())) throw new IOException("Private symlink is not allowed");
        if (!absolute.isDirectory() && !absolute.mkdirs()) throw new IOException("Cannot create private directory");
    }

    private static void safeAtomicPath(File file) throws IOException {
        safeChild(file.getParentFile(), file.getName());
        safeChild(file.getParentFile(), file.getName() + ".new");
        safeChild(file.getParentFile(), file.getName() + ".bak");
    }

    private static String readAtomic(File file, int limit) throws IOException, LocalSourceStore.StoreException {
        safeAtomicPath(file);
        try (InputStream input = new AtomicFile(file).openRead()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer, 0, Math.min(buffer.length, limit - bytes.size() + 1))) != -1) {
                if (count == 0) { int one = input.read(); if (one == -1) break; bytes.write(one); }
                else bytes.write(buffer, 0, count);
                if (bytes.size() > limit) throw corrupt();
            }
            // Preserve every physical byte, including an unexpected BOM, for checksum/frontmatter validation.
            try {
                return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
            } catch (CharacterCodingException exception) { throw corrupt(); }
        }
    }

    private static void writeAtomic(File file, String raw) throws IOException, LocalSourceStore.StoreException {
        safeAtomicPath(file);
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream output = null;
        boolean finished = false;
        try {
            output = atomic.startWrite();
            output.write(raw.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
            atomic.finishWrite(output);
            finished = true;
            // AtomicFile logs some rename failures instead of throwing. Confirm the committed bytes.
            if (!raw.equals(readAtomic(file, MAX_BACKUP_BYTES))) throw new IOException("Private atomic commit incomplete");
        } finally { if (!finished && output != null) atomic.failWrite(output); }
    }

    private static void syncDirectory(File directory) throws IOException {
        FileDescriptor descriptor = null;
        try { descriptor = Os.open(directory.getPath(), OsConstants.O_RDONLY, 0); Os.fsync(descriptor); }
        catch (ErrnoException exception) { throw new IOException("Cannot sync private learning directory", exception); }
        finally { if (descriptor != null) try { Os.close(descriptor); } catch (ErrnoException exception) { throw new IOException("Cannot close private learning directory", exception); } }
    }

    private static String digest(String raw) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte value : bytes) { result.append(Character.forDigit((value >>> 4) & 15, 16)); result.append(Character.forDigit(value & 15, 16)); }
            return result.toString();
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }

    private static void fields(JSONObject input, String... expected) throws LocalSourceStore.StoreException {
        if (input == null) throw invalid("学习内容不能为空。");
        Set<String> allowed = new HashSet<>(Arrays.asList(expected));
        for (Iterator<String> keys = input.keys(); keys.hasNext();) if (!allowed.contains(keys.next())) throw invalid("学习内容包含不受支持的字段。");
        for (String key : expected) if (!input.has(key) || input.isNull(key)) throw invalid("学习内容缺少必要字段。");
    }

    private static String string(JSONObject input, String field) throws LocalSourceStore.StoreException { return LocalSourceStore.requireString(input, field); }
    private static JSONObject object(JSONObject input, String field) throws LocalSourceStore.StoreException {
        Object value = input.opt(field);
        if (!(value instanceof JSONObject)) throw invalid("学习内容的对象字段格式不正确。");
        return (JSONObject) value;
    }
    private static JSONArray array(JSONObject input, String field) throws LocalSourceStore.StoreException {
        Object value = input.opt(field);
        if (!(value instanceof JSONArray)) throw invalid("学习内容的列表字段格式不正确。");
        return (JSONArray) value;
    }
    private static JSONObject objectAt(JSONArray input, int index) throws LocalSourceStore.StoreException {
        Object value = input.opt(index);
        if (!(value instanceof JSONObject)) throw invalid("学习内容的列表项格式不正确。");
        return (JSONObject) value;
    }

    private static JSONObject copyObject(JSONObject input) throws LocalSourceStore.StoreException { return parseObject(canonical(input)); }

    private static void boundedJson(Object value, int limit) throws LocalSourceStore.StoreException {
        validateJson(value, 0, new int[] { 0 });
        if (LocalSourceStore.validateUtf8(canonical(value)) > limit) throw capacity();
    }

    private static void validateJson(Object value, int depth, int[] nodes) throws LocalSourceStore.StoreException {
        if (depth > MAX_JSON_DEPTH || ++nodes[0] > MAX_JSON_NODES) throw invalid("学习内容层级或条目数量超过手机保存上限。");
        if (value == null || value == JSONObject.NULL || value instanceof Boolean) return;
        if (value instanceof String) {
            String text = (String) value;
            if (text.length() > MAX_BACKUP_BYTES || text.indexOf('\0') >= 0) throw invalid("学习内容包含无效或过长文本。");
            LocalSourceStore.validateUtf8(text); return;
        }
        if (value instanceof Number) {
            try { JSONObject.numberToString((Number) value); return; }
            catch (JSONException exception) { throw invalid("学习内容包含无效数值。"); }
        }
        if (value instanceof JSONObject) {
            JSONObject obj = (JSONObject) value;
            for (Iterator<String> keys = obj.keys(); keys.hasNext();) {
                String key = keys.next();
                if (LocalSourceStore.validateUtf8(key) > 1024 || key.indexOf('\0') >= 0) throw invalid("学习内容字段名过长或无效。");
                validateJson(obj.opt(key), depth + 1, nodes);
            }
            return;
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int index = 0; index < array.length(); index++) validateJson(array.opt(index), depth + 1, nodes);
            return;
        }
        throw invalid("学习内容不是受支持的 JSON。");
    }

    // Stable JSON object order gives physical checksums and equality a meaning independent of key insertion order.
    private static String canonical(Object value) throws LocalSourceStore.StoreException {
        StringBuilder output = new StringBuilder();
        appendJson(value, output, 0);
        return output.toString();
    }

    private static void appendJson(Object value, StringBuilder output, int depth) throws LocalSourceStore.StoreException {
        if (depth > MAX_JSON_DEPTH + 4 || output.length() > MAX_BACKUP_BYTES) throw capacity();
        if (value == null || value == JSONObject.NULL) output.append("null");
        else if (value instanceof String) output.append(JSONObject.quote((String) value));
        else if (value instanceof Boolean) output.append(value);
        else if (value instanceof Number) {
            try { output.append(JSONObject.numberToString((Number) value)); }
            catch (JSONException exception) { throw invalid("学习内容包含无效数值。"); }
        } else if (value instanceof JSONObject) {
            JSONObject obj = (JSONObject) value;
            List<String> keys = new ArrayList<>();
            for (Iterator<String> iterator = obj.keys(); iterator.hasNext();) keys.add(iterator.next());
            Collections.sort(keys);
            output.append('{');
            boolean first = true;
            for (String key : keys) { if (!first) output.append(','); first = false; output.append(JSONObject.quote(key)).append(':'); appendJson(obj.opt(key), output, depth + 1); }
            output.append('}');
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            output.append('[');
            for (int index = 0; index < array.length(); index++) { if (index != 0) output.append(','); appendJson(array.opt(index), output, depth + 1); }
            output.append(']');
        } else throw invalid("学习内容不是受支持的 JSON。");
    }

    private static JSONObject parseObject(String raw) throws LocalSourceStore.StoreException {
        Object value = new StrictJson(raw).parse();
        if (!(value instanceof JSONObject)) throw invalid("请选择包含 JSON 对象的学习备份。");
        return (JSONObject) value;
    }

    /** Android JSONTokener accepts comments, bare keys and trailing data; backups deliberately accept strict JSON only. */
    private static final class StrictJson {
        final String raw;
        int offset;
        int nodes;
        StrictJson(String raw) throws LocalSourceStore.StoreException {
            if (raw == null || raw.length() > MAX_BACKUP_BYTES || LocalSourceStore.validateUtf8(raw) > MAX_BACKUP_BYTES) throw capacity();
            this.raw = raw;
        }
        Object parse() throws LocalSourceStore.StoreException {
            Object value = value(0);
            whitespace();
            if (offset != raw.length()) throw invalid("JSON 文件末尾包含多余内容。");
            return value;
        }
        Object value(int depth) throws LocalSourceStore.StoreException {
            if (depth > MAX_JSON_DEPTH + 4 || ++nodes > MAX_JSON_NODES + 10000) throw capacity();
            whitespace();
            if (offset >= raw.length()) throw invalid("JSON 内容不完整。");
            char item = raw.charAt(offset);
            try {
                if (item == '{') {
                    offset++; JSONObject result = new JSONObject(); Set<String> keys = new HashSet<>();
                    whitespace(); if (take('}')) return result;
                    do {
                        whitespace(); if (offset >= raw.length() || raw.charAt(offset) != '"') throw invalid("JSON 字段名必须使用双引号。");
                        String key = quoted();
                        if (!keys.add(key)) throw invalid("JSON 包含重复字段。");
                        whitespace(); require(':'); result.put(key, value(depth + 1)); whitespace();
                        if (take('}')) return result;
                        require(',');
                    } while (true);
                }
                if (item == '[') {
                    offset++; JSONArray result = new JSONArray(); whitespace(); if (take(']')) return result;
                    do { result.put(value(depth + 1)); whitespace(); if (take(']')) return result; require(','); } while (true);
                }
                if (item == '"') return quoted();
                for (String literal : Arrays.asList("true", "false", "null")) if (raw.startsWith(literal, offset)) {
                    offset += literal.length(); return "null".equals(literal) ? JSONObject.NULL : "true".equals(literal);
                }
                int start = offset;
                while (offset < raw.length() && "0123456789eE+-.".indexOf(raw.charAt(offset)) >= 0) offset++;
                String number = raw.substring(start, offset);
                if (number.length() > 128) throw invalid("JSON 数值超出范围。");
                if (!number.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")) throw invalid("JSON 数值格式不正确。");
                if (number.indexOf('.') < 0 && number.indexOf('e') < 0 && number.indexOf('E') < 0) {
                    try { return Long.parseLong(number); } catch (NumberFormatException ignored) {}
                }
                double parsed = Double.parseDouble(number);
                if (Double.isInfinite(parsed) || Double.isNaN(parsed)) throw invalid("JSON 数值超出范围。");
                return parsed;
            } catch (JSONException | NumberFormatException exception) { throw invalid("JSON 字段格式不正确。"); }
        }
        String quoted() throws LocalSourceStore.StoreException {
            require('"'); StringBuilder result = new StringBuilder();
            while (offset < raw.length()) {
                char item = raw.charAt(offset++);
                if (item == '"') { String text = result.toString(); LocalSourceStore.validateUtf8(text); return text; }
                if (item < 0x20) throw invalid("JSON 文本包含未转义的控制字符。");
                if (item != '\\') { result.append(item); continue; }
                if (offset >= raw.length()) throw invalid("JSON 文本转义不完整。");
                char escaped = raw.charAt(offset++);
                switch (escaped) {
                    case '"': case '\\': case '/': result.append(escaped); break;
                    case 'b': result.append('\b'); break;
                    case 'f': result.append('\f'); break;
                    case 'n': result.append('\n'); break;
                    case 'r': result.append('\r'); break;
                    case 't': result.append('\t'); break;
                    case 'u':
                        if (offset + 4 > raw.length()) throw invalid("JSON Unicode 转义不完整。");
                        String hex = raw.substring(offset, offset + 4);
                        if (!hex.matches("[0-9a-fA-F]{4}")) throw invalid("JSON Unicode 转义不正确。");
                        result.append((char) Integer.parseInt(hex, 16)); offset += 4; break;
                    default: throw invalid("JSON 文本包含不支持的转义。");
                }
            }
            throw invalid("JSON 文本缺少结束引号。");
        }
        void whitespace() { while (offset < raw.length() && " \t\r\n".indexOf(raw.charAt(offset)) >= 0) offset++; }
        boolean take(char expected) { if (offset < raw.length() && raw.charAt(offset) == expected) { offset++; return true; } return false; }
        void require(char expected) throws LocalSourceStore.StoreException { if (!take(expected)) throw invalid("JSON 内容不完整或分隔符不正确。"); }
    }

    private static LocalSourceStore.StoreException invalid(String message) { return new LocalSourceStore.StoreException("VALIDATION", message); }
    private static LocalSourceStore.StoreException capacity() { return invalid("学习库超过手机保存上限；请先导出保留内容。完整学习备份最多 16 MiB，记录最多 8 MiB。"); }
    private static LocalSourceStore.StoreException storageError() { return new LocalSourceStore.StoreException("STORE_ERROR", "无法读写手机学习库，请保留输入和应用数据后重试。"); }
    private static LocalSourceStore.StoreException corrupt() { return new LocalSourceStore.StoreException("CORRUPT", "学习库的 Markdown 或提交记录不一致；请保留应用数据，暂不覆盖。"); }
    private static LocalSourceStore.StoreException expired() { return new LocalSourceStore.StoreException("INVALID_PREVIEW", "学习内容已变化或备份预览已失效，请重新预览。"); }
}
