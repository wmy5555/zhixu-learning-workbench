package io.github.wmy5555.zhixu.sharedtest;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.test.AndroidTestCase;
import android.util.AtomicFile;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;

/** Uses only randomized app-cache directories and synthetic text; no desktop or installed-app data. */
@SuppressWarnings("deprecation")
public class LocalSourceStoreTest extends AndroidTestCase {
    private File root;
    private LocalSourceStore store;

    @Override protected void setUp() throws Exception {
        super.setUp();
        root = new File(getContext().getCacheDir(), "local-store-test-" + UUID.randomUUID()).getCanonicalFile();
        store = new LocalSourceStore(root);
    }

    @Override protected void tearDown() throws Exception {
        if (store != null) store.close();
        if (root != null) deleteTestTree(root);
        super.tearDown();
    }

    public void testPersistedMarkdownReopensWithStableIdAndMetadata() throws Exception {
        String body = "# 合成原文\n\n保留空格  \n第二行\n";
        JSONObject input = source("持久保存", body).put("meta", new JSONObject()
            .put("platform", "手工输入").put("author", "测试作者").put("url", "https://example.invalid/source")
            .put("date", "2026-10-07").put("locator", "第 2 段").put("topic", "样机"));
        JSONObject saved = store.save(input);
        String id = saved.getString("id");
        File markdown = noteFile(saved);
        assertTrue(markdown.isFile());
        String text = readText(markdown);
        assertTrue(text.startsWith("---\n{"));
        assertTrue(text.endsWith(body));
        assertEquals(text, readText(new File(root, "originals/" + id + ".md")));
        store.close();
        store = new LocalSourceStore(root);
        JSONObject restored = store.read(id);
        assertEquals(body, restored.getString("body"));
        assertEquals(saved.getString("hash"), restored.getString("hash"));
        assertEquals("source", restored.getString("kind"));
        assertEquals("reference", restored.getJSONObject("meta").getString("stage"));
        assertEquals("local", restored.getJSONObject("meta").getString("privacy"));
        assertEquals("测试作者", restored.getJSONObject("meta").getString("author"));
        assertEquals(1, store.list("第二行").length());
        assertEquals(0, store.list("不存在的检索词").length());
    }

    public void testNewTitlesStayWithinExchangeUtf16Limit() throws Exception {
        StringBuilder title = new StringBuilder();
        for (int index = 0; index < 100; index++) title.append("\uD83D\uDE00");
        JSONObject saved = store.save(source(title.toString(), "标题边界合成正文"));
        assertEquals(title.toString(), saved.getString("title"));
        expectCode("VALIDATION", () -> store.save(source(title + "a", "不可新建")));
        expectCode("VALIDATION", () -> store.save(edit(saved, title + "\uD83D\uDE00", "不可修改")));
        assertEquals(1, store.list("").length());
        assertEquals(saved.getString("hash"), store.read(saved.getString("id")).getString("hash"));
        // A legacy snapshot can contain 101 emoji: read/backup must not truncate or reject it.
        String legacyTitle = title + "\uD83D\uDE00";
        String original = readText(noteFile(saved));
        int headerEnd = original.indexOf("\n---\n", 4);
        JSONObject header = new JSONObject(original.substring(4, headerEnd));
        org.json.JSONArray hashFields = new org.json.JSONArray().put(legacyTitle).put(saved.getString("body")).put("reference").put("local");
        for (int index = 0; index < 6; index++) hashFields.put("");
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(hashFields.toString().getBytes(StandardCharsets.UTF_8));
        StringBuilder legacyHash = new StringBuilder();
        for (byte item : digest) legacyHash.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        String legacyRaw = "---\n" + header.put("title", legacyTitle).put("hash", legacyHash.toString()) + "\n---\n" + saved.getString("body");
        store.close();
        try (FileOutputStream output = new FileOutputStream(noteFile(saved))) { output.write(legacyRaw.getBytes(StandardCharsets.UTF_8)); }
        try (FileOutputStream output = new FileOutputStream(new File(root, "originals/" + saved.getString("id") + ".md"))) { output.write(legacyRaw.getBytes(StandardCharsets.UTF_8)); }
        store = new LocalSourceStore(root);
        assertEquals(legacyTitle, store.read(saved.getString("id")).getString("title"));
        assertEquals(legacyRaw, store.backup().getJSONArray("notes").getJSONObject(0).getString("current"));
    }

    public void testEditsRequireCurrentHashAndNoopCreatesNoHistory() throws Exception {
        JSONObject first = store.save(source("原题", "第一版"));
        String id = first.getString("id");
        JSONObject unchanged = store.save(edit(first, "原题", "第一版"));
        assertEquals(first.getString("hash"), unchanged.getString("hash"));
        assertEquals(first.getString("updatedAt"), unchanged.getString("updatedAt"));
        assertEquals(0, historyCount(id));

        JSONObject second = store.save(edit(first, "新题", "第二版"));
        assertFalse(first.getString("hash").equals(second.getString("hash")));
        assertEquals(1, historyCount(id));
        File[] history = new File(root, "history/" + id).listFiles();
        assertNotNull(history);
        assertTrue(readText(history[0]).endsWith("第一版"));
        assertTrue(readText(new File(root, "originals/" + id + ".md")).endsWith("第一版"));

        expectCode("CONFLICT", () -> store.save(edit(first, "过时修改", "不能覆盖第二版")));
        expectCode("VALIDATION", () -> store.save(source("缺少版本", "不能覆盖").put("id", id)));
        assertEquals("第二版", store.read(id).getString("body"));
        assertEquals(1, historyCount(id));

        // Returning to an earlier body must still preserve each separate editing event.
        JSONObject third = store.save(edit(second, "原题", "第一版"));
        store.save(edit(third, "第四版", "第三次编辑"));
        assertEquals(3, historyCount(id));
    }

    public void testValidationRejectsPathsOversizedContentAndUnsafeMetadata() throws Exception {
        expectCode("VALIDATION", () -> store.read("../index.sqlite"));
        expectCode("VALIDATION", () -> store.read("/storage/emulated/0/source.md"));
        expectCode("VALIDATION", () -> store.save(source("", "正文")));
        expectCode("VALIDATION", () -> store.save(source(repeated('题', 201), "正文")));
        expectCode("VALIDATION", () -> store.save(source("标题", " \n\t ")));
        expectCode("VALIDATION", () -> store.save(source("标题", "\u3000\u00a0")));
        expectCode("VALIDATION", () -> store.save(source("标题", repeated('文', 44000))));
        expectCode("VALIDATION", () -> store.save(source("标题", "无效\uD800")));
        expectCode("VALIDATION", () -> store.save(source("标题", "正文").put("path", "../notes.md")));
        expectCode("VALIDATION", () -> store.save(source("标题", "正文").put("kind", "knowledge")));
        expectCode("VALIDATION", () -> store.save(source("标题", "正文").put("meta", new JSONObject().put("privacy", "cloud"))));
        expectCode("VALIDATION", () -> store.save(source("标题", "正文").put("meta", new JSONObject().put("stage", "integrated"))));
        expectCode("VALIDATION", () -> store.save(source("标题", "正文").put("meta", new JSONObject().put("allowCloud", true))));
        expectCode("VALIDATION", () -> store.save(source("标题", "正文").put("meta", new JSONObject().put("author", new JSONObject()))));
        expectCode("VALIDATION", () -> store.save(source("标题", "正文").put("meta", "bad")));
        expectCode("VALIDATION", () -> store.save(source("标题", "正文").put("expectedHash", "old")));
        assertEquals(0, store.list("").length());

        JSONObject valid = store.save(source(repeated('题', 200), repeated('x', 128 * 1024))
            .put("meta", new JSONObject().put("stage", "reference").put("privacy", "local")));
        assertEquals(128 * 1024, valid.getString("body").getBytes(StandardCharsets.UTF_8).length);
        assertEquals(1, store.list(null).length());
    }

    public void testPartialEditsPreserveSourceAttributionAndAllowExplicitClearing() throws Exception {
        JSONObject first = store.save(source("原文", "原文内容").put("meta", new JSONObject()
            .put("author", "合成作者").put("platform", "合成平台")));
        JSONObject second = store.save(edit(first, "改标题", "保留来源").put("meta", new JSONObject()));
        assertEquals("合成作者", second.getJSONObject("meta").getString("author"));
        assertEquals("合成平台", second.getJSONObject("meta").getString("platform"));
        JSONObject third = store.save(edit(second, "改标题", "保留来源").put("meta", new JSONObject().put("author", "")));
        assertFalse(third.getJSONObject("meta").has("author"));
        assertEquals("合成平台", third.getJSONObject("meta").getString("platform"));
    }

    public void testOneHundredNoteLimitNeverPartiallyCreatesNextNote() throws Exception {
        JSONObject first = null;
        for (int index = 0; index < 100; index++) {
            JSONObject saved = store.save(source("合成资料 " + index, "合成正文"));
            if (index == 0) first = saved;
        }
        expectCode("LIMIT_REACHED", () -> store.save(source("超过上限", "不会被保存")));
        assertEquals(100, store.list("").length());
        assertEquals(100, new File(root, "notes").listFiles().length);
        assertEquals(100, new File(root, "originals").listFiles().length);
        assertNotNull(first);
        store.save(edit(first, "上限内仍可编辑", "已编辑"));
        assertEquals("已编辑", store.read(first.getString("id")).getString("body"));
    }

    public void testSQLiteIndexRebuildsFromMarkdownAfterDeletionAndTampering() throws Exception {
        JSONObject saved = store.save(source("索引重建", "Markdown 是权威"));
        store.close();
        File databaseFile = new File(root, "index.sqlite");
        SQLiteDatabase database = SQLiteDatabase.openDatabase(databaseFile.getPath(), null, SQLiteDatabase.OPEN_READWRITE);
        database.execSQL("DELETE FROM notes");
        database.close();

        store = new LocalSourceStore(root);
        assertEquals(1, store.list("权威").length());
        assertEquals(saved.getString("hash"), store.read(saved.getString("id")).getString("hash"));
        store.close();
        database = SQLiteDatabase.openDatabase(databaseFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
        try (Cursor cursor = database.rawQuery("SELECT count(*) FROM notes", null)) {
            assertTrue(cursor.moveToFirst());
            assertEquals(1, cursor.getInt(0));
        }
        database.close();
        assertTrue(SQLiteDatabase.deleteDatabase(databaseFile));
        store = new LocalSourceStore(root);
        assertEquals(1, store.list("").length());
        assertTrue(databaseFile.isFile());
    }

    public void testIndexFailureStillReportsCommittedMarkdownSave() throws Exception {
        store.close();
        File databaseFile = new File(root, "index.sqlite");
        assertTrue(SQLiteDatabase.deleteDatabase(databaseFile));
        assertTrue(databaseFile.mkdir());
        store = new LocalSourceStore(root);
        JSONObject saved = store.save(source("索引不可写", "保存仍应成功"));
        assertTrue(noteFile(saved).isFile());
        assertEquals(1, store.list("").length());
        assertEquals("保存仍应成功", store.read(saved.getString("id")).getString("body"));
        store.close();
        assertTrue(databaseFile.delete());
        store = new LocalSourceStore(root);
        assertEquals(1, store.list("").length());
    }

    public void testDurableCreateAndReplacementReturnSavedVersionAfterJournalCleanupFailure() throws Exception {
        for (String stage : Arrays.asList("before-journal-delete", "before-journal-sync", "after-journal-sync")) {
            for (boolean replace : new boolean[] { false, true }) {
                File scenario = new File(root, "journal-cleanup-" + stage + "-" + replace);
                JSONObject saved;
                String original;
                try (LocalSourceStore destination = new LocalSourceStore(scenario)) {
                    JSONObject previous = replace ? destination.save(source("原有资料", "必须保留的旧原文")) : null;
                    original = previous == null ? null : readText(new File(scenario, previous.getString("path")));
                    int[] failures = { 0 };
                    destination.setSaveCleanupFailurePointForTests(point -> {
                        if (stage.equals(point) && failures[0]++ == 0) throw new IOException("Synthetic one-shot journal cleanup failure");
                    });
                    saved = destination.save(previous == null ? source("已保存的新资料", "已持久提交的合成正文")
                        : edit(previous, "已保存的新标题", "已持久提交的合成正文"));
                    assertTrue(failures[0] > 0);
                    assertEquals("已持久提交的合成正文", saved.getString("body"));
                    assertEquals(saved.getString("hash"), destination.read(saved.getString("id")).getString("hash"));
                    assertEquals(1, destination.list("").length());
                    assertEquals(0, new File(scenario, "save-transactions-v1").listFiles().length);
                    JSONObject backup = destination.backup().getJSONArray("notes").getJSONObject(0);
                    assertEquals(readText(new File(scenario, saved.getString("path"))), backup.getString("current"));
                    assertEquals(replace ? 1 : 0, backup.getJSONArray("history").length());
                    assertEquals(replace ? original : backup.getString("current"), backup.getString("original"));
                    if (replace) {
                        assertEquals(original, backup.getJSONArray("history").getJSONObject(0).getString("raw"));
                        expectCode("CONFLICT", () -> destination.save(edit(previous, "过时重试", "不能覆盖已经保存的新版本")));
                    }
                    // The returned new hash makes a no-op retry succeed without another history entry.
                    JSONObject unchanged = destination.save(edit(saved, saved.getString("title"), saved.getString("body")));
                    assertEquals(saved.getString("hash"), unchanged.getString("hash"));
                    assertEquals(saved.getString("updatedAt"), unchanged.getString("updatedAt"));
                    assertEquals(replace ? 1 : 0, destination.backup().getJSONArray("notes").getJSONObject(0).getJSONArray("history").length());
                }
                try (LocalSourceStore reopened = new LocalSourceStore(scenario)) {
                    assertEquals(saved.getString("hash"), reopened.read(saved.getString("id")).getString("hash"));
                    assertEquals(saved.getString("body"), reopened.read(saved.getString("id")).getString("body"));
                }
            }
        }
    }

    public void testPersistentJournalCleanupStillBlocksReadsUntilStorageRecovers() throws Exception {
        store.setSaveCleanupFailurePointForTests(stage -> {
            if ("before-journal-delete".equals(stage)) throw new IOException("Synthetic persistent journal delete failure");
        });
        JSONObject saved = store.save(source("新版已确认持久提交", "收尾故障不会让提交变成失败"));
        assertTrue(noteFile(saved).isFile());
        assertEquals(1, new File(root, "save-transactions-v1").listFiles().length);
        // This focused fix reports the known durable save; it does not make persistent storage faults disappear.
        expectCode("STORE_ERROR", () -> store.read(saved.getString("id")));
        expectCode("STORE_ERROR", () -> store.list(""));
        store.setSaveCleanupFailurePointForTests(null);
        assertEquals(saved.getString("hash"), store.read(saved.getString("id")).getString("hash"));
        assertEquals(0, new File(root, "save-transactions-v1").listFiles().length);
    }

    public void testDurableSaveCannotSwallowUnsafeJournalPathOrUnexpectedCurrentBytes() throws Exception {
        for (boolean unsafePath : new boolean[] { false, true }) {
            File scenario = new File(root, "ambiguous-cleanup-" + unsafePath);
            try (LocalSourceStore destination = new LocalSourceStore(scenario)) {
                JSONObject previous = destination.save(source("已提交旧原文", "保留旧版证据"));
                File current = new File(scenario, previous.getString("path"));
                String original = readText(current);
                File unsafe = new File(scenario, "save-transactions-v1/" + previous.getString("id") + ".json.new");
                String[] committed = { null };
                boolean[] injected = { false };
                destination.setSaveCleanupFailurePointForTests(stage -> {
                    if (!injected[0] && "before-journal-delete".equals(stage)) {
                        injected[0] = true;
                        try { committed[0] = readText(current); }
                        catch (Exception exception) { throw new IOException("Cannot capture synthetic committed bytes", exception); }
                        if (unsafePath) {
                            if (!unsafe.mkdir()) throw new IOException("Cannot create synthetic unsafe journal entry");
                        } else {
                            try (FileOutputStream output = new FileOutputStream(current, true)) {
                                output.write("unexpected trailing bytes".getBytes(StandardCharsets.UTF_8)); output.getFD().sync();
                            }
                        }
                        throw new IOException("Synthetic ambiguous cleanup failure");
                    }
                });
                expectCode(unsafePath ? "STORE_ERROR" : "CORRUPT", () -> destination.save(edit(previous, "新版本", "提交后需要重新核对的原文")));
                assertEquals(original, readText(new File(scenario, "originals/" + previous.getString("id") + ".md")));
                assertEquals(original, readText(new File(scenario, "history/" + previous.getString("id")).listFiles()[0]));
                assertTrue(new File(scenario, "save-transactions-v1/" + previous.getString("id") + ".json").isFile());
                destination.setSaveCleanupFailurePointForTests(null);
                if (unsafePath) assertTrue(unsafe.delete());
                else try (FileOutputStream output = new FileOutputStream(current)) {
                    output.write(committed[0].getBytes(StandardCharsets.UTF_8)); output.getFD().sync();
                }
                assertEquals("提交后需要重新核对的原文", destination.read(previous.getString("id")).getString("body"));
            }
        }
    }

    public void testFailedWriteKeepsOldMarkdownAndInputVersion() throws Exception {
        JSONObject first = store.save(source("写入失败", "应保留的旧正文"));
        String original = readText(noteFile(first));
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) {
                    AtomicFile atomic = new AtomicFile(file);
                    FileOutputStream output = atomic.startWrite();
                    output.write("unfinished".getBytes(StandardCharsets.UTF_8));
                    atomic.failWrite(output);
                    throw new IOException("Synthetic partial write failure");
                }
                super.writeAtomically(file, bytes);
            }
        };
        expectCode("STORE_ERROR", () -> store.save(edit(first, "未保存的新标题", "未保存的新正文")));
        assertEquals(original, readText(noteFile(first)));
        assertEquals(first.getString("hash"), store.read(first.getString("id")).getString("hash"));
        assertEquals(0, historyCount(first.getString("id")));
        assertEquals(original, readText(new File(root, "originals/" + first.getString("id") + ".md")));
        store.close();
        store = new LocalSourceStore(root);
        assertEquals("应保留的旧正文", store.read(first.getString("id")).getString("body"));
    }

    public void testRepeatedFailedWritesKeepExistingHistoryAndLastHistorySlot() throws Exception {
        JSONObject first = store.save(source("已有历史", "合成第一版"));
        JSONObject current = store.save(edit(first, "已有历史", "合成第二版"));
        String id = first.getString("id");
        File versions = new File(root, "history/" + id);
        File[] existing = versions.listFiles();
        assertNotNull(existing);
        assertEquals(1, existing.length);
        String existingMarkdown = readText(existing[0]);
        // Disposable, valid snapshots put the store one slot below its real 1000-history limit.
        for (int index = 1; index < 999; index++) {
            File snapshot = new File(versions, first.getString("updatedAt").replace(':', '-')
                + "-" + UUID.randomUUID() + ".md");
            try (FileOutputStream output = new FileOutputStream(snapshot)) {
                output.write(existingMarkdown.getBytes(StandardCharsets.UTF_8));
            }
        }
        String currentMarkdown = readText(noteFile(current));
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) throw new IOException("Synthetic write failure");
                super.writeAtomically(file, bytes);
            }
        };
        for (int attempt = 0; attempt < 3; attempt++) {
            expectCode("STORE_ERROR", () -> store.save(edit(current, "失败重试", "仍未提交")));
            assertEquals(999, historyCount(id));
            assertEquals(currentMarkdown, readText(noteFile(current)));
            assertEquals(existingMarkdown, readText(existing[0]));
        }
        store.close();
        store = new LocalSourceStore(root);
        JSONObject saved = store.save(edit(current, "成功编辑", "最后一个历史名额仍可用"));
        assertEquals(1000, historyCount(id));
        assertEquals(saved.getString("hash"), store.read(id).getString("hash"));
        assertEquals(existingMarkdown, readText(existing[0]));
    }

    public void testExceptionAfterCurrentCommitPreservesPreviousHistory() throws Exception {
        JSONObject first = store.save(source("提交后异常", "必须保留的旧原文"));
        String original = readText(noteFile(first));
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                super.writeAtomically(file, bytes);
                if ("notes".equals(file.getParentFile().getName())) throw new IllegalStateException("Synthetic post-commit failure");
            }
        };
        expectCode("STORE_ERROR", () -> store.save(edit(first, "提交后异常", "已提交的新原文")));
        String id = first.getString("id");
        assertEquals("已提交的新原文", store.read(id).getString("body"));
        assertEquals(1, historyCount(id));
        assertEquals(original, readText(new File(root, "history/" + id).listFiles()[0]));
        expectCode("CONFLICT", () -> store.save(edit(first, "过时重试", "不能覆盖已提交内容")));
        store.close();
        store = new LocalSourceStore(root);
        assertEquals("已提交的新原文", store.read(id).getString("body"));
        assertEquals(1, historyCount(id));
    }

    public void testUncertainCurrentReadPreservesOnlyPreviousSnapshot() throws Exception {
        JSONObject first = store.save(source("读回不确定", "完整旧原文"));
        JSONObject current = store.save(edit(first, "读回不确定", "只有当前和历史保存的第二版"));
        String previousMarkdown = readText(noteFile(current));
        String original = readText(new File(root, "originals/" + first.getString("id") + ".md"));
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) {
                    // Simulate a storage fault that leaves no readable current file; the snapshot is needed.
                    new AtomicFile(file).delete();
                    throw new IOException("Synthetic lost current file");
                }
                super.writeAtomically(file, bytes);
            }
        };
        expectCode("STORE_ERROR", () -> store.save(edit(current, "未提交", "不要丢弃旧原文")));
        String id = first.getString("id");
        assertEquals(2, historyCount(id));
        boolean previousPreserved = false;
        for (File snapshot : new File(root, "history/" + id).listFiles()) {
            if (previousMarkdown.equals(readText(snapshot))) previousPreserved = true;
        }
        assertTrue(previousPreserved);
        assertEquals(original, readText(new File(root, "originals/" + id + ".md")));
        assertEquals(1, new File(root, "save-transactions-v1").listFiles().length);
        store.close();
        store = new LocalSourceStore(root);
        assertEquals(previousMarkdown, readText(noteFile(current)));
        assertEquals(current.getString("hash"), store.read(id).getString("hash"));
        assertEquals(1, store.list("第二版").length());
        assertEquals(3, store.history(id).length()); // immutable original plus both retained edit snapshots
        JSONObject backup = store.backup().getJSONArray("notes").getJSONObject(0);
        assertEquals(previousMarkdown, backup.getString("current"));
        assertEquals(2, backup.getJSONArray("history").length());
        assertEquals(0, new File(root, "save-transactions-v1").listFiles().length);
    }

    public void testOneLostCurrentWriteRepairsOldVersionBeforeReturningFailure() throws Exception {
        JSONObject first = store.save(source("旧版可达", "第一版合成资料"));
        JSONObject previous = store.save(edit(first, "旧版可达", "第二版不能丢失"));
        String bytes = readText(noteFile(previous));
        store.close();
        store = new LocalSourceStore(root) {
            private boolean failed;
            @Override void writeAtomically(File file, byte[] value) throws IOException {
                if (!failed && "notes".equals(file.getParentFile().getName())) {
                    failed = true;
                    new AtomicFile(file).delete();
                    throw new IOException("Synthetic one-shot lost current");
                }
                super.writeAtomically(file, value);
            }
        };
        expectCode("STORE_ERROR", () -> store.save(edit(previous, "未提交", "第三版未能保存")));
        assertEquals(bytes, readText(noteFile(previous)));
        assertEquals(previous.getString("hash"), store.read(previous.getString("id")).getString("hash"));
        assertEquals(1, store.list("不能丢失").length());
        assertEquals(bytes, store.backup().getJSONArray("notes").getJSONObject(0).getString("current"));
        assertEquals(2, historyCount(previous.getString("id")));
    }

    public void testInterruptedReplacementWithMissingCurrentRepairsOnReopen() throws Exception {
        JSONObject first = store.save(source("重开恢复", "第一版合成资料"));
        JSONObject previous = store.save(edit(first, "重开恢复", "最后已提交的第二版"));
        String bytes = readText(noteFile(previous));
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] value) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) {
                    new AtomicFile(file).delete();
                    throw new SimulatedProcessExit();
                }
                super.writeAtomically(file, value);
            }
        };
        try { store.save(edit(previous, "中断修改", "尚未提交的第三版")); fail("Expected simulated process exit"); }
        catch (SimulatedProcessExit expected) { /* No catch-time repair can execute. */ }
        assertFalse(noteFile(previous).exists());
        assertEquals(2, historyCount(previous.getString("id")));
        store.close();
        store = new LocalSourceStore(root);
        assertEquals(bytes, readText(noteFile(previous)));
        assertEquals(1, store.list("").length());
        assertEquals(previous.getString("hash"), store.read(previous.getString("id")).getString("hash"));
        assertEquals(bytes, store.backup().getJSONArray("notes").getJSONObject(0).getString("current"));
        assertEquals(2, historyCount(previous.getString("id")));
    }

    public void testExistingAmbiguousCurrentIsPreservedWithExplicitRecoveryError() throws Exception {
        JSONObject first = store.save(source("不确定当前版本", "用户最初原文"));
        JSONObject previous = store.save(edit(first, "不确定当前版本", "最后已提交的第二版"));
        String firstMarkdown = readText(new File(root, "originals/" + first.getString("id") + ".md"));
        String previousMarkdown = readText(noteFile(previous));
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] value) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) {
                    // A valid external change is neither the expected previous bytes nor our new bytes.
                    super.writeAtomically(file, firstMarkdown.getBytes(StandardCharsets.UTF_8));
                    throw new IOException("Synthetic unexpected current version");
                }
                super.writeAtomically(file, value);
            }
        };
        expectCode("STORE_ERROR", () -> store.save(edit(previous, "保存失败", "未提交的第三版")));
        assertEquals(firstMarkdown, readText(noteFile(previous)));
        expectCode("CORRUPT", () -> store.list(""));
        expectCode("CORRUPT", () -> store.read(previous.getString("id")));
        expectCode("CORRUPT", () -> store.backup());
        boolean oldPreserved = false;
        for (File file : new File(root, "history/" + previous.getString("id")).listFiles()) {
            if (previousMarkdown.equals(readText(file))) oldPreserved = true;
        }
        assertTrue(oldPreserved);
        assertEquals(1, new File(root, "save-transactions-v1").listFiles().length);
        store.close();
        expectCode("CORRUPT", () -> new LocalSourceStore(root));
        assertEquals(firstMarkdown, readText(noteFile(previous)));
    }

    public void testTemporarilyUnreadableCurrentRetainsJournalAndSnapshotUntilReopen() throws Exception {
        JSONObject first = store.save(source("暂时不可读", "旧原文仍应保留"));
        String original = readText(noteFile(first));
        store.close();
        store = new LocalSourceStore(root) {
            private boolean unreadable;
            @Override void writeAtomically(File file, byte[] value) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) {
                    unreadable = true;
                    throw new IOException("Synthetic current read fault");
                }
                super.writeAtomically(file, value);
            }
            @Override byte[] readBytes(File file) throws IOException, LocalSourceStore.StoreException {
                if (unreadable && "notes".equals(file.getParentFile().getName())) throw new IOException("Synthetic unreadable current");
                return super.readBytes(file);
            }
        };
        expectCode("STORE_ERROR", () -> store.save(edit(first, "尚未保存", "新的合成输入")));
        expectCode("CORRUPT", () -> store.read(first.getString("id")));
        assertEquals(original, readText(noteFile(first)));
        assertEquals(1, historyCount(first.getString("id")));
        assertEquals(1, new File(root, "save-transactions-v1").listFiles().length);
        store.close();
        store = new LocalSourceStore(root);
        assertEquals(first.getString("hash"), store.read(first.getString("id")).getString("hash"));
        assertEquals(original, store.backup().getJSONArray("notes").getJSONObject(0).getString("current"));
        assertEquals(1, historyCount(first.getString("id")));
    }

    public void testRepeatedFailedNewWritesCleanOnlyJournalOwnedOriginals() throws Exception {
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] value) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) throw new IOException("Synthetic new current write failure");
                super.writeAtomically(file, value);
            }
        };
        for (int attempt = 0; attempt < 3; attempt++) {
            expectCode("STORE_ERROR", () -> store.save(source("未提交的新资料", "合成草稿不能留下永久孤儿")));
            assertEquals(0, new File(root, "notes").listFiles().length);
            assertEquals(0, new File(root, "originals").listFiles().length);
            assertEquals(0, new File(root, "save-transactions-v1").listFiles().length);
            assertEquals(0, store.backup().getJSONArray("notes").length());
        }
        store.close();
        store = new LocalSourceStore(root);
        assertEquals(0, store.list("").length());
    }

    public void testInterruptedNewSaveReclaimsOriginalAndPartialCurrentOnReopen() throws Exception {
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] value) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) {
                    AtomicFile atomic = new AtomicFile(file);
                    FileOutputStream output = atomic.startWrite();
                    output.write("unfinished".getBytes(StandardCharsets.UTF_8)); output.close();
                    throw new SimulatedProcessExit();
                }
                super.writeAtomically(file, value);
            }
        };
        try { store.save(source("新建中断", "尚未提交的合成原文")); fail("Expected simulated process exit"); }
        catch (SimulatedProcessExit expected) { /* The synced journal authorizes startup cleanup. */ }
        assertEquals(1, new File(root, "originals").listFiles().length);
        assertEquals(1, new File(root, "save-transactions-v1").listFiles().length);
        store.close();
        store = new LocalSourceStore(root);
        assertEquals(0, store.list("").length());
        assertEquals(0, new File(root, "notes").listFiles().length);
        assertEquals(0, new File(root, "originals").listFiles().length);
        assertEquals(0, new File(root, "save-transactions-v1").listFiles().length);
        assertEquals(0, store.backup().getJSONArray("notes").length());
    }

    public void testInterruptedNewSaveAfterCurrentCommitRetainsOriginalAndNote() throws Exception {
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] value) throws IOException {
                super.writeAtomically(file, value);
                if ("notes".equals(file.getParentFile().getName())) throw new SimulatedProcessExit();
            }
        };
        try { store.save(source("已提交的新资料", "进程退出前已完整提交")); fail("Expected simulated process exit"); }
        catch (SimulatedProcessExit expected) { /* The authority has committed but the journal remains. */ }
        assertEquals(1, new File(root, "notes").listFiles().length);
        assertEquals(1, new File(root, "originals").listFiles().length);
        store.close();
        store = new LocalSourceStore(root);
        JSONObject note = store.list("").getJSONObject(0);
        assertEquals("进程退出前已完整提交", note.getString("body"));
        assertEquals(readText(noteFile(note)), readText(new File(root, "originals/" + note.getString("id") + ".md")));
        assertEquals(1, store.backup().getJSONArray("notes").length());
        assertEquals(0, new File(root, "save-transactions-v1").listFiles().length);
    }

    public void testUnmarkedAndAmbiguousOriginalsAreNeverDeleted() throws Exception {
        JSONObject saved = store.save(source("无法判断的旧原文", "没有保存日志的原始资料必须保留"));
        File original = new File(root, "originals/" + saved.getString("id") + ".md");
        String bytes = readText(original);
        new AtomicFile(noteFile(saved)).delete();
        store.close();
        store = new LocalSourceStore(root);
        assertEquals(bytes, readText(original));
        assertEquals(0, new File(root, "save-transactions-v1").listFiles().length);
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] value) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) throw new SimulatedProcessExit();
                super.writeAtomically(file, value);
            }
        };
        try { store.save(source("未完成的新建", "需要校验才能清理")); fail("Expected simulated process exit"); }
        catch (SimulatedProcessExit expected) { }
        File changed = null;
        for (File file : new File(root, "originals").listFiles()) if (!file.equals(original)) changed = file;
        assertNotNull(changed);
        try (FileOutputStream output = new FileOutputStream(changed)) { output.write("unexpected external bytes".getBytes(StandardCharsets.UTF_8)); }
        store.close();
        expectCode("CORRUPT", () -> new LocalSourceStore(root));
        assertEquals(bytes, readText(original));
        assertEquals("unexpected external bytes", readText(changed));
        assertEquals(1, new File(root, "save-transactions-v1").listFiles().length);
    }

    public void testInterruptedSaveKeepsRecoveryEvidenceOnReopen() throws Exception {
        JSONObject first = store.save(source("保存中断", "退出前的完整原文"));
        String original = readText(noteFile(first));
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) {
                    AtomicFile atomic = new AtomicFile(file);
                    FileOutputStream output = atomic.startWrite();
                    output.write("unfinished".getBytes(StandardCharsets.UTF_8));
                    output.close();
                    throw new SimulatedProcessExit();
                }
                super.writeAtomically(file, bytes);
            }
        };
        try {
            store.save(edit(first, "未完成", "未完成的新原文"));
            fail("Expected simulated process exit");
        } catch (SimulatedProcessExit expected) { /* No catch-time cleanup can run after process death. */ }
        store.close();
        store = new LocalSourceStore(root);
        String id = first.getString("id");
        assertEquals(original, readText(noteFile(first)));
        assertEquals(1, historyCount(id));
        assertEquals(original, readText(new File(root, "history/" + id).listFiles()[0]));
    }

    public void testInterruptedHistoryStagingIsReclaimedOnlyAfterPreviousCurrentValidation() throws Exception {
        JSONObject first = store.save(source("历史写入中断", "已提交的第一版"));
        JSONObject previous = store.save(edit(first, "历史写入中断", "已提交的第二版"));
        String previousMarkdown = readText(noteFile(previous));
        File directory = new File(root, "history/" + previous.getString("id"));
        File[] existing = directory.listFiles();
        assertNotNull(existing);
        assertEquals(1, existing.length);
        String existingMarkdown = readText(existing[0]);
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("history".equals(file.getParentFile().getParentFile().getName())) {
                    AtomicFile atomic = new AtomicFile(file);
                    FileOutputStream output = atomic.startWrite();
                    output.write("unfinished archive".getBytes(StandardCharsets.UTF_8));
                    output.close();
                    throw new SimulatedProcessExit();
                }
                super.writeAtomically(file, bytes);
            }
        };
        try { store.save(edit(previous, "尚未提交", "历史快照未写完的新输入")); fail("Expected simulated process exit"); }
        catch (SimulatedProcessExit expected) { /* The uniquely owned .new remains until startup validates current. */ }
        assertEquals(2, directory.listFiles().length);
        boolean staged = false;
        for (File file : directory.listFiles()) if (file.getName().endsWith(".new")) staged = true;
        assertTrue(staged);
        assertEquals(1, new File(root, "save-transactions-v1").listFiles().length);
        assertEquals(previousMarkdown, readText(noteFile(previous)));
        store.close();
        store = new LocalSourceStore(root);
        assertEquals(1, directory.listFiles().length);
        assertEquals(existingMarkdown, readText(existing[0]));
        assertEquals(previousMarkdown, readText(noteFile(previous)));
        assertEquals(previous.getString("hash"), store.read(previous.getString("id")).getString("hash"));
        assertEquals(0, new File(root, "save-transactions-v1").listFiles().length);
        assertEquals(1, store.backup().getJSONArray("notes").getJSONObject(0).getJSONArray("history").length());
    }

    public void testInterruptedAtomicWriteRecoversLastCommittedMarkdown() throws Exception {
        JSONObject saved = store.save(source("中断恢复", "最后一次完整正文"));
        store.close();
        AtomicFile atomic = new AtomicFile(noteFile(saved));
        FileOutputStream interrupted = atomic.startWrite();
        interrupted.write("unfinished".getBytes(StandardCharsets.UTF_8));
        interrupted.close();
        // Simulate a process ending before finishWrite/failWrite; opening performs the platform recovery.
        store = new LocalSourceStore(root);
        assertEquals(saved.getString("hash"), store.read(saved.getString("id")).getString("hash"));
        assertEquals("最后一次完整正文", store.read(saved.getString("id")).getString("body"));
    }

    private JSONObject source(String title, String body) throws Exception {
        return new JSONObject().put("title", title).put("body", body);
    }

    private JSONObject edit(JSONObject previous, String title, String body) throws Exception {
        return source(title, body).put("id", previous.getString("id")).put("expectedHash", previous.getString("hash"));
    }

    private File noteFile(JSONObject note) throws Exception { return new File(root, note.getString("path")); }

    private int historyCount(String id) {
        File[] files = new File(root, "history/" + id).listFiles();
        return files == null ? 0 : files.length;
    }

    private String readText(File file) throws Exception {
        return new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8);
    }

    private static String repeated(char character, int count) {
        char[] chars = new char[count];
        Arrays.fill(chars, character);
        return new String(chars);
    }

    private interface ThrowingOperation { void run() throws Exception; }

    private static class SimulatedProcessExit extends Error { }

    private void expectCode(String expected, ThrowingOperation operation) throws Exception {
        try {
            operation.run();
            fail("Expected " + expected);
        } catch (LocalSourceStore.StoreException exception) {
            assertEquals(expected, exception.code);
        }
    }

    private void deleteTestTree(File file) throws IOException {
        String candidate = file.getCanonicalPath();
        String permitted = root.getCanonicalPath();
        if (!candidate.equals(permitted) && !candidate.startsWith(permitted + File.separator)) {
            throw new IOException("Refusing to remove a path outside this test directory");
        }
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTestTree(child);
        if (file.exists() && !file.delete()) throw new IOException("Cannot remove temporary test file");
    }
}
