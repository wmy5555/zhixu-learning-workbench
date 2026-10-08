package io.github.wmy5555.zhixu.sharedtest;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.AtomicFile;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileDescriptor;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;
import java.util.regex.Pattern;

/** Isolated, offline source collector. Markdown is authoritative; SQLite is only an index. */
public class LocalSourceStore implements AutoCloseable {
    private static final Object LOCK = new Object();
    private static final int MAX_BODY_BYTES = 128 * 1024;
    private static final int MAX_DOCUMENT_BYTES = MAX_BODY_BYTES + 32 * 1024;
    private static final int MAX_NOTES = 100;
    private static final Pattern ID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
    private static final String[] SOURCE_FIELDS = { "platform", "author", "url", "date", "locator", "topic" };
    private static final Set<String> SAVE_FIELDS = new HashSet<>(Arrays.asList("id", "title", "body", "expectedHash", "meta"));
    private final File root;
    private final File notesDirectory;
    private final File originalsDirectory;
    private final File historyDirectory;
    private final File saveTransactionsDirectory;
    private SQLiteDatabase database;
    private boolean indexReady;
    private final LocalSourceBackup backups;

    public static class StoreException extends Exception {
        public final String code;

        StoreException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    public LocalSourceStore(Context context) throws StoreException {
        this(new File(context.getFilesDir(), "local-sources-v1"));
    }

    // Package-private for instrumentation tests using a disposable app-private subdirectory.
    LocalSourceStore(File directory) throws StoreException {
        synchronized (LOCK) {
            try {
                root = directory.getCanonicalFile();
                boolean creatingRoot = !root.isDirectory();
                ensureDirectory(root);
                if (creatingRoot) syncDirectory(root.getParentFile());
                notesDirectory = child(root, "notes");
                originalsDirectory = child(root, "originals");
                historyDirectory = child(root, "history");
                saveTransactionsDirectory = child(root, "save-transactions-v1");
                ensureDirectory(notesDirectory);
                ensureDirectory(originalsDirectory);
                ensureDirectory(historyDirectory);
                ensureDirectory(saveTransactionsDirectory);
                syncDirectory(root);
                backups = new LocalSourceBackup(this, root);
                backups.recover();
                recoverSaveTransactions();
                rebuildIndex(readAll());
            } catch (IOException | JSONException exception) {
                throw new StoreException("STORE_ERROR", "无法打开手机本地资料，请保留应用数据后重试。");
            }
        }
    }

    public JSONArray list(String query) throws StoreException {
        synchronized (LOCK) {
            String q = query == null ? "" : query.trim();
            if (q.codePointCount(0, q.length()) > 200) throw validation("检索词最多 200 个字符。");
            try {
                Map<String, JSONObject> documents = readAll();
                if (!indexReady) rebuildIndex(documents);
                List<JSONObject> ordered = new ArrayList<>();
                if (indexReady) {
                    try (Cursor cursor = database.rawQuery("SELECT id FROM notes ORDER BY updated_at DESC, id ASC", null)) {
                        while (cursor.moveToNext()) {
                            JSONObject document = documents.get(cursor.getString(0));
                            if (document != null) ordered.add(document);
                        }
                        // An index is disposable and must never conceal authoritative documents.
                        if (ordered.size() != documents.size()) ordered.clear();
                    } catch (RuntimeException exception) {
                        discardIndex();
                        ordered.clear();
                    }
                }
                if (ordered.size() != documents.size()) {
                    ordered = new ArrayList<>(documents.values());
                    ordered.sort(Comparator.comparing((JSONObject note) -> note.optString("updatedAt")).reversed()
                        .thenComparing(note -> note.optString("id")));
                }
                JSONArray result = new JSONArray();
                String needle = q.toLowerCase(Locale.ROOT);
                for (JSONObject note : ordered) {
                    if (note.getString("title").toLowerCase(Locale.ROOT).contains(needle)
                        || note.getString("body").toLowerCase(Locale.ROOT).contains(needle)) result.put(note);
                }
                return result;
            } catch (IOException | JSONException exception) {
                throw new StoreException("STORE_ERROR", "无法读取手机本地资料，请重试。");
            }
        }
    }

    public JSONObject read(String id) throws StoreException {
        synchronized (LOCK) {
            validateId(id);
            try {
                backups.recover();
                recoverSaveTransactions();
                return readNote(id);
            } catch (IOException | JSONException exception) {
                throw new StoreException("STORE_ERROR", "无法读取这份资料，请保留应用数据后重试。");
            }
        }
    }

    public JSONObject save(JSONObject input) throws StoreException {
        synchronized (LOCK) {
            rejectUnknown(input, SAVE_FIELDS);
            String title = requireString(input, "title").trim();
            String body = requireString(input, "body");
            validateContent(title, body);
            String id = null;
            if (input.has("id")) {
                id = requireString(input, "id");
                validateId(id);
            }
            JSONObject suppliedMeta = null;
            if (input.has("meta")) {
                if (!(input.opt("meta") instanceof JSONObject)) throw validation("来源信息格式不正确。");
                suppliedMeta = input.optJSONObject("meta");
                sanitizeMeta(suppliedMeta);
            }
            try {
                Map<String, JSONObject> documents = readAll();
                JSONObject previous = id == null ? null : documents.get(id);
                if (id != null && previous == null) throw new StoreException("NOT_FOUND", "这份资料不存在。");
                if (previous != null) {
                    String expectedHash = requireString(input, "expectedHash");
                    if (!expectedHash.equals(previous.getString("hash"))) {
                        throw new StoreException("CONFLICT", "资料已发生变化，请重新打开后再编辑；当前修改尚未覆盖原文。");
                    }
                } else {
                    if (input.has("expectedHash")) throw validation("新资料不能带有旧版本标识。");
                    if (documents.size() >= MAX_NOTES) throw new StoreException("LIMIT_REACHED", "样机最多保存 100 份本地资料。");
                    id = UUID.randomUUID().toString();
                }
                JSONObject mergedMeta = previous == null ? new JSONObject()
                    : new JSONObject(previous.getJSONObject("meta").toString());
                if (suppliedMeta != null) for (Iterator<String> keys = suppliedMeta.keys(); keys.hasNext();) {
                    String key = keys.next();
                    mergedMeta.put(key, suppliedMeta.get(key));
                }
                JSONObject meta = sanitizeMeta(mergedMeta);
                String hash = contentHash(title, body, meta);
                if (previous != null && hash.equals(previous.getString("hash"))) return previous;
                if (previous != null) backups.requireHistoryCapacity();
                String updatedAt = timestamp();
                JSONObject note = new JSONObject().put("id", id).put("kind", "source").put("title", title)
                    .put("body", body).put("hash", hash).put("path", "notes/" + id + ".md")
                    .put("updatedAt", updatedAt).put("meta", meta);
                byte[] next = markdown(note);
                File target = child(notesDirectory, id + ".md");
                if (previous == null) {
                    File original = child(originalsDirectory, id + ".md");
                    requireAtomicPrivate(target);
                    requireAtomicPrivate(original);
                    if (atomicExists(target) || new File(target.getPath() + ".new").exists()
                        || atomicExists(original) || new File(original.getPath() + ".new").exists())
                        throw new IOException("New source path already has evidence");
                }
                String versionId = previous == null ? null : previous.getString("updatedAt").replace(':', '-')
                    + "-" + UUID.randomUUID() + ".md";
                backups.requireSaveCapacity(documents, note, new String(next, StandardCharsets.UTF_8), versionId);
                File snapshot = null;
                byte[] previousBytes = null;
                if (previous != null) {
                    // Archive the exact previous Markdown before replacing it, including original whitespace.
                    File versions = child(historyDirectory, id);
                    ensureDirectory(versions);
                    syncDirectory(historyDirectory);
                    snapshot = child(versions, versionId);
                    // This path belongs only to this attempt; never roll back an existing user snapshot.
                    if (snapshot.exists() || child(versions, versionId + ".bak").exists()
                        || child(versions, versionId + ".new").exists()) throw new IOException("History path already exists");
                    requireAtomicPrivate(snapshot);
                    previousBytes = readBytes(target);
                }
                // The synced journal is written before originals/history/current. It proves ownership of cleanup.
                File transaction = child(saveTransactionsDirectory, id + ".json");
                JSONObject journal = new JSONObject().put("schema", 1).put("id", id)
                    .put("operation", previous == null ? "create" : "replace").put("next", digest(next));
                if (previous != null) journal.put("previous", digest(previousBytes)).put("snapshot", versionId);
                writeTransaction(transaction, journal);
                try {
                    if (previous == null) {
                        writeAtomically(child(originalsDirectory, id + ".md"), next);
                        syncDirectory(originalsDirectory);
                    }
                    if (snapshot != null) writeAtomically(snapshot, previousBytes);
                    if (snapshot != null) syncDirectory(snapshot.getParentFile());
                    writeAtomically(target, next);
                    syncDirectory(notesDirectory);
                    finishSaveTransaction(transaction);
                } catch (IOException | RuntimeException exception) {
                    // Persistent storage failure can also interrupt recovery. Keep the journal for startup retry.
                    try { recoverSaveTransaction(transaction, true); }
                    catch (IOException | JSONException | StoreException | RuntimeException ignored) { /* Evidence remains intact. */ }
                    throw new IOException("Cannot commit source Markdown", exception);
                }
                documents.put(id, note);
                // After Markdown has committed, a disposable index failure must not turn save into a retry.
                rebuildIndex(documents);
                return note;
            } catch (IOException | JSONException exception) {
                throw new StoreException("STORE_ERROR", "资料未能完成保存，请保留当前输入后重试。");
            }
        }
    }

    /** Recover only saves with our durable journal. Unmarked originals/history are never guessed to be disposable. */
    private void recoverSaveTransactions() throws IOException, JSONException, StoreException {
        File[] entries = saveTransactionsDirectory.listFiles();
        if (entries == null) throw new IOException("Cannot enumerate save journals");
        Set<String> ids = new HashSet<>();
        for (File entry : entries) {
            String name = entry.getName();
            String base = name.endsWith(".bak") || name.endsWith(".new") ? name.substring(0, name.length() - 4) : name;
            if (!base.endsWith(".json")) continue;
            String id = base.substring(0, base.length() - 5);
            if (!ID.matcher(id).matches()) throw uncertainSave();
            ids.add(id);
        }
        if (ids.size() > MAX_NOTES) throw uncertainSave();
        for (String id : ids) {
            File transaction = child(saveTransactionsDirectory, id + ".json");
            if (atomicExists(transaction)) recoverSaveTransaction(transaction, false);
            else {
                // A .new-only journal never authorized changes to originals or current Markdown.
                File staging = child(saveTransactionsDirectory, id + ".json.new");
                requireRegularPrivate(staging);
                if (!staging.delete() && staging.exists()) throw new IOException("Cannot discard uncommitted journal staging");
                syncDirectory(saveTransactionsDirectory);
            }
        }
    }

    private void recoverSaveTransaction(File transaction, boolean failedInThisProcess)
        throws IOException, JSONException, StoreException {
        requireAtomicPrivate(transaction);
        JSONObject journal = new JSONObject(decode(readBytes(transaction)));
        String operation = requireString(journal, "operation");
        boolean create = "create".equals(operation);
        if (!create && !"replace".equals(operation)) throw uncertainSave();
        Set<String> fields = new HashSet<>(Arrays.asList("schema", "id", "operation", "next"));
        if (!create) { fields.add("previous"); fields.add("snapshot"); }
        rejectUnknown(journal, fields);
        if (!(journal.opt("schema") instanceof Integer) || journal.optInt("schema") != 1) throw uncertainSave();
        String id = requireString(journal, "id");
        validateId(id);
        if (!transaction.getName().equals(id + ".json")) throw uncertainSave();
        String next = requireDigest(journal, "next");
        File target = child(notesDirectory, id + ".md");
        File original = child(originalsDirectory, id + ".md");
        requireAtomicPrivate(target);
        requireAtomicPrivate(original);
        byte[] current = null;
        if (atomicExists(target)) {
            try { current = readBytes(target); parseMarkdown(id, decode(current)); }
            catch (IOException | JSONException | StoreException | RuntimeException exception) { throw uncertainSave(); }
        }
        if (create) {
            if (current != null) {
                if (!next.equals(digest(current)) || !atomicExists(original)) throw uncertainSave();
                byte[] originalBytes = readBytes(original);
                parseMarkdown(id, decode(originalBytes));
                if (!next.equals(digest(originalBytes))) throw uncertainSave();
                finishSaveTransaction(transaction);
                return;
            }
            // No committed current exists. Only exact bytes owned by this journal may be removed.
            if (atomicExists(original)) {
                byte[] originalBytes = readBytes(original);
                parseMarkdown(id, decode(originalBytes));
                if (!next.equals(digest(originalBytes))) throw uncertainSave();
            }
            new AtomicFile(original).delete();
            syncDirectory(originalsDirectory);
            if (atomicExists(original) || child(originalsDirectory, id + ".md.new").exists()) throw new IOException("Cannot remove uncommitted original");
            File targetStaging = child(notesDirectory, id + ".md.new");
            if (targetStaging.exists() && !targetStaging.delete()) throw new IOException("Cannot remove uncommitted current staging");
            syncDirectory(notesDirectory);
            finishSaveTransaction(transaction);
            return;
        }
        String previous = requireDigest(journal, "previous");
        String versionId = requireString(journal, "snapshot");
        if (!versionId.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.\\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.md")) throw uncertainSave();
        File snapshot = child(child(historyDirectory, id), versionId);
        requireAtomicPrivate(snapshot);
        byte[] archived = null;
        if (atomicExists(snapshot)) {
            archived = readBytes(snapshot);
            JSONObject old = parseMarkdown(id, decode(archived));
            if (!previous.equals(digest(archived)) || !versionId.startsWith(old.getString("updatedAt").replace(':', '-') + "-")) throw uncertainSave();
        }
        if (current != null && next.equals(digest(current))) {
            if (archived == null) throw uncertainSave();
            finishSaveTransaction(transaction); // The replacement committed; the previous snapshot is real history.
            return;
        }
        if (current != null && previous.equals(digest(current))) {
            if (failedInThisProcess && archived != null) {
                new AtomicFile(snapshot).delete();
                syncDirectory(snapshot.getParentFile());
                if (atomicExists(snapshot)) throw new IOException("Cannot discard this failed save snapshot");
            }
            finishSaveTransaction(transaction);
            return;
        }
        if (current != null || archived == null) throw uncertainSave();
        // A missing authority can be repaired from the exact preimage. Never replace an ambiguous existing file.
        writeAtomically(target, archived);
        syncDirectory(notesDirectory);
        if (!Arrays.equals(archived, readBytes(target))) throw uncertainSave();
        finishSaveTransaction(transaction);
    }

    private void writeTransaction(File transaction, JSONObject journal) throws IOException, StoreException {
        requireAtomicPrivate(transaction);
        if (atomicExists(transaction)) throw uncertainSave();
        byte[] bytes = journal.toString().getBytes(StandardCharsets.UTF_8);
        writeAtomically(transaction, bytes);
        syncDirectory(saveTransactionsDirectory);
        if (!Arrays.equals(bytes, readBytes(transaction))) throw new IOException("Save journal was not committed");
    }

    private void finishSaveTransaction(File transaction) throws IOException {
        requireAtomicPrivate(transaction);
        new AtomicFile(transaction).delete();
        syncDirectory(saveTransactionsDirectory);
        if (atomicExists(transaction) || new File(transaction.getPath() + ".new").exists()) throw new IOException("Cannot finish save journal");
    }

    private static boolean atomicExists(File file) { return file.exists() || new File(file.getPath() + ".bak").exists(); }
    private static String requireDigest(JSONObject journal, String field) throws StoreException {
        String value = requireString(journal, field);
        if (!value.matches("[0-9a-f]{64}")) throw uncertainSave();
        return value;
    }
    private static String digest(byte[] bytes) {
        try {
            StringBuilder value = new StringBuilder();
            for (byte item : MessageDigest.getInstance("SHA-256").digest(bytes)) value.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return value.toString();
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    private static String decode(byte[] bytes) throws StoreException {
        try { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString(); }
        catch (CharacterCodingException exception) { throw uncertainSave(); }
    }
    private static void requireAtomicPrivate(File file) throws IOException {
        requireRegularPrivate(file);
        requireRegularPrivate(new File(file.getPath() + ".bak"));
        requireRegularPrivate(new File(file.getPath() + ".new"));
    }
    private static void requireRegularPrivate(File file) throws IOException {
        if (!file.getAbsoluteFile().equals(file.getCanonicalFile())) throw new IOException("Unsafe save recovery file");
        try { if (!OsConstants.S_ISREG(Os.lstat(file.getPath()).st_mode)) throw new IOException("Save recovery requires regular files"); }
        catch (ErrnoException exception) {
            if (exception.errno != OsConstants.ENOENT) throw new IOException("Cannot inspect save recovery file", exception);
        }
    }
    private static void syncDirectory(File directory) throws IOException {
        FileDescriptor descriptor = null;
        try { descriptor = Os.open(directory.getPath(), OsConstants.O_RDONLY, 0); Os.fsync(descriptor); }
        catch (ErrnoException exception) { throw new IOException("Cannot sync source save directory", exception); }
        finally { if (descriptor != null) try { Os.close(descriptor); } catch (ErrnoException exception) { throw new IOException("Cannot close source save directory", exception); } }
    }
    private static StoreException uncertainSave() {
        return new StoreException("CORRUPT", "未能确定一次资料保存是否完成；当前文件、旧版快照和保存日志已保留，请保留应用数据后修复存储访问，暂不覆盖。");
    }

    private Map<String, JSONObject> readAll() throws IOException, JSONException, StoreException {
        return readAll(true);
    }

    private Map<String, JSONObject> readAll(boolean recover) throws IOException, JSONException, StoreException {
        if (recover) { backups.recover(); recoverSaveTransactions(); }
        File[] files = notesDirectory.listFiles();
        if (files == null) throw new IOException("Cannot enumerate source directory");
        Set<String> ids = new HashSet<>();
        for (File file : files) {
            String name = file.getName();
            // AtomicFile on older Android may leave only the recoverable .bak after an interrupted write.
            String id = name.endsWith(".md.bak") ? name.substring(0, name.length() - 7)
                : name.endsWith(".md") ? name.substring(0, name.length() - 3) : null;
            if (id != null) {
                if (!ID.matcher(id).matches()) throw corrupt();
                ids.add(id);
            }
        }
        if (ids.size() > MAX_NOTES) throw corrupt();
        Map<String, JSONObject> documents = new LinkedHashMap<>();
        for (String id : ids) documents.put(id, readNote(id));
        return documents;
    }

    private JSONObject readNote(String id) throws IOException, JSONException, StoreException {
        File file = child(notesDirectory, id + ".md");
        if (!file.exists() && !child(notesDirectory, id + ".md.bak").exists()) {
            throw new StoreException("NOT_FOUND", "这份资料不存在。");
        }
        String document;
        try {
            document = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(readBytes(file))).toString();
        } catch (CharacterCodingException exception) {
            throw corrupt();
        }
        return parseMarkdown(id, document);
    }

    // Shared by current, original and historical snapshot validation. No files are written here.
    static JSONObject parseMarkdown(String id, String document) throws JSONException, StoreException {
        validateId(id);
        if (validateUtf8(document) > MAX_DOCUMENT_BYTES) throw corrupt();
        int end = document.indexOf("\n---\n", 4);
        if (!document.startsWith("---\n") || end < 4) throw corrupt();
        try {
            JSONObject header = new JSONObject(document.substring(4, end));
            rejectUnknown(header, new HashSet<>(Arrays.asList("schema", "id", "kind", "title", "hash", "updatedAt", "meta")));
            if (!(header.opt("schema") instanceof Integer) || header.getInt("schema") != 1 || !id.equals(header.optString("id"))
                || !"source".equals(header.optString("kind"))) throw corrupt();
            String title = requireString(header, "title");
            String body = document.substring(end + 5);
            validateContent(title, body);
            JSONObject meta = sanitizeMeta(header.getJSONObject("meta"));
            String hash = contentHash(title, body, meta);
            if (!hash.equals(header.optString("hash"))) throw corrupt();
            String updatedAt = requireString(header, "updatedAt");
            if (!validTimestamp(updatedAt)) throw corrupt();
            return new JSONObject().put("id", id).put("kind", "source").put("title", title).put("body", body)
                .put("hash", hash).put("path", "notes/" + id + ".md").put("updatedAt", updatedAt).put("meta", meta);
        } catch (JSONException | StoreException exception) {
            throw corrupt();
        }
    }

    public JSONArray history(String id) throws StoreException {
        synchronized (LOCK) { return backups.history(id); }
    }

    public JSONObject restoreVersion(String id, String versionId, String expectedHash) throws StoreException {
        synchronized (LOCK) {
            JSONObject version = backups.version(id, versionId);
            try {
                // Supply every source field, including explicit clearing; restoring must not inherit newer attribution.
                JSONObject meta = new JSONObject(version.getJSONObject("meta").toString());
                for (String field : SOURCE_FIELDS) if (!meta.has(field)) meta.put(field, "");
                return save(new JSONObject().put("id", id).put("expectedHash", expectedHash)
                    .put("title", version.getString("title")).put("body", version.getString("body")).put("meta", meta));
            } catch (JSONException exception) { throw corrupt(); }
        }
    }

    public JSONObject backup() throws StoreException {
        synchronized (LOCK) { return backups.backup(); }
    }

    public JSONObject previewRestore(JSONObject backup) throws StoreException {
        synchronized (LOCK) { return backups.preview(backup); }
    }

    public JSONObject restoreBackup(String token, String conflictPolicy) throws StoreException {
        synchronized (LOCK) {
            JSONObject result = backups.restore(token, conflictPolicy);
            try { rebuildIndex(readAll()); }
            catch (IOException | JSONException exception) { throw new StoreException("STORE_ERROR", "恢复已提交，索引将在重新打开时重建。"); }
            return result;
        }
    }

    File notesDirectory() { return notesDirectory; }
    File originalsDirectory() { return originalsDirectory; }
    File historyDirectory() { return historyDirectory; }
    Map<String, JSONObject> documents() throws IOException, JSONException, StoreException { return readAll(); }
    Map<String, JSONObject> documentsForRecovery() throws IOException, JSONException, StoreException { return readAll(false); }

    private static byte[] markdown(JSONObject note) throws JSONException {
        JSONObject header = new JSONObject().put("schema", 1).put("id", note.getString("id"))
            .put("kind", "source").put("title", note.getString("title")).put("hash", note.getString("hash"))
            .put("updatedAt", note.getString("updatedAt")).put("meta", note.getJSONObject("meta"));
        // JSON flow mappings are valid YAML, without introducing a second parser in the sample app.
        return ("---\n" + header + "\n---\n" + note.getString("body")).getBytes(StandardCharsets.UTF_8);
    }

    byte[] readBytes(File file) throws IOException, StoreException {
        AtomicFile atomic = new AtomicFile(file);
        // openRead performs AtomicFile recovery before the bounded read.
        try (java.io.FileInputStream input = atomic.openRead()) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (bytes.size() + count > MAX_DOCUMENT_BYTES) throw corrupt();
                bytes.write(buffer, 0, count);
            }
            return bytes.toByteArray();
        }
    }

    // Overridable only within this package for deterministic disk failure instrumentation.
    void writeAtomically(File file, byte[] bytes) throws IOException {
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream output = null;
        try {
            output = atomic.startWrite();
            output.write(bytes);
            output.getFD().sync();
            atomic.finishWrite(output);
            // AtomicFile can log a rename failure instead of throwing; the caller must not report success.
            try { if (!Arrays.equals(bytes, readBytes(file))) throw new IOException("Atomic source write did not commit"); }
            catch (StoreException exception) { throw new IOException("Cannot verify atomic source write", exception); }
        } catch (IOException | RuntimeException exception) {
            if (output != null) atomic.failWrite(output);
            throw exception;
        }
    }

    private void rebuildIndex(Map<String, JSONObject> documents) {
        indexReady = false;
        try {
            if (database == null || !database.isOpen()) {
                database = SQLiteDatabase.openOrCreateDatabase(child(root, "index.sqlite"), null);
                database.execSQL("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL)");
            }
            database.beginTransaction();
            try {
                database.delete("notes", null, null);
                for (JSONObject note : documents.values()) {
                    ContentValues row = new ContentValues();
                    row.put("id", note.getString("id"));
                    row.put("title", note.getString("title"));
                    row.put("body", note.getString("body"));
                    row.put("updated_at", note.getString("updatedAt"));
                    database.insertOrThrow("notes", null, row);
                }
                database.setTransactionSuccessful();
            } finally {
                database.endTransaction();
            }
            indexReady = true;
        } catch (IOException | JSONException | RuntimeException exception) {
            discardIndex();
        }
    }

    private void discardIndex() {
        indexReady = false;
        if (database != null) {
            try { database.close(); } catch (RuntimeException ignored) { /* Markdown remains authoritative. */ }
            database = null;
        }
    }

    @Override public void close() {
        synchronized (LOCK) { discardIndex(); }
    }

    private static JSONObject sanitizeMeta(JSONObject input) throws StoreException {
        Set<String> allowed = new HashSet<>(Arrays.asList(SOURCE_FIELDS));
        allowed.add("stage");
        allowed.add("privacy");
        rejectUnknown(input, allowed);
        if (input.has("stage") && !"reference".equals(input.opt("stage"))) throw validation("样机只保存参考资料，不能修改知识阶段。");
        if (input.has("privacy") && !"local".equals(input.opt("privacy"))) throw validation("样机资料只能保存在手机本地。");
        try {
            JSONObject output = new JSONObject().put("stage", "reference").put("privacy", "local");
            for (String field : SOURCE_FIELDS) {
                if (!input.has(field)) continue;
                String value = requireString(input, field).trim();
                int limit = "url".equals(field) || "locator".equals(field) ? 2048 : 200;
                if (value.codePointCount(0, value.length()) > limit || value.indexOf('\0') >= 0) throw validation("来源信息超出长度限制。");
                validateUtf8(value);
                if (!value.isEmpty()) output.put(field, value);
            }
            return output;
        } catch (JSONException exception) {
            throw validation("来源信息格式不正确。");
        }
    }

    private static void validateContent(String title, String body) throws StoreException {
        if (isBlankText(title) || title.codePointCount(0, title.length()) > 200 || title.matches("(?s).*\\p{Cntrl}.*")) {
            throw validation("标题不能为空，最多 200 个字符且不能包含控制字符。");
        }
        validateUtf8(title);
        if (body.length() > MAX_BODY_BYTES || isBlankText(body) || body.indexOf('\0') >= 0 || validateUtf8(body) > MAX_BODY_BYTES) {
            throw validation("正文不能为空，最多保存 128 KiB 的 UTF-8 文本。");
        }
    }

    private static boolean isBlankText(String value) {
        for (int offset = 0; offset < value.length();) {
            int point = value.codePointAt(offset);
            if (!Character.isWhitespace(point) && !Character.isSpaceChar(point)) return false;
            offset += Character.charCount(point);
        }
        return true;
    }

    static int validateUtf8(String value) throws StoreException {
        try {
            return StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(value)).remaining();
        } catch (CharacterCodingException exception) {
            throw validation("文本包含不完整的字符，请检查后重试。");
        }
    }

    static void rejectUnknown(JSONObject input, Set<String> allowed) throws StoreException {
        if (input == null) throw validation("保存内容不能为空。");
        for (Iterator<String> keys = input.keys(); keys.hasNext();) {
            if (!allowed.contains(keys.next())) throw validation("请求包含样机不支持的字段。");
        }
    }

    static String requireString(JSONObject input, String field) throws StoreException {
        Object value = input.opt(field);
        if (!(value instanceof String)) throw validation("必需字段缺失或格式不正确。");
        return (String) value;
    }

    static void validateId(String id) throws StoreException {
        if (id == null || !ID.matcher(id).matches()) throw validation("资料标识不正确。");
    }

    private static String contentHash(String title, String body, JSONObject meta) throws JSONException {
        JSONArray content = new JSONArray().put(title).put(body);
        content.put("reference").put("local");
        for (String field : SOURCE_FIELDS) content.put(meta.optString(field, ""));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(content.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder value = new StringBuilder();
            for (byte item : digest) value.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return value.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required by Android", exception);
        }
    }

    static String timestamp() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    static boolean validTimestamp(String value) {
        if (!value.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z")) return false;
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        format.setLenient(false);
        try { return format.format(format.parse(value)).equals(value); }
        catch (java.text.ParseException exception) { return false; }
    }

    static File child(File parent, String name) throws IOException {
        File file = new File(parent, name);
        if (!file.getCanonicalFile().getParentFile().equals(parent.getCanonicalFile())) throw new IOException("Invalid internal path");
        return file;
    }

    static void ensureDirectory(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create private directory");
    }

    private static StoreException validation(String message) { return new StoreException("VALIDATION", message); }
    private static StoreException corrupt() { return new StoreException("CORRUPT", "本地 Markdown 存在格式或版本冲突；请保留应用数据，暂不覆盖。"); }
}
