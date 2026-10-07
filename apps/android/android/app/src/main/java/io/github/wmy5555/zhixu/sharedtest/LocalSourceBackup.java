package io.github.wmy5555.zhixu.sharedtest;

import android.os.SystemClock;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileDescriptor;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Pattern;

/** Strict v1 snapshots and additive, durable restore transactions. Called under the store lock. */
final class LocalSourceBackup {
    static final int MAX_BACKUP_BYTES = 32 * 1024 * 1024;
    static final int MAX_VERSIONS = 1000;
    private static final String FORMAT = "zhixu-android-source-backup";
    private static final long PREVIEW_LIFETIME_MS = 5 * 60 * 1000;
    private static final Pattern VERSION_ID = Pattern.compile(
        "\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.\\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.md");
    private final LocalSourceStore store;
    private final File transactionDirectory;
    private Preview pending;

    private static final class Note {
        final String id;
        final String current;
        final String original;
        final JSONObject document;
        final Map<String, String> history;

        Note(String current, String original, JSONObject document, Map<String, String> history) {
            this.id = document.optString("id");
            this.current = current;
            this.original = original;
            this.document = document;
            this.history = history;
        }

        JSONObject json() throws JSONException {
            JSONArray versions = new JSONArray();
            for (Map.Entry<String, String> entry : history.entrySet()) {
                versions.put(new JSONObject().put("id", entry.getKey()).put("raw", entry.getValue()));
            }
            return new JSONObject().put("current", current).put("original", original).put("history", versions);
        }
    }

    private static final class Preview {
        final String token = UUID.randomUUID().toString();
        final long created = SystemClock.elapsedRealtime();
        final Map<String, Note> incoming;
        final String fingerprint;

        Preview(Map<String, Note> incoming, String fingerprint) {
            this.incoming = incoming;
            this.fingerprint = fingerprint;
        }
    }

    private static final class Plan {
        final Map<String, Note> accepted = new TreeMap<>();
        final JSONArray conflicts = new JSONArray();
        int imported;
        int unchanged;
        int versionsImported;
    }

    LocalSourceBackup(LocalSourceStore store, File root) throws IOException {
        this.store = store;
        transactionDirectory = LocalSourceStore.child(root, "restore-transaction-v1");
    }

    JSONArray history(String id) throws LocalSourceStore.StoreException {
        try {
            LocalSourceStore.validateId(id);
            store.read(id);
            JSONArray result = new JSONArray();
            addVersion(result, id, "original", "original", readRaw(LocalSourceStore.child(store.originalsDirectory(), id + ".md")));
            for (Map.Entry<String, String> entry : readHistory(id).entrySet()) {
                addVersion(result, id, entry.getKey(), "edit", entry.getValue());
            }
            return result;
        } catch (IOException | JSONException exception) { throw storageError(); }
    }

    private void addVersion(JSONArray result, String id, String versionId, String reason, String raw)
        throws JSONException, LocalSourceStore.StoreException {
        JSONObject document = LocalSourceStore.parseMarkdown(id, raw);
        result.put(new JSONObject().put("id", versionId).put("createdAt", document.getString("updatedAt"))
            .put("reason", reason).put("title", document.getString("title")).put("body", document.getString("body"))
            .put("hash", document.getString("hash")));
    }

    JSONObject version(String id, String versionId) throws LocalSourceStore.StoreException {
        try {
            LocalSourceStore.validateId(id);
            store.read(id);
            File target;
            if ("original".equals(versionId)) target = LocalSourceStore.child(store.originalsDirectory(), id + ".md");
            else {
                validateVersionId(versionId);
                target = LocalSourceStore.child(LocalSourceStore.child(store.historyDirectory(), id), versionId);
            }
            if (!exists(target)) throw new LocalSourceStore.StoreException("NOT_FOUND", "这个历史版本不存在。");
            String raw = readRaw(target);
            if (!"original".equals(versionId)) validateVersionSnapshot(id, versionId, raw);
            return LocalSourceStore.parseMarkdown(id, raw);
        } catch (IOException | JSONException exception) { throw storageError(); }
    }

    JSONObject backup() throws LocalSourceStore.StoreException {
        try {
            JSONObject result = packageNotes(snapshot());
            requirePackageSize(result);
            return result;
        } catch (IOException | JSONException exception) { throw storageError(); }
    }

    JSONObject preview(JSONObject input) throws LocalSourceStore.StoreException {
        // A failed/new preview invalidates any earlier in-memory token.
        pending = null;
        try {
            Map<String, Note> incoming = validatePackage(input);
            Map<String, Note> current = snapshot();
            Plan plan = plan(incoming, current);
            pending = new Preview(incoming, fingerprint(current));
            return new JSONObject().put("token", pending.token).put("newCount", plan.imported)
                .put("sameCount", plan.unchanged).put("conflicts", plan.conflicts)
                .put("versionCount", countVersions(incoming));
        } catch (IOException | JSONException exception) { throw storageError(); }
    }

    JSONObject restore(String token, String policy) throws LocalSourceStore.StoreException {
        if (!"keep-current".equals(policy)) throw invalid("恢复只能选择保留本机现有资料。");
        Preview preview = pending;
        if (preview == null || token == null || !preview.token.equals(token)) throw expired();
        pending = null;
        if (SystemClock.elapsedRealtime() - preview.created > PREVIEW_LIFETIME_MS) throw expired();
        try {
            Map<String, Note> current = snapshot();
            if (!preview.fingerprint.equals(fingerprint(current))) throw expired();
            Plan plan = plan(preview.incoming, current);
            if (plan.imported != 0 || plan.versionsImported != 0) {
                // Stage the WHOLE validated package before committing. Existing sources are never removed.
                JSONObject transaction = packageNotes(plan.accepted);
                requirePackageSize(transaction);
                byte[] bytes = transaction.toString().getBytes(StandardCharsets.UTF_8);
                LocalSourceStore.ensureDirectory(transactionDirectory);
                syncDirectory(transactionDirectory.getParentFile());
                store.writeAtomically(LocalSourceStore.child(transactionDirectory, "plan.json"), bytes);
                syncDirectory(transactionDirectory);
                store.writeAtomically(LocalSourceStore.child(transactionDirectory, "committed"), digest(bytes).getBytes(StandardCharsets.US_ASCII));
                syncDirectory(transactionDirectory);
                recover();
            }
            return new JSONObject().put("imported", plan.imported).put("unchanged", plan.unchanged)
                .put("conflictsSkipped", plan.conflicts.length()).put("versionsImported", plan.versionsImported);
        } catch (IOException | JSONException exception) {
            throw new LocalSourceStore.StoreException("STORE_ERROR", "恢复未能完成；已提交的恢复计划会在重新打开后继续，现有资料已保留。");
        }
    }

    /** Called before any normal read/write and at startup. Only a synced commit marker authorizes replay. */
    void recover() throws IOException, JSONException, LocalSourceStore.StoreException {
        File marker = LocalSourceStore.child(transactionDirectory, "committed");
        if (!exists(marker)) return;
        byte[] bytes = readBounded(LocalSourceStore.child(transactionDirectory, "plan.json"), MAX_BACKUP_BYTES);
        String committedHash = decode(readBounded(marker, 64));
        if (!committedHash.equals(digest(bytes))) throw corrupt();
        Map<String, Note> notes = validatePackage(new JSONObject(decode(bytes)));
        Map<File, String> writes = destinations(notes);
        // Check every destination before replaying any file, even after a partly finished earlier replay.
        for (Map.Entry<File, String> entry : writes.entrySet()) {
            if (exists(entry.getKey()) && !entry.getValue().equals(readRaw(entry.getKey()))) throw corrupt();
        }
        validateReplayCapacity(writes);
        for (Map.Entry<File, String> entry : writes.entrySet()) {
            if (exists(entry.getKey())) continue;
            LocalSourceStore.ensureDirectory(entry.getKey().getParentFile());
            syncDirectory(entry.getKey().getParentFile().getParentFile());
            store.writeAtomically(entry.getKey(), entry.getValue().getBytes(StandardCharsets.UTF_8));
            syncDirectory(entry.getKey().getParentFile());
        }
        // Deleting the commit marker LAST makes interrupted replay idempotent. Leave harmless plan for diagnostics.
        new AtomicFile(marker).delete();
        syncDirectory(transactionDirectory);
        if (exists(marker)) throw new IOException("Cannot finish restore transaction");
    }

    private Map<File, String> destinations(Map<String, Note> notes) throws IOException {
        Map<File, String> writes = new LinkedHashMap<>();
        for (Note note : notes.values()) {
            writes.put(LocalSourceStore.child(store.originalsDirectory(), note.id + ".md"), note.original);
            for (Map.Entry<String, String> version : note.history.entrySet()) {
                writes.put(LocalSourceStore.child(LocalSourceStore.child(store.historyDirectory(), note.id), version.getKey()), version.getValue());
            }
        }
        // Make each new current visible only after its original and versions exist.
        for (Note note : notes.values()) writes.put(LocalSourceStore.child(store.notesDirectory(), note.id + ".md"), note.current);
        return writes;
    }

    private void validateReplayCapacity(Map<File, String> writes) throws IOException, LocalSourceStore.StoreException {
        Set<String> currentIds = new HashSet<>(fileNames(store.notesDirectory(), false));
        Set<String> versions = historyPaths();
        for (File target : writes.keySet()) {
            if (target.getParentFile().equals(store.notesDirectory())) currentIds.add(target.getName());
            if (target.getParentFile().getParentFile().equals(store.historyDirectory())) versions.add(target.getParentFile().getName() + "/" + target.getName());
        }
        if (currentIds.size() > 100 || versions.size() > MAX_VERSIONS) throw invalid("恢复后资料或版本数量超过手机保存上限。");
    }

    void requireHistoryCapacity() throws IOException, LocalSourceStore.StoreException {
        if (historyPaths().size() >= MAX_VERSIONS) throw new LocalSourceStore.StoreException("LIMIT_REACHED", "手机最多保留 1000 个历史版本，请先导出备份。");
    }

    private Set<String> historyPaths() throws IOException, LocalSourceStore.StoreException {
        Set<String> paths = new HashSet<>();
        File[] directories = store.historyDirectory().listFiles();
        if (directories == null) throw new IOException("Cannot enumerate history");
        for (File directory : directories) {
            LocalSourceStore.validateId(directory.getName());
            if (!directory.isDirectory()) throw corrupt();
            LocalSourceStore.child(store.historyDirectory(), directory.getName());
            for (String name : fileNames(directory, true)) paths.add(directory.getName() + "/" + name);
        }
        return paths;
    }

    private Map<String, Note> snapshot() throws IOException, JSONException, LocalSourceStore.StoreException {
        Map<String, JSONObject> documents = store.documents();
        Map<String, Note> notes = new TreeMap<>();
        for (Map.Entry<String, JSONObject> entry : documents.entrySet()) {
            String id = entry.getKey();
            String current = readRaw(LocalSourceStore.child(store.notesDirectory(), id + ".md"));
            String original = readRaw(LocalSourceStore.child(store.originalsDirectory(), id + ".md"));
            LocalSourceStore.parseMarkdown(id, original);
            notes.put(id, new Note(current, original, entry.getValue(), readHistory(id)));
        }
        if (countVersions(notes) > MAX_VERSIONS) throw invalid("历史版本超过备份上限。");
        return notes;
    }

    private Map<String, String> readHistory(String id) throws IOException, JSONException, LocalSourceStore.StoreException {
        File directory = LocalSourceStore.child(store.historyDirectory(), id);
        Map<String, String> result = new TreeMap<>();
        if (!directory.exists()) return result;
        for (String name : fileNames(directory, true)) {
            String raw = readRaw(LocalSourceStore.child(directory, name));
            validateVersionSnapshot(id, name, raw);
            result.put(name, raw);
        }
        if (result.size() > MAX_VERSIONS) throw invalid("历史版本超过备份上限。");
        return result;
    }

    private List<String> fileNames(File directory, boolean history) throws IOException, LocalSourceStore.StoreException {
        File[] files = directory.listFiles();
        if (files == null) throw new IOException("Cannot enumerate snapshots");
        Set<String> names = new HashSet<>();
        for (File file : files) {
            String name = file.getName();
            if (name.endsWith(".bak")) name = name.substring(0, name.length() - 4);
            if (name.endsWith(".new")) continue; // AtomicFile's uncommitted staging file.
            if (history) validateVersionId(name);
            else {
                if (!name.endsWith(".md")) throw corrupt();
                LocalSourceStore.validateId(name.substring(0, name.length() - 3));
            }
            LocalSourceStore.child(directory, name);
            names.add(name);
        }
        List<String> ordered = new ArrayList<>(names);
        java.util.Collections.sort(ordered);
        return ordered;
    }

    private Map<String, Note> validatePackage(JSONObject input) throws LocalSourceStore.StoreException {
        try { return validatePackageJson(input); }
        catch (JSONException exception) { throw invalid("备份中的快照格式不正确。"); }
    }

    private Map<String, Note> validatePackageJson(JSONObject input) throws JSONException, LocalSourceStore.StoreException {
        fields(input, "format", "version", "createdAt", "notes");
        requirePackageSize(input);
        if (!FORMAT.equals(input.opt("format")) || !(input.opt("version") instanceof Integer) || input.getInt("version") != 1)
            throw invalid("备份格式或版本不受支持。");
        if (!LocalSourceStore.validTimestamp(LocalSourceStore.requireString(input, "createdAt"))) throw invalid("备份时间不正确。");
        if (!(input.opt("notes") instanceof JSONArray)) throw invalid("备份资料列表不正确。");
        JSONArray array = input.getJSONArray("notes");
        if (array.length() > 100) throw invalid("备份最多包含 100 份资料。");
        Map<String, Note> notes = new TreeMap<>();
        int versionCount = 0;
        for (int index = 0; index < array.length(); index++) {
            if (!(array.opt(index) instanceof JSONObject)) throw invalid("备份资料格式不正确。");
            JSONObject item = array.getJSONObject(index);
            fields(item, "current", "original", "history");
            String raw = LocalSourceStore.requireString(item, "current");
            String id = rawId(raw);
            JSONObject current = LocalSourceStore.parseMarkdown(id, raw);
            String original = LocalSourceStore.requireString(item, "original");
            LocalSourceStore.parseMarkdown(id, original);
            if (!(item.opt("history") instanceof JSONArray)) throw invalid("历史版本格式不正确。");
            JSONArray versions = item.getJSONArray("history");
            versionCount += versions.length();
            if (versionCount > MAX_VERSIONS) throw invalid("备份最多包含 1000 个历史版本。");
            Map<String, String> history = new TreeMap<>();
            for (int versionIndex = 0; versionIndex < versions.length(); versionIndex++) {
                if (!(versions.opt(versionIndex) instanceof JSONObject)) throw invalid("历史版本格式不正确。");
                JSONObject version = versions.getJSONObject(versionIndex);
                fields(version, "id", "raw");
                String name = LocalSourceStore.requireString(version, "id");
                validateVersionId(name);
                String historyRaw = LocalSourceStore.requireString(version, "raw");
                validateVersionSnapshot(id, name, historyRaw);
                if (history.put(name, historyRaw) != null) throw invalid("备份包含重复历史版本。");
            }
            if (notes.put(id, new Note(raw, original, current, history)) != null) throw invalid("备份包含重复资料标识。");
        }
        return notes;
    }

    private Plan plan(Map<String, Note> incoming, Map<String, Note> current) throws IOException, JSONException, LocalSourceStore.StoreException {
        Plan plan = new Plan();
        int totalVersions = countVersions(current);
        for (Note next : incoming.values()) {
            Note existing = current.get(next.id);
            boolean conflict = existing != null && (!existing.document.getString("hash").equals(next.document.getString("hash"))
                || !existing.original.equals(next.original));
            File original = LocalSourceStore.child(store.originalsDirectory(), next.id + ".md");
            if (exists(original) && !next.original.equals(readRaw(original))) conflict = true;
            for (Map.Entry<String, String> version : next.history.entrySet()) {
                File target = LocalSourceStore.child(LocalSourceStore.child(store.historyDirectory(), next.id), version.getKey());
                if (exists(target) && !version.getValue().equals(readRaw(target))) conflict = true;
            }
            if (existing != null) for (Map.Entry<String, String> version : next.history.entrySet()) {
                String previous = existing.history.get(version.getKey());
                if (previous != null && !previous.equals(version.getValue())) conflict = true;
            }
            if (conflict) {
                plan.conflicts.put(new JSONObject().put("id", next.id).put("title", next.document.getString("title")));
                continue;
            }
            plan.accepted.put(next.id, existing == null ? next
                : new Note(existing.current, existing.original, existing.document, next.history));
            if (existing == null) plan.imported++;
            else plan.unchanged++;
            for (String name : next.history.keySet()) {
                if (existing == null || !existing.history.containsKey(name)) plan.versionsImported++;
            }
        }
        if (current.size() + plan.imported > 100 || totalVersions + plan.versionsImported > MAX_VERSIONS)
            throw invalid("恢复后资料或版本数量超过手机保存上限。");
        validateReplayCapacity(destinations(plan.accepted));
        return plan;
    }

    private JSONObject packageNotes(Map<String, Note> notes) throws JSONException {
        JSONArray array = new JSONArray();
        for (Note note : notes.values()) array.put(note.json());
        return new JSONObject().put("format", FORMAT).put("version", 1).put("createdAt", LocalSourceStore.timestamp()).put("notes", array);
    }

    private String fingerprint(Map<String, Note> notes) {
        try {
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            for (Note note : notes.values()) {
                digestField(hash, note.id);
                digestField(hash, note.current);
                digestField(hash, note.original);
                hash.update(ByteBuffer.allocate(4).putInt(note.history.size()).array());
                for (Map.Entry<String, String> version : note.history.entrySet()) {
                    digestField(hash, version.getKey());
                    digestField(hash, version.getValue());
                }
            }
            return hex(hash.digest());
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }

    private static void digestField(MessageDigest hash, String text) {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        hash.update(ByteBuffer.allocate(4).putInt(bytes.length).array());
        hash.update(bytes);
    }

    private static int countVersions(Map<String, Note> notes) {
        int count = 0;
        for (Note note : notes.values()) count += note.history.size();
        return count;
    }

    private static void requirePackageSize(JSONObject input) throws LocalSourceStore.StoreException {
        String text = input.toString();
        if (text.length() > MAX_BACKUP_BYTES || LocalSourceStore.validateUtf8(text) > MAX_BACKUP_BYTES)
            throw invalid("备份整体最多 32 MiB。");
    }

    private static void fields(JSONObject input, String... allowed) throws LocalSourceStore.StoreException {
        LocalSourceStore.rejectUnknown(input, new HashSet<>(Arrays.asList(allowed)));
        for (String field : allowed) if (!input.has(field) || input.isNull(field)) throw invalid("备份缺少必要字段。");
    }

    private static String rawId(String raw) throws JSONException, LocalSourceStore.StoreException {
        if (LocalSourceStore.validateUtf8(raw) > 160 * 1024 || !raw.startsWith("---\n")) throw corrupt();
        int end = raw.indexOf("\n---\n", 4);
        if (end < 4) throw corrupt();
        String id = LocalSourceStore.requireString(new JSONObject(raw.substring(4, end)), "id");
        LocalSourceStore.validateId(id);
        return id;
    }

    private static void validateVersionId(String id) throws LocalSourceStore.StoreException {
        if (id == null || !VERSION_ID.matcher(id).matches()) throw invalid("历史版本标识不正确。");
    }

    private static void validateVersionSnapshot(String id, String versionId, String raw)
        throws JSONException, LocalSourceStore.StoreException {
        JSONObject document = LocalSourceStore.parseMarkdown(id, raw);
        if (!versionId.startsWith(document.getString("updatedAt").replace(':', '-') + "-")) throw corrupt();
    }

    private String readRaw(File file) throws IOException, LocalSourceStore.StoreException { return decode(store.readBytes(file)); }

    private static byte[] readBounded(File file, int limit) throws IOException, LocalSourceStore.StoreException {
        try (FileInputStream input = new AtomicFile(file).openRead()) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > limit) throw corrupt();
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private static String decode(byte[] bytes) throws LocalSourceStore.StoreException {
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException exception) { throw corrupt(); }
    }

    private static boolean exists(File file) { return file.exists() || new File(file.getPath() + ".bak").exists(); }

    private static String digest(byte[] bytes) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }

    private static String hex(byte[] hash) {
        StringBuilder result = new StringBuilder();
        for (byte value : hash) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private static void syncDirectory(File directory) throws IOException {
        FileDescriptor descriptor = null;
        try {
            descriptor = Os.open(directory.getPath(), OsConstants.O_RDONLY | OsConstants.O_DIRECTORY, 0);
            Os.fsync(descriptor);
        } catch (ErrnoException exception) { throw new IOException("Cannot sync private restore directory", exception); }
        finally {
            if (descriptor != null) try { Os.close(descriptor); }
            catch (ErrnoException exception) { throw new IOException("Cannot close restore directory", exception); }
        }
    }

    private static LocalSourceStore.StoreException invalid(String message) { return new LocalSourceStore.StoreException("VALIDATION", message); }
    private static LocalSourceStore.StoreException corrupt() { return new LocalSourceStore.StoreException("CORRUPT", "备份或恢复快照不一致，请保留原文件后重试。"); }
    private static LocalSourceStore.StoreException storageError() { return new LocalSourceStore.StoreException("STORE_ERROR", "无法读取手机资料或备份，请保留应用数据后重试。"); }
    private static LocalSourceStore.StoreException expired() { return new LocalSourceStore.StoreException("INVALID_PREVIEW", "资料已变化或预览已失效，请重新预览恢复内容。"); }
}
