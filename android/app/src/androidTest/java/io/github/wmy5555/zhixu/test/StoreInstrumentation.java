package io.github.wmy5555.zhixu.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.view.KeyEvent;
import android.widget.EditText;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.lang.reflect.Constructor;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Framework-only device regression. Uses a fresh synthetic cache directory, never the app library. */
public final class StoreInstrumentation extends Instrumentation {
    private File directory;
    private int passed;
    private static final String BASE = "a".repeat(64), NEXT = "b".repeat(64);
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            directory = Files.createTempDirectory(getTargetContext().getCacheDir().toPath(), "synthetic-store-").toFile();
            runChecks();
            result.putString("stream", "\nPASS: " + passed + " Android LibraryStore checks; synthetic private cache only.\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable failure) {
            result.putString("stream", "\nFAIL after " + passed + " checks: " + failure + "\n");
            finish(Activity.RESULT_CANCELED, result);
        } finally { if (directory != null) delete(directory); }
    }
    private static void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        file.delete();
    }
    private LibraryStore open(String name) throws Exception {
        File folder = new File(directory, name); folder.mkdirs();
        Constructor<LibraryStore> constructor = LibraryStore.class.getDeclaredConstructor(File.class);
        constructor.setAccessible(true); return constructor.newInstance(folder);
    }
    private static void check(boolean condition) { if (!condition) throw new AssertionError("unexpected store state"); }
    private interface Action { void run() throws Exception; }
    private static void rejected(Action action) throws Exception {
        try { action.run(); } catch (Exception expected) { return; }
        throw new AssertionError("unsafe operation accepted");
    }
    private static JSONObject note(String id, String kind, String hash, String body) throws Exception {
        return new JSONObject().put("id", id).put("desktopId", id).put("baseHash", hash)
            .put("kind", kind).put("title", "合成标题").put("body", body).put("dirty", false);
    }
    private static byte[] snapshot(String library, JSONObject... notes) throws Exception {
        JSONArray list = new JSONArray(); for (JSONObject note : notes) list.put(note);
        return new JSONObject().put("format", LibraryStore.FORMAT).put("version", 1)
            .put("libraryId", library).put("notes", list).toString().getBytes(StandardCharsets.UTF_8);
    }
    private void runChecks() throws Exception {
        LibraryStore local = open("persist");
        String id = local.save(null, "手机合成资料", "私人目录内的合成正文");
        JSONObject saved = open("persist").get(id);
        check(saved.getBoolean("dirty") && saved.getString("privacy").equals("local"));
        check(saved.getString("body").equals("私人目录内的合成正文"));
        passed++;

        LibraryStore merge = open("merge");
        merge.merge(snapshot("library-test", note("desktop-1", "source", BASE, "电脑原文")));
        merge.save("desktop-1", "合成标题", "手机修改");
        merge.merge(snapshot("library-test", note("desktop-1", "source", BASE, "电脑原文")));
        check(merge.get("desktop-1").getString("body").equals("手机修改"));
        check(!merge.get("desktop-1").has("conflict")); passed++;

        merge.merge(snapshot("library-test", note("desktop-1", "source", NEXT, "电脑修改")));
        check(merge.get("desktop-1").has("conflict"));
        rejected(merge::export); rejected(() -> merge.save("desktop-1", "合成标题", "静默覆盖"));
        merge.resolve("desktop-1", true);
        check(merge.all().length() == 2 && merge.get("desktop-1").getString("body").equals("电脑修改"));
        check(merge.all().getJSONObject(1).getString("body").equals("手机修改")); passed++;

        JSONObject receipt = note("receipt-1", "source", BASE, "私人目录内的合成正文");
        receipt.put("id", id).put("title", "手机合成资料");
        local.merge(snapshot("library-test", receipt));
        check(!local.get(id).getBoolean("dirty") && local.get(id).getString("desktopId").equals("receipt-1"));
        local.merge(snapshot("library-test", note("receipt-1", "source", NEXT, "电脑更新")));
        check(local.all().length() == 1 && local.get(id).getString("body").equals("电脑更新")); passed++;

        merge.merge(snapshot("library-test", note("knowledge-1", "knowledge", BASE, "只读学习知识")));
        rejected(() -> merge.save("knowledge-1", "改知识", "不允许"));
        check(merge.get("knowledge-1").getString("body").equals("只读学习知识")); passed++;

        String before = merge.all().toString();
        rejected(() -> merge.merge(snapshot("wrong-library", note("unknown-1", "source", BASE, "外部库"))));
        rejected(() -> merge.merge(snapshot("library-test", note("same", "source", BASE, "一"), note("same", "source", BASE, "二"))));
        rejected(() -> merge.merge(snapshot("library-test", note("valid", "source", BASE, "先有效"), note("bad", "source", "bad-hash", "后无效"))));
        check(merge.all().toString().equals(before)); passed++;

        JSONObject conflictReceipt = new JSONObject(new String(snapshot("library-test"), StandardCharsets.UTF_8));
        conflictReceipt.put("results", new JSONArray().put(new JSONObject().put("id", "desktop-1").put("status", "conflict").put("reason", "电脑已删除")));
        merge.merge(conflictReceipt.toString().getBytes(StandardCharsets.UTF_8));
        check(merge.get("desktop-1").getString("syncIssue").equals("电脑已删除"));
        check(merge.all().length() == 3); passed++;

        LibraryStore limited = open("limits");
        for (int i = 0; i < 100; i++) limited.save(null, "合成" + i, "数量测试正文");
        rejected(() -> limited.save(null, "101", "超过上限"));
        check(limited.all().length() == 100);
        rejected(() -> limited.merge(snapshot("library-test", note("extra", "source", BASE, "超限导入"))));
        check(limited.all().length() == 100); passed++;

        Throwable[] uiFailure = new Throwable[1];
        runOnMainSync(() -> {
            try {
                EditText title = new EditText(getTargetContext()), body = new EditText(getTargetContext());
                body.setText("ReadOnly"); MainActivity.makeReadOnly(title, body);
                body.onKeyDown(KeyEvent.KEYCODE_A, new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A));
                check(!title.isEnabled() && body.isTextSelectable() && body.getKeyListener() == null);
                check(body.getText().toString().equals("ReadOnly"));
                EditText editable = new EditText(getTargetContext()); editable.setText("Write");
                editable.setSelection(editable.length());
                editable.onKeyDown(KeyEvent.KEYCODE_A, new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A));
                check(!editable.getText().toString().equals("Write"));
            } catch (Throwable error) { uiFailure[0] = error; }
        });
        if (uiFailure[0] != null) throw new AssertionError("read-only Android keyboard regression", uiFailure[0]);
        passed++;
    }
}
