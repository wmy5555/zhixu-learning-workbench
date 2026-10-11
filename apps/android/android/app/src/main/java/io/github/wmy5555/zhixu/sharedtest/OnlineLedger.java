package io.github.wmy5555.zhixu.sharedtest;

import java.io.File;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Durable request identities, outcomes and conservative budget reservations. Never stores secrets or request bodies. */
final class OnlineLedger {
    static final int MAX_CALLS = 2000;
    private final File file;
    private JSONObject entries;
    private boolean poisoned;
    OnlineLedger(File root) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            OnlineSupport.directory(root); file = OnlineSupport.child(root, "requests.json");
            if (file.exists() || new File(file + ".bak").exists()) {
                JSONObject data = new JSONObject(new String(OnlineSupport.read(file, 32 * 1024 * 1024), StandardCharsets.UTF_8));
                if (data.optInt("version") != 1 || data.optJSONObject("entries") == null) throw OnlineSupport.fail("STORE_ERROR", "联网账本损坏，已停止新调用。");
                entries = data.getJSONObject("entries");
            } else entries = new JSONObject();
            boolean recovered = false;
            for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) {
                String id = it.next(); JSONObject e = entries.getJSONObject(id); String state = e.getString("state");
                if (!id.equals(e.getString("requestId")) || !e.getString("digest").matches("[0-9a-f]{64}") || !java.util.Arrays.asList("pending", "sent", "succeeded", "failed", "unknown").contains(state)) throw OnlineSupport.fail("STORE_ERROR", "联网账本损坏，已停止新调用。");
                if ("sent".equals(state)) { finishInternal(e, "unknown", null, unknownUsage(), "INTERRUPTED", "应用退出前可能已发送；结果和费用未知，不会自动重发。"); recovered = true; }
                else if ("pending".equals(state)) { finishInternal(e, "failed", null, zeroUsage(), "NOT_SENT", "应用退出前未进入发送阶段，此次未发送。"); recovered = true; }
            }
            if (recovered) save();
        }
    }
    private void healthy() throws Exception { if (poisoned) throw OnlineSupport.fail("STORE_ERROR", "联网账本写入未确认，请重新打开并查询原请求；已停止新发送。"); }
    private void save() throws Exception { healthy(); try { byte[] bytes = new JSONObject().put("version", 1).put("entries", entries).toString().getBytes(StandardCharsets.UTF_8); if (bytes.length > 32 * 1024 * 1024) throw OnlineSupport.fail("LEDGER_FULL", "联网账本空间不足，请停止新调用并保留原请求记录。"); OnlineSupport.write(file, bytes); } catch (Exception e) { poisoned = true; throw e; } }
    JSONObject lookup(String id, String digest, String context) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            healthy();
            JSONObject e = entries.optJSONObject(id); if (e == null) return null;
            if (!context.equals(e.getString("context"))) throw OnlineSupport.fail("CONTEXT_MISMATCH", "这次请求属于另一个学习库，不能读取或重发。");
            if (digest != null && !digest.equals(e.getString("digest"))) throw OnlineSupport.fail("CONFLICT", "同一请求标识对应不同内容，已拒绝重发。");
            return status(e);
        }
    }
    private static Double price(JSONObject o, String key) { Object n = o.opt(key); return n instanceof Number && Double.isFinite(((Number)n).doubleValue()) && ((Number)n).doubleValue() >= 0 ? ((Number)n).doubleValue() : null; }
    static int inputTokenBound(JSONObject d, JSONObject settings) throws Exception {
        // UTF-8 byte bound plus message framing and provider bookkeeping margin; no tokenizer estimate is treated as actual usage.
        int bytes = OnlineNetwork.modelBody(d, settings).toString().getBytes(StandardCharsets.UTF_8).length;
        return bytes * 2 + 4096;
    }
    static Double reservation(JSONObject d, JSONObject settings) throws Exception {
        String cap = d.getString("capability"); if ("fetch".equals(cap)) return 0.0;
        if ("search".equals(cap)) return price(settings.getJSONObject("search"), "requestPrice");
        JSONObject ai = settings.getJSONObject("ai"); Double in = price(ai, "inputPrice"), out = price(ai, "outputPrice"), cached = price(ai, "cachedInputPrice");
        if (in == null || out == null || cached == null) return null;
        return (inputTokenBound(d, settings) * Math.max(in, cached) + OnlineNetwork.MAX_OUTPUT_TOKENS * out) / 1000000.0;
    }
    void reserve(JSONObject d, String digest, JSONObject settings, long now) throws Exception {
        JSONArray sourceIds = new JSONArray(); JSONArray materials = d.getJSONArray("materials"); for (int i = 0; i < materials.length(); i++) { JSONObject m = materials.getJSONObject(i); if ("source".equals(m.optString("kind"))) sourceIds.put(m.getString("id")); }
        reserve(d, digest, settings, now, sourceIds);
    }
    void reserve(JSONObject d, String digest, JSONObject settings, long now, JSONArray sourceIds) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            healthy();
            String id = d.getString("requestId"); if (entries.has(id)) throw OnlineSupport.fail("CONFLICT", "请求已存在，请查询结果。");
            if (entries.length() >= MAX_CALLS || entries.toString().getBytes(StandardCharsets.UTF_8).length > 28 * 1024 * 1024) throw OnlineSupport.fail("LEDGER_FULL", "手机联网账本已达到上限；请保留未知费用记录并停止新调用。");
            JSONObject ai = settings.getJSONObject("ai"); Double budget = price(ai, "monthlyBudget"), reserve = reservation(d, settings);
            JSONObject b = budget(settings, now); int daily = ai.getInt("dailyCallLimit");
            if (b.getInt("callsToday") >= daily) throw OnlineSupport.fail("DAILY_LIMIT", "今天的联网调用已达到上限。");
            if (budget != null && (reserve == null || b.getInt("unknownCostCalls") > 0)) throw OnlineSupport.fail("UNKNOWN_COST", "月预算已启用，但价格或既有费用未知；请先核对账单与价格。");
            if (budget != null && b.getDouble("knownCostMonth") + reservedMonth(now) + reserve > budget + 1e-12) throw OnlineSupport.fail("MONTHLY_BUDGET", "此次调用的费用预留会超过月预算。");
            for (int s = 0; s < sourceIds.length(); s++) {
                String sourceId = sourceIds.getString(s);
                int used = 0; for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) { JSONObject e = entries.getJSONObject(it.next());
                    boolean matches = sourceId.equals(e.optString("sourceId")); JSONArray existingSources = e.optJSONArray("sourceIds"); if (existingSources != null) for (int x = 0; x < existingSources.length(); x++) matches |= sourceId.equals(existingSources.optString(x));
                    if (d.getString("context").equals(e.optString("context")) && matches && charged(e)) used++;
                }
                if (used >= ai.getInt("sourceCallLimit")) throw OnlineSupport.fail("SOURCE_LIMIT", "这份资料的联网调用已达到单份资料上限。");
            }
            JSONObject e = new JSONObject().put("id", id).put("requestId", id).put("digest", digest).put("context", d.getString("context"))
                .put("capability", d.getString("capability")).put("sourceId", d.opt("sourceId") == null ? JSONObject.NULL : d.opt("sourceId"))
                .put("jobId", d.opt("jobId") == null ? JSONObject.NULL : d.opt("jobId")).put("sourceIds", sourceIds)
                .put("model", "model".equals(d.getString("capability")) ? ai.getString("model") : JSONObject.NULL)
                .put("at", OnlineSupport.at(now)).put("started", now).put("state", "pending").put("reservation", reserve == null ? JSONObject.NULL : reserve)
                .put("inputTokenBound", "model".equals(d.getString("capability")) ? inputTokenBound(d, settings) : 0).put("usage", unknownUsage());
            entries.put(id, e);
            try { save(); } catch (Exception ex) { entries.remove(id); throw ex; }
        }
    }
    void sent(String id) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            healthy();
            JSONObject e = entries.getJSONObject(id); if (!"pending".equals(e.getString("state"))) throw OnlineSupport.fail("CANCELLED", "请求已取消。");
            e.put("state", "sent"); save(); // No network operation may start unless this fsync completes.
        }
    }
    void finish(String id, String state, JSONObject result, JSONObject usage, String code, String message) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            healthy();
            JSONObject e = entries.getJSONObject(id);
            if (!"pending".equals(e.optString("state")) && !"sent".equals(e.optString("state")) && !("unknown".equals(e.optString("state")) && "succeeded".equals(state))) return;
            if ("sent".equals(e.optString("state")) && "failed".equals(state)) throw OnlineSupport.fail("STORE_ERROR", "已发送请求不能被标为免费失败。");
            finishInternal(e, state, result, usage, code, message); save();
        }
    }
    private static void finishInternal(JSONObject e, String state, JSONObject result, JSONObject usage, String code, String message) throws Exception {
        e.put("state", state).put("usage", usage).put("durationMs", Math.max(0, System.currentTimeMillis() - e.optLong("started"))).put("reservation", JSONObject.NULL);
        if (result != null) { e.put("result", result); e.remove("error"); }
        if (code != null) e.put("error", new JSONObject().put("code", code).put("message", message));
    }
    JSONObject cancel(String id, String context) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            healthy();
            JSONObject e = entries.optJSONObject(id); if (e == null) throw OnlineSupport.fail("NOT_FOUND", "未找到这次联网请求。");
            if (!context.equals(e.getString("context"))) throw OnlineSupport.fail("CONTEXT_MISMATCH", "这次请求属于另一个学习库，不能取消。");
            if ("pending".equals(e.optString("state"))) finish(id, "failed", null, zeroUsage(), "CANCELLED", "发送前已取消，此次未发送。");
            else if ("sent".equals(e.optString("state"))) finish(id, "unknown", null, unknownUsage(), "CANCELLED_AFTER_SEND", "请求可能已经发送，取消不能确认免费；请核对供应商账单。");
            return new JSONObject().put("requestId", id).put("state", status(e).getString("state"));
        }
    }
    static JSONObject unknownUsage() throws Exception { return new JSONObject().put("inputTokens", JSONObject.NULL).put("outputTokens", JSONObject.NULL).put("cachedInputTokens", JSONObject.NULL).put("cost", JSONObject.NULL); }
    static JSONObject zeroUsage() throws Exception { return new JSONObject().put("inputTokens", 0).put("outputTokens", 0).put("cachedInputTokens", 0).put("cost", 0); }
    static JSONObject account(JSONObject d, JSONObject result, JSONObject settings) throws Exception {
        String cap = d.getString("capability"); JSONObject usage = unknownUsage();
        if ("fetch".equals(cap)) return zeroUsage();
        if ("search".equals(cap)) { Double p = price(settings.getJSONObject("search"), "requestPrice"); return usage.put("inputTokens", 0).put("outputTokens", 0).put("cost", p == null ? JSONObject.NULL : p); }
        JSONObject u = result.optJSONObject("usage"); if (u == null) return usage;
        Long in = tokens(u.opt("prompt_tokens")), out = tokens(u.opt("completion_tokens"));
        if (in == null || out == null || in > inputTokenBound(d, settings) || out > OnlineNetwork.MAX_OUTPUT_TOKENS) return usage;
        usage.put("inputTokens", in).put("outputTokens", out);
        Long hit = tokens(u.opt("prompt_cache_hit_tokens"));
        if (hit == null && u.optJSONObject("prompt_tokens_details") != null) hit = tokens(u.getJSONObject("prompt_tokens_details").opt("cached_tokens"));
        if (hit != null && hit <= in) usage.put("cachedInputTokens", hit);
        JSONObject ai = settings.getJSONObject("ai"); Double p = price(ai, "inputPrice"), q = price(ai, "outputPrice"), c = price(ai, "cachedInputPrice");
        if (p == null || q == null || c == null || hit != null && hit > in) return usage;
        // Missing cache breakdown uses the larger input price, clearly a conservative cost estimate.
        if (hit == null && p.doubleValue() != c.doubleValue()) return usage;
        double inputCost = hit == null ? in * p : (in - hit) * p + hit * c;
        return usage.put("cost", (inputCost + out * q) / 1000000.0);
    }
    private static Long tokens(Object n) { if (!(n instanceof Number)) return null; double v = ((Number)n).doubleValue(); return Double.isFinite(v) && v >= 0 && v == Math.rint(v) && v <= 10000000 ? ((Number)n).longValue() : null; }
    private static boolean charged(JSONObject e) { return !"failed".equals(e.optString("state")); }
    private double reservedMonth(long now) throws Exception {
        double total = 0; String month = OnlineSupport.at(now).substring(0, 7);
        for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) { JSONObject e = entries.getJSONObject(it.next()); if (e.getString("at").startsWith(month) && e.opt("reservation") instanceof Number) total += e.getDouble("reservation"); }
        return total;
    }
    JSONObject budget(JSONObject settings, long now) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            healthy();
            int today = 0, unknown = 0; double known = 0; String day = OnlineSupport.at(now).substring(0, 10), month = day.substring(0, 7);
            for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) { JSONObject e = entries.getJSONObject(it.next()); if (!charged(e)) continue;
                if (e.getString("at").startsWith(day)) today++;
                if (!e.getString("at").startsWith(month)) continue;
                Object cost = e.getJSONObject("usage").opt("cost");
                if (cost instanceof Number) known += ((Number)cost).doubleValue();
                else if (!(e.opt("reservation") instanceof Number)) unknown++;
            }
            JSONObject ai = settings.getJSONObject("ai"); return new JSONObject().put("callsToday", today).put("knownCostMonth", known).put("unknownCostCalls", unknown)
                .put("dailyCallLimit", ai.get("dailyCallLimit")).put("monthlyBudget", ai.get("monthlyBudget"));
        }
    }
    JSONObject usage(JSONObject filter, JSONObject settings, long now) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            healthy();
            OnlineSupport.fields(filter, "from", "to", "capability", "context"); String from = filter.optString("from", ""), to = filter.optString("to", ""), cap = filter.optString("capability", ""), context = filter.optString("context", "");
            if (!context.isEmpty()) LocalLearningStore.validateContext(context);
            if (!from.isEmpty() && !from.matches("\\d{4}-\\d{2}-\\d{2}(T.*Z)?") || !to.isEmpty() && !to.matches("\\d{4}-\\d{2}-\\d{2}(T.*Z)?")
                || !cap.isEmpty() && !java.util.Arrays.asList("model", "search", "fetch").contains(cap)) throw OnlineSupport.fail("INVALID_INPUT", "用量筛选格式不正确。");
            JSONArray calls = new JSONArray(); int count = 0, unknown = 0; double cost = 0; long in = 0, out = 0;
            for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) { JSONObject e = entries.getJSONObject(it.next()); String at = e.getString("at");
                if (!context.isEmpty() && !context.equals(e.getString("context"))) continue;
                if (!from.isEmpty() && at.compareTo(from) < 0 || !to.isEmpty() && at.substring(0, Math.min(at.length(), to.length())).compareTo(to) > 0 || !cap.isEmpty() && !cap.equals(e.getString("capability"))) continue;
                JSONObject u = e.getJSONObject("usage"), c = new JSONObject(); for (String k : new String[] {"id", "requestId", "context", "capability", "model", "sourceId", "at"}) c.put(k, e.opt(k));
                c.put("durationMs", e.optLong("durationMs")).put("ok", "succeeded".equals(e.getString("state"))).put("cost", u.get("cost")).put("inputTokens", u.get("inputTokens"))
                    .put("outputTokens", u.get("outputTokens")).put("cachedInputTokens", u.opt("cachedInputTokens") == null ? JSONObject.NULL : u.opt("cachedInputTokens")).put("errorCode", e.optJSONObject("error") == null ? JSONObject.NULL : e.getJSONObject("error").get("code")); calls.put(c); count++;
                if (u.opt("cost") instanceof Number) cost += u.getDouble("cost"); else if (charged(e)) unknown++;
                if (u.opt("inputTokens") instanceof Number) in += u.getLong("inputTokens"); if (u.opt("outputTokens") instanceof Number) out += u.getLong("outputTokens");
            }
            return new JSONObject().put("calls", calls).put("budget", budget(settings, now)).put("totals", new JSONObject().put("calls", count).put("knownCost", cost).put("unknownCostCalls", unknown).put("inputTokens", in).put("outputTokens", out));
        }
    }
    private static JSONObject status(JSONObject e) throws Exception {
        String state = e.getString("state"); boolean busy = "pending".equals(state) || "sent".equals(state);
        JSONObject o = new JSONObject().put("requestId", e.getString("requestId")).put("state", busy ? "unknown" : state).put("usage", e.getJSONObject("usage"));
        if (e.has("result")) o.put("result", e.get("result"));
        if (busy) o.put("error", new JSONObject().put("code", "IN_PROGRESS").put("message", "请求进行中；同一标识不会重复发送。")); else if (e.has("error")) o.put("error", e.get("error")); return OnlineSupport.copy(o);
    }
}
