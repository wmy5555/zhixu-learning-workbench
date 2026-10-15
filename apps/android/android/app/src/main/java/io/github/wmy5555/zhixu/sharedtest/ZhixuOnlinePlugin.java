package io.github.wmy5555.zhixu.sharedtest;

import android.app.AlertDialog;
import android.widget.ScrollView;
import android.widget.TextView;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/** Explicit opt-in online bridge. Every physical request requires a native-readable exact one-shot grant. */
@CapacitorPlugin(name = "ZhixuOnline")
public final class ZhixuOnlinePlugin extends Plugin {
    private final ExecutorService workers = Executors.newFixedThreadPool(3);
    private final AtomicInteger queued = new AtomicInteger();
    private final Object lifecycle = new Object();
    private OnlineEngine engine;
    private LocalSourceStore sources;
    private boolean destroyed;
    private AlertDialog dialog;
    private PluginCall dialogCall;
    private OnlineEngine engine() throws Exception {
        synchronized (OnlineSupport.LOCK) {
            if (engine == null) {
                File root = new File(getContext().getNoBackupFilesDir().getCanonicalFile(), "online-v1"); OnlineSupport.directory(root);
                OnlineSettings settings = new OnlineSettings(root, new OnlineCredentialStore("zhixu.online.settings.v1"));
                sources = new LocalSourceStore(getContext());
                OnlineAuthorization auth = new OnlineAuthorization(new OnlineAuthorization.LocalMaterials(sources, new LocalLearningStore(getContext(), "formal"), new LocalLearningStore(getContext(), "practice")));
                engine = new OnlineEngine(settings, new OnlineLedger(root), auth, new OnlineNetwork.HttpTransport());
            }
            return engine;
        }
    }
    @PluginMethod public void settingsGet(PluginCall call) { execute(call, () -> { OnlineSupport.fields(call.getData()); return engine().settings.get(); }); }
    @PluginMethod public void settingsUpdate(PluginCall call) { execute(call, () -> {
        JSONObject out = engine().settings.update(call.getData()); engine().authorization.clear(); return out;
    }); }
    @PluginMethod public void request(PluginCall call) { execute(call, () -> engine().request(call.getData())); }
    @PluginMethod public void requestStatus(PluginCall call) { execute(call, () -> {
        OnlineSupport.fields(call.getData(), "requestId", "context"); String context = context(call.getData());
        JSONObject out = engine().ledger.lookup(OnlineSupport.id(call.getData(), "requestId"), null, context);
        if (out == null) throw OnlineSupport.fail("NOT_FOUND", "未找到这次联网请求。"); return out;
    }); }
    @PluginMethod public void cancel(PluginCall call) { execute(call, () -> {
        OnlineSupport.fields(call.getData(), "requestId", "context"); return engine().cancel(OnlineSupport.id(call.getData(), "requestId"), context(call.getData()));
    }); }
    @PluginMethod public void usage(PluginCall call) { execute(call, () -> engine().ledger.usage(call.getData(), engine().settings.raw(), System.currentTimeMillis())); }
    @PluginMethod public void authorize(PluginCall call) {
        enqueue(call, () -> {
            OnlineEngine e = engine(); JSONObject descriptor = OnlineAuthorization.descriptor(call.getData(), false);
            OnlineAuthorization.Inspection inspected = e.authorization.inspect(descriptor, e.settings.raw());
            getActivity().runOnUiThread(() -> {
                synchronized (lifecycle) {
                    if (destroyed) { call.reject("应用已关闭，请重新确认。", "UNAVAILABLE"); return; }
                    if (dialog != null) { call.reject("请先完成当前联网确认。", "BUSY"); return; }
                    TextView text = new TextView(getActivity()); text.setText(inspected.display); text.setTextIsSelectable(true);
                    int padding = (int) (16 * getContext().getResources().getDisplayMetrics().density); text.setPadding(padding, padding, padding, padding);
                    ScrollView scroll = new ScrollView(getActivity()); scroll.addView(text); dialogCall = call;
                    dialog = new AlertDialog.Builder(getActivity()).setTitle("确认本次联网与可能费用").setView(scroll)
                        .setNegativeButton("拒绝", (d, which) -> { synchronized (lifecycle) { clearDialog(); } call.reject("已拒绝此次外发，未调用供应商。", "AUTHORIZATION_DENIED"); })
                        .setPositiveButton("仅同意这一次", (d, which) -> { synchronized (lifecycle) { clearDialog(); }
                            execute(call, () -> e.authorization.grant(inspected, e.settings.raw())); })
                        .setOnCancelListener(d -> { synchronized (lifecycle) { clearDialog(); } call.reject("此次确认已取消，未调用供应商。", "AUTHORIZATION_DENIED"); }).create();
                    dialog.setCanceledOnTouchOutside(false); dialog.show();
                }
            });
        });
    }
    private static String context(JSONObject o) throws Exception { String c = OnlineSupport.text(o, "context", 16, false); LocalLearningStore.validateContext(c); return c; }
    private void clearDialog() { dialog = null; dialogCall = null; }
    interface Action { JSONObject run() throws Exception; }
    interface Task { void run() throws Exception; }
    private void execute(PluginCall call, Action action) { enqueue(call, () -> { JSONObject result = action.run(); call.resolve(JSObject.fromJSONObject(result)); }); }
    private void enqueue(PluginCall call, Task action) {
        synchronized (lifecycle) {
            if (destroyed) { call.reject("应用正在关闭，请重新打开。", "UNAVAILABLE"); return; }
            if (call.getData().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 256 * 1024) { call.reject("请求过长。", "TOO_LARGE"); return; }
            if (queued.incrementAndGet() > 32) { queued.decrementAndGet(); call.reject("待处理联网请求过多，请稍后重试。", "BUSY"); return; }
            try { workers.execute(() -> {
                try {
                    synchronized (lifecycle) { if (destroyed) throw OnlineSupport.fail("UNAVAILABLE", "应用已关闭，请重新打开。"); }
                    action.run();
                } catch (OnlineSupport.Failure e) { call.reject(e.getMessage(), e.code); }
                catch (LocalSourceStore.StoreException e) { call.reject("本地材料读取未完成，未授权外发；请保留资料后重试。", e.code); }
                catch (Exception e) { call.reject("手机联网操作未完成，请检查设置并查询原请求；不要自动重发。", "ONLINE_ERROR"); }
                finally { queued.decrementAndGet(); }
            }); } catch (RejectedExecutionException e) { queued.decrementAndGet(); call.reject("应用正在关闭，请重新打开。", "UNAVAILABLE"); }
        }
    }
    @Override protected void handleOnDestroy() {
        synchronized (lifecycle) {
            destroyed = true; if (dialog != null) { dialog.dismiss(); if (dialogCall != null) dialogCall.reject("应用已关闭，此次确认已撤回。", "AUTHORIZATION_DENIED"); clearDialog(); }
        }
        synchronized (OnlineSupport.LOCK) { if (engine != null) engine.close(); }
        workers.shutdown(); // In-flight workers durably settle unknown; do not discard their accounting tasks.
        super.handleOnDestroy();
    }
}
