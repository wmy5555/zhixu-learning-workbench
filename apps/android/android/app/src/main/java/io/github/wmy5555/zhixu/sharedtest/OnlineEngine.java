package io.github.wmy5555.zhixu.sharedtest;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.json.*;

/** Orchestrates exact grants, reservations and one physical send. Injectable seams are package-private tests only. */
final class OnlineEngine {
    final OnlineSettings settings;
    final OnlineLedger ledger;
    final OnlineAuthorization authorization;
    private final OnlineNetwork.Transport transport;
    private final Map<String, OnlineNetwork.Prepared> active = new ConcurrentHashMap<>();
    OnlineEngine(OnlineSettings settings, OnlineLedger ledger, OnlineAuthorization authorization, OnlineNetwork.Transport transport) { this.settings = settings; this.ledger = ledger; this.authorization = authorization; this.transport = transport; }
    JSONObject request(JSONObject input) throws Exception {
        JSONObject d = OnlineAuthorization.descriptor(input, true); String id = d.getString("requestId"), context = d.getString("context");
        OnlineNetwork.Prepared prepared = null; boolean reserved = false, maySend = false;
        try {
            synchronized (OnlineSupport.LOCK) {
                String digest = authorization.digest(d); JSONObject previous = ledger.lookup(id, digest, context); if (previous != null) return previous;
                JSONObject config = settings.raw(); OnlineAuthorization.Inspection grant = authorization.consume(OnlineSupport.text(input, "authorizationId", 128, false), d, config);
                // DNS and key validation complete before the durable sending marker. No bytes are sent in prepare.
                prepared = transport.prepare(d, config);
                if (!authorization.digest(d).equals(grant.digest) || !settings.raw().getString("revision").equals(grant.settingsRevision)) throw OnlineSupport.fail("STALE_AUTHORIZATION", "发送前材料或在线设置已变化。");
                org.json.JSONArray sourceIds = new org.json.JSONArray();
                for (java.util.Iterator<String> it = grant.snapshot.keys(); it.hasNext();) { String k = it.next(); if (k.startsWith("source:")) sourceIds.put(k.substring(7)); }
                ledger.reserve(d, digest, config, System.currentTimeMillis(), sourceIds); reserved = true;
                sentConfig.put(id, config);
                active.put(id, prepared);
                // On ambiguous persistence failure we never send, and leave a conservative durable record for reopen.
                ledger.sent(id); maySend = true;
            }
            JSONObject result = prepared.send(); JSONObject config;
            // Settings may change while request is in flight. Account using the exact snapshot authorized before send.
            config = sentConfig.get(id);
            if (config == null) throw OnlineSupport.fail("STORE_ERROR", "请求费用配置丢失，结果费用未知。");
            JSONObject usage = OnlineLedger.account(d, result, config);
            ledger.finish(id, "succeeded", result, usage, null, null);
            return ledger.lookup(id, null, context);
        } catch (Exception e) {
            if (!reserved) throw e;
            String code = e instanceof OnlineSupport.Failure ? ((OnlineSupport.Failure)e).code : "NETWORK_ERROR";
            String message = maySend ? "请求可能已经发送，结果和费用未知；请核对供应商账单。不会自动重发。" : "请求未开始发送，此次未调用供应商。";
            try { ledger.finish(id, maySend ? "unknown" : "failed", null, maySend ? OnlineLedger.unknownUsage() : OnlineLedger.zeroUsage(), code, message); }
            catch (Exception persistence) { throw OnlineSupport.fail("STORE_ERROR", "联网账本写入未确认；请重新打开后查询原请求，不能重新发送同一请求。"); }
            return ledger.lookup(id, null, context);
        } finally {
            if (reserved) { active.remove(id); sentConfig.remove(id); } if (!maySend && prepared != null) prepared.cancel();
        }
    }
    private final Map<String, JSONObject> sentConfig = new ConcurrentHashMap<>();
    JSONObject cancel(String id, String context) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            JSONObject existing = ledger.lookup(id, null, context); boolean revoked = authorization.revoke(id, context);
            if (existing == null && revoked) return new JSONObject().put("requestId", id).put("state", "failed");
            JSONObject out = ledger.cancel(id, context); OnlineNetwork.Prepared p = active.get(id); if (p != null) p.cancel(); return out;
        }
    }
    void close() {
        synchronized (OnlineSupport.LOCK) {
            authorization.clear(); for (Map.Entry<String, OnlineNetwork.Prepared> e : active.entrySet()) { e.getValue().cancel(); }
        }
    }
}
