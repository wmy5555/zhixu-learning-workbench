package io.github.wmy5555.zhixu.sharedtest;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import org.json.JSONObject;

/** No network, credentials, external paths, import, deletion or learning promotion entry points. */
@CapacitorPlugin(name = "ZhixuLocal")
public class ZhixuLocalPlugin extends Plugin {
    private final ExecutorService serial = Executors.newSingleThreadExecutor();
    private LocalSourceStore store;

    @PluginMethod public void list(PluginCall call) {
        execute(call, () -> {
            onlyField(call, "q");
            Object query = call.getData().opt("q");
            if (query != null && !(query instanceof String)) throw invalid();
            return new JSObject().put("notes", getStore().list((String) query));
        });
    }

    @PluginMethod public void read(PluginCall call) {
        execute(call, () -> {
            onlyField(call, "id");
            Object id = call.getData().opt("id");
            if (!(id instanceof String)) throw invalid();
            return new JSObject().put("note", getStore().read((String) id));
        });
    }

    @PluginMethod public void save(PluginCall call) {
        execute(call, () -> new JSObject().put("note", getStore().save(new JSONObject(call.getData().toString()))));
    }

    private LocalSourceStore getStore() throws LocalSourceStore.StoreException {
        if (store == null) store = new LocalSourceStore(getContext().getApplicationContext());
        return store;
    }

    private interface Operation { JSObject run() throws Exception; }

    private void execute(PluginCall call, Operation operation) {
        try {
            serial.execute(() -> {
                try {
                    call.resolve(operation.run());
                } catch (LocalSourceStore.StoreException exception) {
                    call.reject(exception.getMessage(), exception.code);
                } catch (Exception exception) {
                    // Never forward private file paths, source text or platform stack traces to the WebView.
                    call.reject("手机本地操作未完成，请保留输入后重试。", "STORE_ERROR");
                }
            });
        } catch (RejectedExecutionException exception) {
            call.reject("应用正在关闭，请重新打开后重试。", "UNAVAILABLE");
        }
    }

    private static void onlyField(PluginCall call, String allowed) throws LocalSourceStore.StoreException {
        for (Iterator<String> keys = call.getData().keys(); keys.hasNext();) {
            if (!allowed.equals(keys.next())) throw invalid();
        }
    }

    private static LocalSourceStore.StoreException invalid() {
        return new LocalSourceStore.StoreException("VALIDATION", "请求包含样机不支持的字段或格式。");
    }

    @Override protected void handleOnDestroy() {
        // Finish already queued local saves before releasing the database.
        serial.execute(() -> { if (store != null) store.close(); });
        serial.shutdown();
    }
}
