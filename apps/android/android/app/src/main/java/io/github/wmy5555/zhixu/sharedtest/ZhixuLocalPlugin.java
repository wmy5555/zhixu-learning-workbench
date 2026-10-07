package io.github.wmy5555.zhixu.sharedtest;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import org.json.JSONObject;

/** Offline local sources and user-selected SAF documents; no arbitrary path/URI entry points. */
@CapacitorPlugin(name = "ZhixuLocal")
public class ZhixuLocalPlugin extends Plugin {
    private final ExecutorService serial = Executors.newSingleThreadExecutor();
    private final Object stateLock = new Object();
    private LocalSourceStore store;
    private PendingDocument pending;
    private boolean destroyed;
    private String abandonedCreateCallId;

    private static final class PendingDocument {
        final PluginCall call;
        final String kind;
        byte[] bytes;
        String name;
        boolean resultReceived;
        PendingDocument(PluginCall call, String kind) { this.call = call; this.kind = kind; }
        boolean writing() { return kind.startsWith("export"); }
    }

    @PluginMethod public void list(PluginCall call) {
        execute(call, () -> {
            onlyFields(call, "q");
            Object query = call.getData().opt("q");
            if (query != null && !(query instanceof String)) throw invalid();
            return new JSObject().put("notes", getStore().list((String) query));
        });
    }

    @PluginMethod public void read(PluginCall call) {
        execute(call, () -> {
            onlyFields(call, "id");
            return new JSObject().put("note", getStore().read(string(call, "id")));
        });
    }

    @PluginMethod public void save(PluginCall call) {
        execute(call, () -> {
            onlyFields(call, "id", "title", "body", "expectedHash", "meta");
            return new JSObject().put("note", getStore().save(new JSONObject(call.getData().toString())));
        });
    }

    @PluginMethod public void history(PluginCall call) {
        execute(call, () -> {
            onlyFields(call, "id");
            return new JSObject().put("versions", getStore().history(string(call, "id")));
        });
    }

    @PluginMethod public void restoreVersion(PluginCall call) {
        execute(call, () -> {
            onlyFields(call, "id", "versionId", "expectedHash");
            return new JSObject().put("note", getStore().restoreVersion(string(call, "id"),
                string(call, "versionId"), string(call, "expectedHash")));
        });
    }

    @PluginMethod public void restoreBackup(PluginCall call) {
        execute(call, () -> {
            onlyFields(call, "token", "conflictPolicy");
            String policy = string(call, "conflictPolicy");
            if (!"keep-current".equals(policy)) throw invalid();
            return JSObject.fromJSONObject(getStore().restoreBackup(string(call, "token"), policy));
        });
    }

    @PluginMethod public void pickSource(PluginCall call) { beginDocument(call, "pickSource"); }
    @PluginMethod public void previewBackup(PluginCall call) { beginDocument(call, "previewBackup"); }
    @PluginMethod public void exportBackup(PluginCall call) { beginDocument(call, "exportBackup"); }
    @PluginMethod public void exportSource(PluginCall call) { beginDocument(call, "exportSource"); }

    private void beginDocument(PluginCall call, String kind) {
        PendingDocument task = new PendingDocument(call, kind);
        synchronized (stateLock) {
            if (!available(call)) return;
            pending = task;
            try {
                serial.execute(() -> {
                    try {
                        if (!current(task)) return;
                        onlyFields(call, "exportSource".equals(kind) ? new String[] { "id" } : new String[0]);
                        if ("exportBackup".equals(kind)) {
                            task.bytes = getStore().backup().toString().getBytes(StandardCharsets.UTF_8);
                            if (task.bytes.length > SourceDocumentFiles.MAX_BACKUP_BYTES) {
                                throw new LocalSourceStore.StoreException("FILE_TOO_LARGE", "手机备份超过允许的大小。");
                            }
                            task.name = "zhixu-android-backup-" + new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date()) + ".json";
                        } else if ("exportSource".equals(kind)) {
                            task.bytes = SourceDocumentFiles.sourceExchange(getStore().read(string(call, "id")));
                            task.name = "zhixu-source.md";
                        }
                        Intent intent = new Intent(task.writing() ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType(kind.endsWith("Backup") ? "application/json" : task.writing() ? "text/markdown" : "*/*");
                        if (task.writing()) intent.putExtra(Intent.EXTRA_TITLE, task.name);
                        else intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
                        getActivity().runOnUiThread(() -> {
                            synchronized (stateLock) {
                                if (!current(task)) { task.bytes = null; return; }
                                try { startActivityForResult(call, intent, "documentResult"); }
                                catch (Exception exception) { fail(task, "无法打开系统文件选择器，请重试。", "FILE_ERROR"); }
                            }
                        });
                    } catch (LocalSourceStore.StoreException exception) { fail(task, exception.getMessage(), exception.code); }
                    catch (Exception exception) { fail(task, "无法准备文件，请保留输入后重试。", "FILE_ERROR"); }
                });
            } catch (RejectedExecutionException exception) { fail(task, "应用正在关闭，请重新打开后重试。", "UNAVAILABLE"); }
        }
    }

    @ActivityCallback
    private void documentResult(PluginCall call, ActivityResult result) {
        PendingDocument task;
        synchronized (stateLock) {
            task = pending;
            if (task == null) {
                if (call != null && call.getCallbackId().equals(abandonedCreateCallId)) {
                    abandonedCreateCallId = null;
                    if (result.getResultCode() == Activity.RESULT_OK) {
                        try { deleteCreatedDocument(SourceDocumentFiles.selectedDocument(result.getData())); }
                        catch (Exception ignored) {}
                    }
                }
                if (call != null) { call.reject("文件操作已结束，请重新选择文件。", "UNAVAILABLE"); call.release(bridge); }
                return;
            }
            if (call == null) { fail(task, "文件操作已中断，请重新选择文件。", "UNAVAILABLE"); return; }
            if (!task.call.getCallbackId().equals(call.getCallbackId())) {
                call.reject("文件操作已结束，请重新选择文件。", "UNAVAILABLE"); call.release(bridge); return;
            }
            // A provider must not cause two queued writes or delete a successfully exported document.
            if (task.resultReceived) return;
            task.resultReceived = true;
        }
        if (result.getResultCode() != Activity.RESULT_OK) { fail(task, "已取消文件操作。", "CANCELLED"); return; }
        Uri uri;
        try { uri = SourceDocumentFiles.selectedDocument(result.getData()); }
        catch (LocalSourceStore.StoreException exception) { fail(task, exception.getMessage(), exception.code); return; }
        try { serial.execute(() -> completeDocument(task, uri)); }
        catch (RejectedExecutionException exception) {
            if (task.writing()) deleteCreatedDocument(uri);
            fail(task, task.writing() ? incompleteMessage() : "应用正在关闭，请重新打开后重试。", "UNAVAILABLE");
        }
    }

    private void deleteCreatedDocument(Uri uri) {
        try { DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); }
        catch (Exception exception) { debugFailure("cleanup", exception); }
    }

    private void completeDocument(PendingDocument task, Uri uri) {
        ContentResolver resolver = null;
        boolean written = false;
        String stage = "resolver";
        try {
            if (!current(task)) return;
            resolver = getContext().getContentResolver();
            stage = "metadata";
            String name = displayName(resolver, uri);
            JSObject response;
            if (task.writing()) {
                stage = "name";
                SourceDocumentFiles.validateName(name, "exportBackup".equals(task.kind));
                byte[] bytes = task.bytes;
                final ContentResolver targetResolver = resolver;
                stage = "export";
                SourceDocumentFiles.writeDocument(() -> targetResolver.openOutputStream(uri, "wt"), bytes, () -> current(task));
                response = new JSObject().put("saved", true).put("name", name);
            } else {
                boolean backup = "previewBackup".equals(task.kind);
                SourceDocumentFiles.validateName(name, backup);
                String text;
                try (InputStream input = resolver.openInputStream(uri)) {
                    text = SourceDocumentFiles.readUtf8(input, backup ? SourceDocumentFiles.MAX_BACKUP_BYTES : SourceDocumentFiles.MAX_SOURCE_BYTES);
                }
                if (!current(task)) return;
                response = backup ? JSObject.fromJSONObject(getStore().previewRestore(new JSONObject(text)))
                    : new JSObject().put("name", name).put("text", text);
            }
            stage = "response";
            synchronized (stateLock) {
                if (current(task)) {
                    task.call.resolve(response);
                    written = task.writing();
                    clear(task);
                }
            }
        } catch (LocalSourceStore.StoreException exception) {
            debugFailure(stage, exception);
            fail(task, task.writing() ? incompleteMessage() : exception.getMessage(), task.writing() ? "FILE_ERROR" : exception.code);
        } catch (Exception exception) {
            debugFailure(stage, exception);
            fail(task, task.writing() ? incompleteMessage() : "无法读取所选文件，请确认文件格式并重试。", "FILE_ERROR");
        } finally {
            task.bytes = null;
            if (task.writing() && !written && resolver != null) {
                // Providers may reject deletion; never claim an incomplete document is a valid backup.
                try { DocumentsContract.deleteDocument(resolver, uri); }
                catch (Exception exception) { debugFailure("cleanup", exception); }
            }
        }
    }

    private void debugFailure(String stage, Exception exception) {
        if ((getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            Log.w("ZhixuSaf", SourceDocumentFiles.failureDiagnostic(stage, exception));
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri) throws Exception {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst() || cursor.isNull(0)) throw new java.io.IOException("Missing document name");
            return cursor.getString(0);
        }
    }

    private static String incompleteMessage() { return "文件未保存完成，可能不完整，不能用于恢复；请删除该文件后重新导出。"; }

    private boolean current(PendingDocument task) {
        synchronized (stateLock) { return !destroyed && pending == task; }
    }

    private void fail(PendingDocument task, String message, String code) {
        synchronized (stateLock) {
            if (pending != task) { task.bytes = null; return; }
            task.call.reject(message, code);
            clear(task);
        }
    }

    private void clear(PendingDocument task) {
        task.bytes = null;
        pending = null;
        task.call.release(bridge);
    }

    private LocalSourceStore getStore() throws LocalSourceStore.StoreException {
        if (store == null) store = new LocalSourceStore(getContext().getApplicationContext());
        return store;
    }

    private interface Operation { JSObject run() throws Exception; }

    private boolean available(PluginCall call) {
        if (destroyed) { call.reject("应用正在关闭，请重新打开后重试。", "UNAVAILABLE"); return false; }
        if (pending != null) { call.reject("请先完成或取消当前文件操作。", "BUSY"); return false; }
        return true;
    }

    private void execute(PluginCall call, Operation operation) {
        synchronized (stateLock) {
            if (!available(call)) return;
            try {
                serial.execute(() -> {
                    try {
                        synchronized (stateLock) { if (destroyed) { call.reject("应用已关闭，请重新打开。", "UNAVAILABLE"); return; } }
                        call.resolve(operation.run());
                    } catch (LocalSourceStore.StoreException exception) { call.reject(exception.getMessage(), exception.code); }
                    catch (Exception exception) { call.reject("手机本地操作未完成，请保留输入后重试。", "STORE_ERROR"); }
                });
            } catch (RejectedExecutionException exception) { call.reject("应用正在关闭，请重新打开后重试。", "UNAVAILABLE"); }
        }
    }

    private static void onlyFields(PluginCall call, String... allowed) throws LocalSourceStore.StoreException {
        for (Iterator<String> keys = call.getData().keys(); keys.hasNext();) {
            if (!Arrays.asList(allowed).contains(keys.next())) throw invalid();
        }
    }

    private static String string(PluginCall call, String field) throws LocalSourceStore.StoreException {
        Object value = call.getData().opt(field);
        if (!(value instanceof String)) throw invalid();
        return (String) value;
    }

    private static LocalSourceStore.StoreException invalid() {
        return new LocalSourceStore.StoreException("VALIDATION", "请求包含样机不支持的字段或格式。");
    }

    @Override protected void handleOnDestroy() {
        synchronized (stateLock) {
            destroyed = true;
            if (pending != null) {
                if (pending.writing() && !pending.resultReceived) abandonedCreateCallId = pending.call.getCallbackId();
                fail(pending, pending.writing() ? incompleteMessage() : "文件操作已中断，请重新选择文件。", "UNAVAILABLE");
            }
            try { serial.execute(() -> { if (store != null) store.close(); }); } catch (RejectedExecutionException ignored) {}
            serial.shutdown();
        }
    }
}
