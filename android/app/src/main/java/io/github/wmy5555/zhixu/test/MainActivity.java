package io.github.wmy5555.zhixu.test;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int IMPORT_SYNC = 1, IMPORT_TEXT = 2, EXPORT_SYNC = 3;
    private LibraryStore store;
    private LinearLayout root, list;
    private EditText title, body;
    private String editingId, originalTitle = "", originalBody = "";
    private boolean editing, busy;
    private byte[] pendingExport;
    private AtomicFile draftFile;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            draftFile = new AtomicFile(new File(getFilesDir(), "editor-draft.json"));
            store = LibraryStore.open(getFilesDir());
            if (draftFile.getBaseFile().exists()) {
                JSONObject draft = new JSONObject(new String(draftFile.readFully(), StandardCharsets.UTF_8));
                String id = draft.optString("id", "");
                if (!id.isEmpty()) { try { store.get(id); } catch (Exception missing) { id = ""; } }
                edit(id.isEmpty() ? null : id);
                title.setText(draft.getString("title")); body.setText(draft.getString("body"));
            } else showLibrary();
        }
        catch (Exception error) { failClosed(error); }
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout page(String heading) {
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(16), dp(16), dp(16), dp(16));
        root.setFitsSystemWindows(true); setContentView(root);
        TextView label = text(heading); label.setTextSize(24); root.addView(label);
        return root;
    }
    private TextView text(String value) { TextView v = new TextView(this); v.setText(value); v.setTextSize(16); v.setPadding(0, dp(8), 0, dp(8)); return v; }
    private Button button(String label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false);
        button.setOnClickListener(v -> { if (!busy) action.run(); }); return button;
    }
    private void message(String value) { new AlertDialog.Builder(this).setMessage(value).setPositiveButton("知道了", null).show(); }
    private void failClosed(Exception error) { page("资料库暂时无法打开"); root.addView(text("为保留已有资料，本次未重置或覆盖文件。请保留 App 并检查备份。")); }
    private void showLibrary() {
        editing = false; editingId = null;
        if (draftFile != null) draftFile.delete();
        page("知序 · 手机资料库");
        root.addView(text("资料保存在此手机。当前准备版支持阅读、收集与文件交换；网络同步尚未启用。学习计划、回答及 AI 加工在电脑端使用。"));
        LinearLayout actions = new LinearLayout(this);
        actions.addView(button("收集", () -> edit(null))); actions.addView(button("导入文本", () -> pick(IMPORT_TEXT)));
        root.addView(actions);
        LinearLayout files = new LinearLayout(this);
        files.addView(button("导入电脑文件", () -> pick(IMPORT_SYNC)));
        files.addView(button("导出手机文件", () -> new AlertDialog.Builder(this)
            .setMessage("文件含所保存的资料正文，以明文写入你选择的位置。只通过可信渠道传递；系统密钥和学习记录不在其中。")
            .setNegativeButton("取消", null).setPositiveButton("选择保存位置", (d, w) -> export()).show()));
        root.addView(files);
        EditText search = new EditText(this); search.setSingleLine(); search.setHint("在手机上搜索标题或正文"); root.addView(search);
        ScrollView scroll = new ScrollView(this); list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            public void onTextChanged(CharSequence s, int st, int b, int c) { renderList(s.toString()); }
            public void afterTextChanged(Editable e) {}
        });
        renderList("");
    }
    private void renderList(String query) {
        try {
            list.removeAllViews(); JSONArray notes = store.all(); String q = query.toLowerCase(Locale.ROOT); int count = 0;
            for (int i = notes.length() - 1; i >= 0; i--) {
                JSONObject n = notes.getJSONObject(i);
                if (!(n.getString("title") + "\n" + n.getString("body")).toLowerCase(Locale.ROOT).contains(q)) continue;
                String id = n.getString("id");
                String status = n.has("conflict") ? "双方修改待处理" : n.has("syncIssue") ? "电脑未保存，请核对" : n.getBoolean("dirty") ? "本机修改待交换" : "电脑资料副本";
                Button row = button(n.getString("title") + "\n" + status + (n.getString("kind").equals("source") ? "" : " · 只读"), () -> edit(id));
                row.setContentDescription(n.getString("title") + "，" + status); list.addView(row); count++;
            }
            if (count == 0) list.addView(text("没有匹配资料。可在手机收集，或导入电脑明确选中的资料。"));
        } catch (Exception error) { message("读取资料失败，已有文件保留。"); }
    }
    private void edit(String id) {
        try {
            JSONObject n = id == null ? null : store.get(id);
            editing = true; editingId = id; originalTitle = n == null ? "" : n.getString("title"); originalBody = n == null ? "" : n.getString("body");
            page(id == null ? "收集原始资料" : "阅读资料");
            root.addView(button("返回资料库", this::leaveEditor));
            title = new EditText(this); title.setHint("标题（最多 200 字）"); title.setSingleLine(); title.setText(originalTitle); root.addView(title);
            body = new EditText(this); body.setHint("粘贴原文或记录想法，默认仅留本机"); body.setGravity(android.view.Gravity.TOP); body.setText(originalBody);
            root.addView(body, new LinearLayout.LayoutParams(-1, 0, 1));
            boolean readOnly = n != null && (!n.getString("kind").equals("source") || n.has("conflict"));
            if (n != null && n.has("syncIssue")) root.addView(text("交换提醒：" + n.getString("syncIssue")));
            title.setEnabled(!readOnly); body.setFocusable(!readOnly); body.setTextIsSelectable(readOnly);
            if (n != null && n.has("conflict")) {
                root.addView(text("电脑与手机都改过此资料。当前显示手机版本；原版本在处理前保留。"));
                root.addView(button("查看电脑版本并处理", () -> resolve(id)));
            } else if (readOnly) root.addView(text("这是电脑资料的阅读副本。正式学习、AI 建议和确认请在电脑端操作。"));
            else root.addView(button("保存到手机", () -> {
                try { store.save(editingId, title.getText().toString(), body.getText().toString()); showLibrary(); }
                catch (Exception error) { message(error.getMessage()); }
            }));
        } catch (Exception error) { message(error.getMessage()); }
    }
    private void leaveEditor() {
        if (!editing || originalTitle.equals(title.getText().toString()) && originalBody.equals(body.getText().toString())) { showLibrary(); return; }
        new AlertDialog.Builder(this).setMessage("尚有未保存文字。是否放弃本次输入？")
            .setNegativeButton("继续编辑", null).setPositiveButton("放弃输入", (d, w) -> showLibrary()).show();
    }
    private void resolve(String id) {
        try {
            JSONObject remote = store.get(id).getJSONObject("conflict");
            TextView value = text(remote.getString("title") + "\n\n" + remote.getString("body")); value.setTextIsSelectable(true);
            ScrollView scroll = new ScrollView(this); scroll.addView(value);
            new AlertDialog.Builder(this).setTitle("电脑版本").setView(scroll).setNegativeButton("暂不处理", null)
                .setNeutralButton("手机版本另存为新资料", (d, w) -> finishResolution(id, true))
                .setPositiveButton("采用电脑版本", (d, w) -> new AlertDialog.Builder(this).setMessage("采用电脑版本将放弃这条手机版本；需要保留请另存。")
                    .setNegativeButton("取消", null).setPositiveButton("采用", (x, y) -> finishResolution(id, false)).show()).show();
        } catch (Exception error) { message(error.getMessage()); }
    }
    private void finishResolution(String id, boolean copy) { try { store.resolve(id, copy); showLibrary(); } catch (Exception error) { message(error.getMessage()); } }
    private void pick(int request) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(intent, request); } catch (Exception error) { message("系统没有可用的文件选择器。"); }
    }
    private void export() {
        try {
            pendingExport = store.export();
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE, "zhixu-phone.json"); startActivityForResult(intent, EXPORT_SYNC);
        } catch (Exception error) { pendingExport = null; message(error.getMessage()); }
    }
    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (result != RESULT_OK || intent == null || intent.getData() == null) { pendingExport = null; return; }
        if (request != IMPORT_SYNC && request != IMPORT_TEXT && request != EXPORT_SYNC) return;
        var uri = intent.getData(); final byte[] exportBytes = pendingExport; pendingExport = null; busy = true;
        io.execute(() -> {
            try {
                String resultText;
                if (request == EXPORT_SYNC) {
                    if (exportBytes == null) throw new Exception("导出已中断，请重新选择保存位置。");
                    try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
                        if (stream == null) throw new Exception("不能写入所选文件。"); stream.write(exportBytes);
                    }
                    resultText = "手机交换文件已保存；尚未发送到电脑。";
                } else {
                    byte[] bytes;
                    try (InputStream stream = getContentResolver().openInputStream(uri); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                        if (stream == null) throw new Exception("不能读取所选文件。");
                        byte[] chunk = new byte[8192]; int size;
                        while ((size = stream.read(chunk)) != -1) { if (buffer.size() + size > LibraryStore.MAX_BYTES) throw new Exception("文件超过 8 MiB。"); buffer.write(chunk, 0, size); }
                        bytes = buffer.toByteArray();
                    }
                    if (request == IMPORT_SYNC) resultText = "已导入 " + store.merge(bytes) + " 条电脑资料；未上传手机内容。";
                    else {
                        String value = new String(bytes, StandardCharsets.UTF_8);
                        store.save(null, "手机导入资料", value); resultText = "文本已保存在手机，请打开资料修改标题。";
                    }
                }
                String notice = resultText;
                runOnUiThread(() -> { busy = false; if (!isFinishing() && !isDestroyed()) { showLibrary(); message(notice); } });
            } catch (Exception error) { runOnUiThread(() -> { busy = false; if (!isFinishing() && !isDestroyed()) message(error.getMessage() == null ? "文件操作失败，已有资料保留。" : error.getMessage()); }); }
        });
    }
    @Override public void onBackPressed() { if (busy) { message("文件操作进行中，请稍候。"); } else if (editing) leaveEditor(); else super.onBackPressed(); }
    @Override protected void onPause() {
        if (editing && title != null && body != null) {
            FileOutputStream stream = null;
            try {
                JSONObject draft = new JSONObject().put("id", editingId == null ? "" : editingId)
                    .put("title", title.getText().toString()).put("body", body.getText().toString());
                stream = draftFile.startWrite(); stream.write(draft.toString().getBytes(StandardCharsets.UTF_8)); draftFile.finishWrite(stream);
            } catch (Exception error) { if (stream != null) draftFile.failWrite(stream); }
        }
        super.onPause();
    }
    @Override protected void onDestroy() { io.shutdown(); super.onDestroy(); }
}
