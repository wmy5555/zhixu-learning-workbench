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

    public void testFailedWriteKeepsOldMarkdownAndInputVersion() throws Exception {
        JSONObject first = store.save(source("写入失败", "应保留的旧正文"));
        String original = readText(noteFile(first));
        store.close();
        store = new LocalSourceStore(root) {
            @Override void writeAtomically(File file, byte[] bytes) throws IOException {
                if ("notes".equals(file.getParentFile().getName())) throw new IOException("Synthetic write failure");
                super.writeAtomically(file, bytes);
            }
        };
        expectCode("STORE_ERROR", () -> store.save(edit(first, "未保存的新标题", "未保存的新正文")));
        assertEquals(original, readText(noteFile(first)));
        assertEquals(first.getString("hash"), store.read(first.getString("id")).getString("hash"));
        store.close();
        store = new LocalSourceStore(root);
        assertEquals("应保留的旧正文", store.read(first.getString("id")).getString("body"));
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
