package io.github.wmy5555.zhixu.sharedtest;

import android.database.sqlite.SQLiteDatabase;
import android.test.AndroidTestCase;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;

/** Only synthetic originals in randomized app-cache directories; exercises actual Android AtomicFile. */
@SuppressWarnings("deprecation")
public class LocalSourceBackupTest extends AndroidTestCase {
    private File root;
    private File sourceRoot;
    private LocalSourceStore store;

    @Override protected void setUp() throws Exception {
        super.setUp();
        root = new File(getContext().getCacheDir(), "source-backup-test-" + UUID.randomUUID()).getCanonicalFile();
        sourceRoot = new File(root, "source");
        store = new LocalSourceStore(sourceRoot);
    }

    @Override protected void tearDown() throws Exception {
        if (store != null) store.close();
        if (root != null) deleteTree(root);
        super.tearDown();
    }

    public void testV1UpgradeReadsWithoutRewritingOriginalOrCurrent() throws Exception {
        JSONObject first = save("旧版原文", "v1 合成正文  \n");
        store.save(edit(first, "更新后的原文", "仍使用 v1 Markdown"));
        String current = raw(new File(sourceRoot, "notes/" + first.getString("id") + ".md"));
        String original = raw(new File(sourceRoot, "originals/" + first.getString("id") + ".md"));
        store.close();
        store = new LocalSourceStore(sourceRoot);
        assertEquals(current, raw(new File(sourceRoot, "notes/" + first.getString("id") + ".md")));
        assertEquals(original, raw(new File(sourceRoot, "originals/" + first.getString("id") + ".md")));
        assertEquals(2, store.history(first.getString("id")).length());
        assertEquals(current, store.backup().getJSONArray("notes").getJSONObject(0).getString("current"));
    }

    public void testRestoreVersionArchivesCurrentAndEnforcesHashAndMetadataClearing() throws Exception {
        JSONObject first = save("原始版本", "第一次保存");
        JSONObject second = store.save(edit(first, "新版本", "编辑后内容")
            .put("meta", new JSONObject().put("author", "后来补充的合成作者")));
        String id = first.getString("id");
        assertEquals("original", store.history(id).getJSONObject(0).getString("id"));
        expect("CONFLICT", () -> store.restoreVersion(id, "original", first.getString("hash")));
        expect("VALIDATION", () -> store.restoreVersion(id, "../notes/x.md", second.getString("hash")));
        JSONObject restored = store.restoreVersion(id, "original", second.getString("hash"));
        assertEquals(first.getString("hash"), restored.getString("hash"));
        assertFalse(restored.getJSONObject("meta").has("author"));
        JSONArray history = store.history(id);
        assertEquals(3, history.length());
        boolean hasPrevious = false;
        for (int index = 1; index < history.length(); index++) {
            if ("编辑后内容".equals(history.getJSONObject(index).getString("body"))) hasPrevious = true;
        }
        assertTrue(hasPrevious);
        expect("CONFLICT", () -> store.restoreVersion(id, "original", second.getString("hash")));
    }

    public void testRoundtripPreservesExactSnapshotsAndRepeatedRestoreIsIdempotent() throws Exception {
        JSONObject first = save("跨库备份", "原始空格  \n第二行\n");
        JSONObject second = store.save(edit(first, "跨库编辑", "第二版\n"));
        store.save(edit(second, "最终标题", "第三版中文与 emoji 😀"));
        JSONObject exported = store.backup();
        try (LocalSourceStore destination = destination()) {
            JSONObject preview = destination.previewRestore(exported);
            assertEquals(1, preview.getInt("newCount"));
            assertEquals(2, preview.getInt("versionCount"));
            JSONObject result = destination.restoreBackup(preview.getString("token"), "keep-current");
            assertEquals(1, result.getInt("imported"));
            assertEquals(2, result.getInt("versionsImported"));
            assertEquals(exported.getJSONArray("notes").toString(), destination.backup().getJSONArray("notes").toString());
            expect("INVALID_PREVIEW", () -> destination.restoreBackup(preview.getString("token"), "keep-current"));
            result = restore(destination, exported);
            assertEquals(0, result.getInt("imported"));
            assertEquals(1, result.getInt("unchanged"));
            assertEquals(0, result.getInt("versionsImported"));
        }
        try (LocalSourceStore reopened = destination()) {
            assertEquals(3, reopened.history(first.getString("id")).length());
            assertEquals("第三版中文与 emoji 😀", reopened.read(first.getString("id")).getString("body"));
        }
    }

    public void testCompatibleHistoryMergesWithoutChangingCurrentMarkdown() throws Exception {
        JSONObject first = save("历史合并", "原始正文");
        store.save(edit(first, "历史合并", "当前正文"));
        JSONObject full = store.backup();
        JSONObject withoutHistory = copy(full);
        JSONObject note = withoutHistory.getJSONArray("notes").getJSONObject(0);
        note.put("history", new JSONArray());
        // Same content with a different current timestamp is compatible, but must retain local raw bytes.
        note.put("current", replaceTimestamp(note.getString("current"), "2026-01-01T00:00:00.000Z"));
        try (LocalSourceStore destination = destination()) {
            restore(destination, withoutHistory);
            String before = destination.backup().getJSONArray("notes").getJSONObject(0).getString("current");
            JSONObject result = restore(destination, full);
            assertEquals(1, result.getInt("unchanged"));
            assertEquals(1, result.getInt("versionsImported"));
            assertEquals(before, destination.backup().getJSONArray("notes").getJSONObject(0).getString("current"));
            assertEquals(2, destination.history(first.getString("id")).length());
        }
    }

    public void testConflictingCurrentIsSkippedWhileIndependentNewNoteImports() throws Exception {
        JSONObject first = save("现有资料", "应当保留的内容");
        JSONObject initial = store.backup();
        try (LocalSourceStore destination = destination()) {
            restore(destination, initial);
            store.save(edit(first, "备份中的新内容", "不同正文"));
            JSONObject other = save("独立新资料", "允许导入");
            JSONObject preview = destination.previewRestore(store.backup());
            assertEquals(1, preview.getInt("newCount"));
            assertEquals(1, preview.getJSONArray("conflicts").length());
            assertEquals(first.getString("id"), preview.getJSONArray("conflicts").getJSONObject(0).getString("id"));
            JSONObject result = destination.restoreBackup(preview.getString("token"), "keep-current");
            assertEquals(1, result.getInt("conflictsSkipped"));
            assertEquals("应当保留的内容", destination.read(first.getString("id")).getString("body"));
            assertEquals("允许导入", destination.read(other.getString("id")).getString("body"));
        }
    }

    public void testOriginalOrHistoryCollisionSkipsWholeNote() throws Exception {
        JSONObject first = save("碰撞资料", "原始正文");
        store.save(edit(first, "碰撞资料", "当前正文"));
        JSONObject full = store.backup();
        try (LocalSourceStore destination = destination()) {
            restore(destination, full);
            JSONObject changedOriginal = copy(full);
            JSONObject item = changedOriginal.getJSONArray("notes").getJSONObject(0);
            item.put("original", item.getString("current"));
            assertEquals(1, restore(destination, changedOriginal).getInt("conflictsSkipped"));
            JSONObject collision = copy(full);
            item = collision.getJSONArray("notes").getJSONObject(0);
            JSONObject version = item.getJSONArray("history").getJSONObject(0);
            version.put("raw", replaceTimestamp(item.getString("current"), first.getString("updatedAt")));
            assertEquals(1, restore(destination, collision).getInt("conflictsSkipped"));
            assertEquals(full.getJSONArray("notes").toString(), destination.backup().getJSONArray("notes").toString());
        }
    }

    public void testPreviewInvalidatesAfterEditAndReopeningAndRejectsOtherPolicies() throws Exception {
        JSONObject first = save("预览时版本", "当前正文");
        JSONObject exported = store.backup();
        JSONObject preview = store.previewRestore(exported);
        expect("VALIDATION", () -> store.restoreBackup(preview.getString("token"), "overwrite"));
        store.save(edit(first, "数量未变", "内容已经变化"));
        expect("INVALID_PREVIEW", () -> store.restoreBackup(preview.getString("token"), "keep-current"));
        String token = store.previewRestore(exported).getString("token");
        store.close();
        store = new LocalSourceStore(sourceRoot);
        expect("INVALID_PREVIEW", () -> store.restoreBackup(token, "keep-current"));
        assertEquals("内容已经变化", store.read(first.getString("id")).getString("body"));
    }

    public void testUnknownFieldsVersionsDuplicateIdsAndPathsRejectWholePackage() throws Exception {
        JSONObject first = save("拒绝整包", "有效正文");
        store.save(edit(first, "拒绝整包", "编辑正文"));
        JSONObject exported = store.backup();
        rejectWithoutWrites(copy(exported).put("version", 2));
        rejectWithoutWrites(copy(exported).put("attachments", new JSONArray()));
        JSONObject changed = copy(exported);
        changed.getJSONArray("notes").put(copy(changed.getJSONArray("notes").getJSONObject(0)));
        rejectWithoutWrites(changed);
        changed = copy(exported);
        changed.getJSONArray("notes").getJSONObject(0).put("path", "../private");
        rejectWithoutWrites(changed);
        changed = copy(exported);
        changed.getJSONArray("notes").getJSONObject(0).getJSONArray("history").getJSONObject(0).put("id", "../outside.md");
        rejectWithoutWrites(changed);
        changed = copy(exported);
        JSONArray history = changed.getJSONArray("notes").getJSONObject(0).getJSONArray("history");
        history.put(copy(history.getJSONObject(0)));
        rejectWithoutWrites(changed);
        rejectWithoutWrites(copy(exported).put("version", "1"));
    }

    public void testCorruptHashIdentityMetadataUnicodeAndSchemaRejectWholePackage() throws Exception {
        JSONObject first = save("校验快照", "有效正文");
        JSONObject exported = store.backup();
        String original = exported.getJSONArray("notes").getJSONObject(0).getString("original");
        String[] invalidSnapshots = {
            original + "被篡改",
            original.replace(first.getString("id"), UUID.randomUUID().toString()),
            original.replace("\"privacy\":\"local\"", "\"privacy\":\"cloud\""),
            original.replace("\"schema\":1", "\"schema\":2"),
            original.replace("\"schema\":1", "\"schema\":1,\"path\":\"../private\""),
            original + "\uD800",
            "---\n{malformed\n---\n正文"
        };
        for (String invalidSnapshot : invalidSnapshots) {
            JSONObject changed = copy(exported);
            changed.getJSONArray("notes").getJSONObject(0).put("original", invalidSnapshot);
            rejectWithoutWrites(changed);
        }
    }

    public void testAllLimitsRejectBeforeWritingAnyDestination() throws Exception {
        JSONObject first = save("限制校验", "有效正文");
        store.save(edit(first, "限制校验", "编辑后正文"));
        JSONObject exported = store.backup();
        JSONObject changed = copy(exported);
        JSONArray notes = changed.getJSONArray("notes");
        JSONObject note = notes.getJSONObject(0);
        for (int index = 1; index < 101; index++) notes.put(note);
        rejectWithoutWrites(changed);
        changed = copy(exported);
        JSONArray history = changed.getJSONArray("notes").getJSONObject(0).getJSONArray("history");
        JSONObject version = history.getJSONObject(0);
        for (int index = 1; index < 1001; index++) history.put(version);
        rejectWithoutWrites(changed);
        rejectWithoutWrites(copy(exported).put("createdAt", repeat('文', LocalSourceBackup.MAX_BACKUP_BYTES / 3 + 1)));
        changed = copy(exported);
        String current = changed.getJSONArray("notes").getJSONObject(0).getString("current");
        changed.getJSONArray("notes").getJSONObject(0).put("current", current + repeat('x', 128 * 1024));
        rejectWithoutWrites(changed);
    }

    public void testFailedStagingHasNoCommittedEffectsAndCanBeRetried() throws Exception {
        save("暂存失败", "导入内容");
        JSONObject exported = store.backup();
        File destinationRoot = new File(root, "destination");
        try (LocalSourceStore failed = new LocalSourceStore(destinationRoot) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("plan.json".equals(file.getName())) throw new IOException("Synthetic staging failure");
                super.writeAtomically(file, bytes);
            }
        }) {
            JSONObject preview = failed.previewRestore(exported);
            expect("STORE_ERROR", () -> failed.restoreBackup(preview.getString("token"), "keep-current"));
            assertEquals(0, failed.list("").length());
        }
        try (LocalSourceStore reopened = destination()) {
            assertEquals(0, reopened.list("").length());
            assertEquals(1, restore(reopened, exported).getInt("imported"));
        }
    }

    public void testCommittedWriteFailureReopensWithoutLosingExistingNote() throws Exception {
        JSONObject existing = save("已有资料", "保留这份资料");
        JSONObject base = store.backup();
        JSONObject added = save("恢复的新资料", "恢复正文");
        JSONObject exported = store.backup();
        try (LocalSourceStore destination = destination()) { restore(destination, base); }
        File destinationRoot = new File(root, "destination");
        try (LocalSourceStore failed = new LocalSourceStore(destinationRoot) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) throw new IOException("Synthetic committed disk failure");
                super.writeAtomically(file, bytes);
            }
        }) {
            JSONObject preview = failed.previewRestore(exported);
            expect("STORE_ERROR", () -> failed.restoreBackup(preview.getString("token"), "keep-current"));
            assertTrue(new File(destinationRoot, "restore-transaction-v1/committed").isFile());
            assertTrue(raw(new File(destinationRoot, "notes/" + existing.getString("id") + ".md")).endsWith("保留这份资料"));
        }
        try (LocalSourceStore reopened = destination()) {
            assertEquals(2, reopened.list("").length());
            assertEquals("保留这份资料", reopened.read(existing.getString("id")).getString("body"));
            assertEquals("恢复正文", reopened.read(added.getString("id")).getString("body"));
            assertFalse(new File(destinationRoot, "restore-transaction-v1/committed").exists());
        }
    }

    public void testUncommittedStagingNeverImportsOnReopen() throws Exception {
        save("未确认提交", "只能留在暂存计划中");
        JSONObject exported = store.backup();
        File destinationRoot = new File(root, "destination");
        try (LocalSourceStore failed = new LocalSourceStore(destinationRoot) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("committed".equals(file.getName())) throw new IOException("Synthetic commit-marker failure");
                super.writeAtomically(file, bytes);
            }
        }) {
            JSONObject preview = failed.previewRestore(exported);
            expect("STORE_ERROR", () -> failed.restoreBackup(preview.getString("token"), "keep-current"));
            assertTrue(new File(destinationRoot, "restore-transaction-v1/plan.json").isFile());
            assertFalse(new File(destinationRoot, "restore-transaction-v1/committed").exists());
        }
        try (LocalSourceStore reopened = destination()) {
            assertEquals(0, reopened.list("").length());
            assertEquals(0, new File(destinationRoot, "originals").listFiles().length);
            assertEquals(1, restore(reopened, exported).getInt("imported"));
        }
    }

    public void testTamperedCommittedPlanBlocksReplayAndKeepsOldDocuments() throws Exception {
        JSONObject existing = save("旧资料仍保留", "不可覆盖的旧正文");
        JSONObject base = store.backup();
        save("计划中的新资料", "合成新正文");
        JSONObject exported = store.backup();
        try (LocalSourceStore destination = destination()) { restore(destination, base); }
        File destinationRoot = new File(root, "destination");
        try (LocalSourceStore failed = new LocalSourceStore(destinationRoot) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) throw new IOException("Synthetic replay failure");
                super.writeAtomically(file, bytes);
            }
        }) {
            JSONObject preview = failed.previewRestore(exported);
            expect("STORE_ERROR", () -> failed.restoreBackup(preview.getString("token"), "keep-current"));
        }
        File old = new File(destinationRoot, "notes/" + existing.getString("id") + ".md");
        String before = raw(old);
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(new File(destinationRoot, "restore-transaction-v1/plan.json"))) {
            output.write("tampered".getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        expect("CORRUPT", () -> {
            try (LocalSourceStore rejected = destination()) { fail("Corrupt committed transaction must not open"); }
        });
        assertEquals(before, raw(old));
        assertEquals(1, new File(destinationRoot, "notes").listFiles().length);
        assertTrue(new File(destinationRoot, "restore-transaction-v1/committed").isFile());
    }

    public void testProcessInterruptionReplaysRemainingNotesAndRebuildsIndex() throws Exception {
        save("中断 A", "合成正文 A");
        save("中断 B", "合成正文 B");
        JSONObject exported = store.backup();
        File destinationRoot = new File(root, "destination");
        LocalSourceStore interrupted = new LocalSourceStore(destinationRoot) {
            private int count;
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                super.writeAtomically(file, bytes);
                if ("notes".equals(file.getParentFile().getName()) && ++count == 1) throw new ProcessStopped();
            }
        };
        try {
            JSONObject preview = interrupted.previewRestore(exported);
            try {
                interrupted.restoreBackup(preview.getString("token"), "keep-current");
                fail("Expected simulated process ending");
            } catch (ProcessStopped expected) { /* Intentionally bypass normal exception cleanup. */ }
            assertEquals(1, new File(destinationRoot, "notes").listFiles().length);
            assertTrue(new File(destinationRoot, "restore-transaction-v1/committed").isFile());
        } finally { interrupted.close(); }
        SQLiteDatabase.deleteDatabase(new File(destinationRoot, "index.sqlite"));
        try (LocalSourceStore reopened = destination()) {
            assertEquals(2, reopened.list("合成正文").length());
            assertEquals(exported.getJSONArray("notes").toString(), reopened.backup().getJSONArray("notes").toString());
        }
    }

    private static final class ProcessStopped extends Error { private static final long serialVersionUID = 1L; }

    private JSONObject save(String title, String body) throws Exception { return store.save(new JSONObject().put("title", title).put("body", body)); }

    private JSONObject edit(JSONObject previous, String title, String body) throws Exception {
        return new JSONObject().put("id", previous.getString("id")).put("expectedHash", previous.getString("hash"))
            .put("title", title).put("body", body);
    }

    private LocalSourceStore destination() throws Exception { return new LocalSourceStore(new File(root, "destination")); }

    private JSONObject restore(LocalSourceStore destination, JSONObject exported) throws Exception {
        return destination.restoreBackup(destination.previewRestore(exported).getString("token"), "keep-current");
    }

    private JSONObject copy(JSONObject json) throws Exception { return new JSONObject(json.toString()); }

    private String replaceTimestamp(String raw, String timestamp) throws Exception {
        int end = raw.indexOf("\n---\n", 4);
        JSONObject header = new JSONObject(raw.substring(4, end));
        header.put("updatedAt", timestamp);
        return "---\n" + header + "\n---\n" + raw.substring(end + 5);
    }

    private void rejectWithoutWrites(JSONObject bad) throws Exception {
        try (LocalSourceStore destination = destination()) {
            String before = destination.backup().getJSONArray("notes").toString();
            try {
                destination.previewRestore(bad);
                fail("Expected whole package rejection");
            } catch (LocalSourceStore.StoreException expected) {
                assertTrue("VALIDATION".equals(expected.code) || "CORRUPT".equals(expected.code));
            }
            assertEquals(before, destination.backup().getJSONArray("notes").toString());
            assertEquals(0, new File(root, "destination/notes").listFiles().length);
            assertEquals(0, new File(root, "destination/originals").listFiles().length);
            assertFalse(new File(root, "destination/restore-transaction-v1/committed").exists());
        }
    }

    private String raw(File file) throws Exception { return new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8); }

    private static String repeat(char value, int count) {
        char[] chars = new char[count];
        Arrays.fill(chars, value);
        return new String(chars);
    }

    private interface Action { void run() throws Exception; }

    private void expect(String code, Action action) throws Exception {
        try { action.run(); fail("Expected " + code); }
        catch (LocalSourceStore.StoreException expected) { assertEquals(code, expected.code); }
    }

    private void deleteTree(File file) throws IOException {
        String candidate = file.getCanonicalPath();
        String allowed = root.getCanonicalPath();
        if (!candidate.equals(allowed) && !candidate.startsWith(allowed + File.separator)) throw new IOException("Outside disposable test root");
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        if (file.exists() && !file.delete()) throw new IOException("Cannot remove disposable test file");
    }
}
