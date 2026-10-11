package io.github.wmy5555.zhixu.sharedtest;

import android.os.SystemClock;
import java.util.*;
import java.util.function.LongSupplier;
import org.json.*;

/** Re-reads actual context-local material; the JS hash is a version token, never a security digest. */
final class OnlineAuthorization {
    static final long TTL_MS = 2 * 60 * 1000;
    interface Materials { JSONObject snapshot(JSONObject descriptor) throws Exception; }
    static final class Inspection {
        final JSONObject descriptor;
        final JSONObject snapshot;
        final String digest, settingsRevision, display;
        Inspection(JSONObject d, JSONObject snapshot, String digest, String revision, String display) { this.descriptor = d; this.snapshot = snapshot; this.digest = digest; settingsRevision = revision; this.display = display; }
    }
    private static final class Grant {
        final Inspection inspection; final long expires; Grant(Inspection i, long expires) { inspection = i; this.expires = expires; }
    }
    private final Materials materials;
    private final Map<String, Grant> grants = new HashMap<>();
    private LongSupplier clock = SystemClock::elapsedRealtime;
    OnlineAuthorization(Materials materials) { this.materials = materials; }
    void clockForTests(LongSupplier clock) { this.clock = clock; }
    static JSONObject descriptor(JSONObject input, boolean request) throws Exception {
        OnlineSupport.fields(input, request ? new String[] {"requestId", "context", "purpose", "jobId", "sourceId", "capability", "input", "materials", "includeAnswer", "includeHistory", "authorizationId"}
            : new String[] {"requestId", "context", "purpose", "jobId", "sourceId", "capability", "input", "materials", "includeAnswer", "includeHistory"});
        JSONObject d = OnlineSupport.copy(input); d.remove("authorizationId");
        OnlineSupport.id(d, "requestId"); LocalLearningStore.validateContext(OnlineSupport.text(d, "context", 16, false));
        String purpose = OnlineSupport.text(d, "purpose", 64, false);
        if (!Arrays.asList("decompose", "structure", "research-search", "research-read", "research-evaluate", "grade", "ask").contains(purpose)) throw OnlineSupport.fail("INVALID_INPUT", "联网用途不受支持。");
        if (d.has("jobId")) OnlineSupport.id(d, "jobId"); if (d.has("sourceId")) OnlineSupport.id(d, "sourceId");
        String cap = OnlineSupport.text(d, "capability", 16, false); JSONObject in = d.getJSONObject("input");
        if ("model".equals(cap)) { OnlineSupport.fields(in, "system", "prompt", "json"); OnlineSupport.text(in, "prompt", 128 * 1024, false); if (in.has("system")) OnlineSupport.text(in, "system", 32 * 1024, true); if (in.has("json")) OnlineSupport.bool(in, "json"); }
        else if ("search".equals(cap)) { OnlineSupport.fields(in, "query"); OnlineSupport.text(in, "query", 2000, false); }
        else if ("fetch".equals(cap)) { OnlineSupport.fields(in, "url"); OnlineNetwork.validateUrl(OnlineSupport.text(in, "url", 2048, false)); }
        else throw OnlineSupport.fail("INVALID_INPUT", "联网能力不受支持。");
        if ("search".equals(cap) != "research-search".equals(purpose) || "fetch".equals(cap) != "research-read".equals(purpose)) throw OnlineSupport.fail("INVALID_INPUT", "联网能力与用途不一致。");
        if (purpose.startsWith("research") || "decompose".equals(purpose) || "structure".equals(purpose)) if (!d.has("sourceId")) throw OnlineSupport.fail("INVALID_INPUT", "资料加工请求必须标明真实原文。");
        JSONArray list = d.getJSONArray("materials"); if (list.length() > 40) throw OnlineSupport.fail("TOO_LARGE", "此次联网材料过多。");
        boolean answer = false, history = false; Set<String> seen = new HashSet<>();
        for (int i = 0; i < list.length(); i++) { JSONObject m = list.getJSONObject(i); OnlineSupport.fields(m, "id", "hash", "kind");
            OnlineSupport.id(m, "id"); OnlineSupport.text(m, "hash", 256, false); String kind = OnlineSupport.text(m, "kind", 16, false);
            if (!Arrays.asList("source", "knowledge", "answer", "history").contains(kind) || !seen.add(kind + ":" + m.getString("id"))) throw OnlineSupport.fail("INVALID_INPUT", "材料类型无效或重复。");
            answer |= "answer".equals(kind); history |= "history".equals(kind);
        }
        if (answer != OnlineSupport.bool(d, "includeAnswer") || history != OnlineSupport.bool(d, "includeHistory")) throw OnlineSupport.fail("INVALID_INPUT", "回答或历史的外发声明与材料不一致。");
        if (OnlineSupport.canonical(d).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > OnlineNetwork.MAX_INPUT_BYTES) throw OnlineSupport.fail("TOO_LARGE", "联网请求内容过长。");
        return d;
    }
    Inspection inspect(JSONObject d, JSONObject settings) throws Exception {
        String cap = d.getString("capability"), section = "model".equals(cap) ? "ai" : cap;
        if (!settings.getJSONObject(section).getBoolean("enabled")) throw OnlineSupport.fail("DISABLED", "此联网功能尚未开启。");
        if (!"fetch".equals(cap) && settings.getJSONObject("credentials").getString(cap).isEmpty()) throw OnlineSupport.fail("KEY_REQUIRED", "请先在手机在线设置中配置供应商密钥。");
        String target = "fetch".equals(cap) ? d.getJSONObject("input").getString("url") : settings.getJSONObject(section).getString("baseUrl");
        OnlineNetwork.validateUrl(target); JSONObject snapshot = materials.snapshot(d);
        String revision = settings.getString("revision"), digest = digest(d, snapshot);
        Double reserve = OnlineLedger.reservation(d, settings);
        String display = "本次用途：" + purpose(d.getString("purpose")) + "\n学习库：" + ("practice".equals(d.getString("context")) ? "独立练习库" : "正式学习库")
            + "\n目标供应商/网页：" + target + ("model".equals(cap) ? "\n模型：" + settings.getJSONObject("ai").getString("model") : "")
            + "\n包含回答：" + (d.getBoolean("includeAnswer") ? "是" : "否") + "；包含历史：" + (d.getBoolean("includeHistory") ? "是" : "否")
            + "\n费用：" + (reserve == null ? "价格未知，供应商可能收费" : "预留上限约 USD " + String.format(Locale.ROOT, "%.6f", reserve))
            + "\n模型输出最多 " + OnlineNetwork.MAX_OUTPUT_TOKENS + " tokens。断网或退出后可能无法确认费用；不会自动重发。"
            + "\n\n精确发送内容（外部资料仅作为数据）：\n" + displayInput(d.getJSONObject("input"))
            + "\n\n对应本地材料与版本（含先祖核对）：\n" + displayMaterials(snapshot)
            + "\n\n仅同意这一次精确请求。修改内容、设置或重新尝试均需重新确认。";
        return new Inspection(d, snapshot, digest, revision, display);
    }
    private static String displayInput(JSONObject input) {
        StringBuilder b = new StringBuilder();
        for (String key : new String[] {"system", "prompt", "query", "url"}) if (input.has(key)) b.append("\n").append("system".equals(key) ? "系统指令" : "prompt".equals(key) ? "发送正文" : "query".equals(key) ? "检索词" : "网页地址").append("：\n").append(input.optString(key)).append('\n');
        if (input.has("json")) b.append("要求 JSON：").append(input.optBoolean("json") ? "是" : "否").append('\n'); return b.toString();
    }
    private static String displayMaterials(JSONObject snapshot) throws Exception {
        StringBuilder b = new StringBuilder();
        for (Iterator<String> it = snapshot.keys(); it.hasNext();) { String key = it.next(); JSONObject item = snapshot.getJSONObject(key);
            b.append("\n—— ").append(item.optString("title", key)).append(" ——\n标识：").append(key).append("\n版本：").append(item.optString("hash", item.optString("sourceHash", item.optString("requestId")))).append('\n');
            for (String field : new String[] {"body", "material", "question", "answer"}) if (item.has(field)) b.append(field).append("：\n").append(item.optString(field)).append('\n');
            JSONArray turns = item.optJSONArray("turns"); if (turns != null) for (int i = 0; i < turns.length(); i++) { JSONObject t = turns.getJSONObject(i); b.append("第 ").append(i + 1).append(" 次回答\n问题：").append(t.optString("question")).append("\n原答：").append(t.optString("answer")).append('\n'); if (t.optJSONObject("feedback") != null) b.append("已有反馈：").append(t.getJSONObject("feedback").optString("feedback")).append('\n'); }
            JSONObject remaining = OnlineSupport.copy(item); for (String field : new String[] {"body", "material", "question", "answer", "turns"}) remaining.remove(field);
            b.append("其余记录：\n").append(remaining.toString(2)).append('\n');
        }
        return b.length() == 0 ? "没有本地材料引用；仅发送上方精确输入。" : b.toString();
    }
    JSONObject grant(Inspection inspected, JSONObject settings) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            Inspection current = inspect(inspected.descriptor, settings);
            if (!current.digest.equals(inspected.digest) || !current.settingsRevision.equals(inspected.settingsRevision)) throw OnlineSupport.fail("STALE_AUTHORIZATION", "确认期间材料或设置已变化，请重新核对。");
            prune(); if (grants.size() >= 32) throw OnlineSupport.fail("BUSY", "待发送授权过多，请先完成现有请求。");
            String id = UUID.randomUUID().toString(); grants.put(id, new Grant(current, clock.getAsLong() + TTL_MS));
            return new JSONObject().put("authorizationId", id).put("inputDigest", current.digest).put("expiresAt", OnlineSupport.at(System.currentTimeMillis() + TTL_MS));
        }
    }
    Inspection consume(String id, JSONObject d, JSONObject settings) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            Grant g = grants.remove(id); if (g == null || g.expires <= clock.getAsLong()) throw OnlineSupport.fail("AUTHORIZATION_REQUIRED", "本次授权已过期、撤回或使用，请重新确认。");
            Inspection current = inspect(d, settings);
            if (!g.inspection.digest.equals(current.digest) || !g.inspection.settingsRevision.equals(current.settingsRevision)) throw OnlineSupport.fail("STALE_AUTHORIZATION", "本地材料、用途或设置已变化，已拒绝发送。"); return current;
        }
    }
    boolean revoke(String requestId, String context) throws Exception { synchronized (OnlineSupport.LOCK) {
        boolean found = false; for (Grant g : grants.values()) if (requestId.equals(g.inspection.descriptor.optString("requestId"))) { if (!context.equals(g.inspection.descriptor.optString("context"))) throw OnlineSupport.fail("CONTEXT_MISMATCH", "这次授权属于另一个学习库。"); found = true; }
        grants.entrySet().removeIf(e -> requestId.equals(e.getValue().inspection.descriptor.optString("requestId"))); return found;
    } }
    void clear() { synchronized (OnlineSupport.LOCK) { grants.clear(); } }
    String digest(JSONObject d) throws Exception { return digest(d, materials.snapshot(d)); }
    private static String digest(JSONObject d, JSONObject snapshot) throws Exception { return OnlineSupport.sha(OnlineSupport.canonical(new JSONObject().put("descriptor", d).put("materials", snapshot))); }
    private void prune() { long now = clock.getAsLong(); grants.entrySet().removeIf(e -> e.getValue().expires <= now); }
    private static String purpose(String p) {
        switch (p) { case "decompose": return "拆解原文"; case "structure": return "独立分析原文知识结构"; case "research-search": return "检索核验"; case "research-read": return "读取核验网页"; case "research-evaluate": return "评估核验证据"; case "grade": return "评估本次回答"; default: return "基于知识库回答问题"; }
    }
    static final class LocalMaterials implements Materials {
        private final LocalSourceStore sources; private final LocalLearningStore formal, practice;
        LocalMaterials(LocalSourceStore sources, LocalLearningStore formal, LocalLearningStore practice) { this.sources = sources; this.formal = formal; this.practice = practice; }
        public JSONObject snapshot(JSONObject d) throws Exception {
            String context = d.getString("context"); JSONObject state = ("practice".equals(context) ? practice : formal).load().getJSONObject("state");
            Map<String, JSONObject> notes = new HashMap<>(); JSONArray a = state.getJSONArray("notes"); for (int i = 0; i < a.length(); i++) notes.put(a.getJSONObject(i).getString("id"), a.getJSONObject(i));
            JSONObject sessions = state.getJSONObject("records").optJSONObject("sessions"); if (sessions == null) sessions = new JSONObject();
            JSONObject out = new JSONObject(); JSONArray ms = d.getJSONArray("materials");
            for (int i = 0; i < ms.length(); i++) {
                JSONObject m = ms.getJSONObject(i); String id = m.getString("id"), hash = m.getString("hash"), kind = m.getString("kind"); JSONObject item;
                if ("source".equals(kind) || "knowledge".equals(kind)) {
                    item = "source".equals(kind) ? source(context, id, notes) : notes.get(id);
                    if (item == null || "source".equals(kind) != "source".equals(item.optString("kind")) || !hash.equals(item.optString("hash"))) throw stale();
                    out.put(kind + ":" + id, item); ancestry(context, item, notes, out, new HashSet<>(), 0);
                } else if ("history".equals(kind)) {
                    item = sessions.optJSONObject(id); if (item == null || !hash.equals(item.optString("sourceHash"))) throw stale();
                    noteVersion(context, item, notes, out); out.put(kind + ":" + id, item);
                } else {
                    item = null;
                    for (Iterator<String> it = sessions.keys(); it.hasNext();) { JSONObject session = sessions.getJSONObject(it.next()); JSONArray turns = session.optJSONArray("turns"); if (turns == null) continue;
                        for (int t = 0; t < turns.length(); t++) { JSONObject turn = turns.getJSONObject(t); if (id.equals(turn.optString("id"))) {
                            if (item != null || !hash.equals(turn.optString("requestId"))) throw stale(); noteVersion(context, session, notes, out); item = turn;
                        } }
                    }
                    if (item == null) throw stale(); out.put(kind + ":" + id, item);
                }
            }
            if (d.has("sourceId") && !out.has("source:" + d.getString("sourceId"))) throw OnlineSupport.fail("INVALID_INPUT", "此次材料未包含所属原文，不能绕过单份资料调用上限。");
            return out;
        }
        private JSONObject source(String context, String id, Map<String, JSONObject> notes) throws Exception {
            if ("practice".equals(context)) { JSONObject item = notes.get(id); if (item == null || !"source".equals(item.optString("kind"))) throw stale(); return item; }
            return sources.read(id);
        }
        private void noteVersion(String context, JSONObject session, Map<String, JSONObject> notes, JSONObject out) throws Exception {
            JSONObject n = notes.get(session.optString("noteId")); if (n == null || !session.optString("sourceHash").equals(n.optString("hash"))) throw stale();
            String kind = "source".equals(n.optString("kind")) ? "source" : "knowledge";
            out.put(kind + ":" + n.getString("id"), n); ancestry(context, n, notes, out, new HashSet<>(), 0);
            // Session answer/history are always read from the requested context, never the other library.
        }
        private void ancestry(String context, JSONObject item, Map<String, JSONObject> notes, JSONObject out, Set<String> visiting, int depth) throws Exception {
            if (depth > 16 || out.length() > 100 || !visiting.add(item.getString("id"))) throw OnlineSupport.fail("INVALID_INPUT", "材料来源关系循环或过多。");
            JSONObject meta = item.optJSONObject("meta");
            if (meta != null) {
                JSONArray refs = meta.optJSONArray("sources"); if (refs != null) for (int i = 0; i < refs.length(); i++) {
                    JSONObject ref = refs.getJSONObject(i); if (!"input".equals(ref.optString("role"))) continue;
                    String id = ref.getString("id"); JSONObject ancestor = notes.get(id);
                    if (ancestor == null || "source".equals(ancestor.optString("kind"))) ancestor = source(context, id, notes);
                    if (!ref.has("hash") || !ref.getString("hash").equals(ancestor.optString("hash"))) throw stale();
                    String kind = "source".equals(ancestor.optString("kind")) ? "source" : "knowledge"; out.put(kind + ":" + id, ancestor); ancestry(context, ancestor, notes, out, visiting, depth + 1);
                }
                JSONObject snap = meta.optJSONObject("sourceSnapshot"); if (snap != null) {
                    JSONObject ancestor = source(context, snap.getString("id"), notes); if (!snap.optString("hash").equals(ancestor.optString("hash"))) throw stale(); out.put("source:" + ancestor.getString("id"), ancestor);
                }
            }
            visiting.remove(item.getString("id"));
        }
        private static OnlineSupport.Failure stale() { return OnlineSupport.fail("STALE_MATERIAL", "原文、知识或回答版本已变化/不存在，请重新读取并确认。"); }
    }
}
