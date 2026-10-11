package io.github.wmy5555.zhixu.sharedtest;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Settings and write-only secrets share one encrypted, revision-checked atomic commit. */
final class OnlineSettings {
    private final File file;
    private final OnlineCredentialStore credentials;
    OnlineSettings(File root, OnlineCredentialStore credentials) throws Exception { OnlineSupport.directory(root); file = OnlineSupport.child(root, "settings.aes"); this.credentials = credentials; }
    JSONObject raw() throws Exception {
        synchronized (OnlineSupport.LOCK) {
            if (file.exists() || new File(file + ".bak").exists()) return new JSONObject(new String(credentials.decrypt(OnlineSupport.read(file, 32 * 1024)), StandardCharsets.UTF_8));
            return defaults();
        }
    }
    private JSONObject defaults() throws Exception {
        return new JSONObject().put("revision", "initial").put("ai", new JSONObject().put("enabled", false).put("baseUrl", "https://api.deepseek.com")
            .put("model", "deepseek-flash").put("dailyCallLimit", 20).put("monthlyBudget", JSONObject.NULL).put("sourceCallLimit", 6)
            .put("inputPrice", JSONObject.NULL).put("outputPrice", JSONObject.NULL).put("cachedInputPrice", JSONObject.NULL))
            .put("search", new JSONObject().put("enabled", false).put("baseUrl", "https://api.tavily.com").put("requestPrice", JSONObject.NULL))
            .put("fetch", new JSONObject().put("enabled", false)).put("credentials", new JSONObject().put("model", "").put("search", ""));
    }
    JSONObject get() throws Exception { return masked(raw()); }
    static JSONObject masked(JSONObject value) throws Exception {
        JSONObject o = OnlineSupport.copy(value), secrets = o.getJSONObject("credentials"); o.remove("credentials");
        o.getJSONObject("ai").put("hasKey", !secrets.optString("model").isEmpty()); o.getJSONObject("search").put("hasKey", !secrets.optString("search").isEmpty());
        o.put("capabilities", new JSONObject().put("ai", o.getJSONObject("ai").optBoolean("enabled") && o.getJSONObject("ai").optBoolean("hasKey"))
            .put("search", o.getJSONObject("search").optBoolean("enabled") && o.getJSONObject("search").optBoolean("hasKey")).put("fetch", o.getJSONObject("fetch").optBoolean("enabled")));
        return o;
    }
    JSONObject update(JSONObject input) throws Exception {
        synchronized (OnlineSupport.LOCK) {
            OnlineSupport.fields(input, "expectedRevision", "ai", "search", "fetch", "credentials", "clearCredentials");
            JSONObject o = raw(); if (!o.getString("revision").equals(OnlineSupport.text(input, "expectedRevision", 128, false))) throw OnlineSupport.fail("CONFLICT", "在线设置已变化，请重新打开设置再保存。");
            for (String section : new String[] {"ai", "search", "fetch"}) if (input.has(section)) {
                JSONObject patch = input.getJSONObject(section), target = o.getJSONObject(section);
                OnlineSupport.fields(patch, "ai".equals(section) ? new String[] {"enabled", "baseUrl", "model", "dailyCallLimit", "monthlyBudget", "sourceCallLimit", "inputPrice", "outputPrice", "cachedInputPrice"}
                    : "search".equals(section) ? new String[] {"enabled", "baseUrl", "requestPrice"} : new String[] {"enabled"});
                for (Iterator<String> it = patch.keys(); it.hasNext();) { String k = it.next(); Object v = patch.get(k);
                    if ("enabled".equals(k)) OnlineSupport.bool(patch, k);
                    else if ("baseUrl".equals(k)) OnlineNetwork.validateUrl(OnlineSupport.text(patch, k, 2048, false));
                    else if ("model".equals(k)) { String model = OnlineSupport.text(patch, k, 128, false); if (!model.matches("[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}")) throw OnlineSupport.fail("INVALID_INPUT", "模型标识格式不正确。"); }
                    else number(v, k.endsWith("Limit") ? 1 : 0, k.endsWith("Limit") ? 1000 : 1000000, k.endsWith("Limit"));
                    target.put(k, v);
                }
            }
            JSONObject secrets = o.getJSONObject("credentials");
            for (String section : new String[] {"credentials", "clearCredentials"}) if (input.has(section)) {
                JSONObject patch = input.getJSONObject(section); OnlineSupport.fields(patch, "model", "search");
                for (Iterator<String> it = patch.keys(); it.hasNext();) { String k = it.next();
                    if ("clearCredentials".equals(section)) { if (OnlineSupport.bool(patch, k)) secrets.put(k, ""); }
                    else { String v = OnlineSupport.text(patch, k, 4096, true); if (!v.matches("[\\x21-\\x7e]*")) throw OnlineSupport.fail("INVALID_INPUT", "密钥格式不正确。"); if (!v.isEmpty()) secrets.put(k, v); }
                }
            }
            o.put("revision", UUID.randomUUID().toString()); byte[] bytes = o.toString().getBytes(StandardCharsets.UTF_8);
            OnlineSupport.write(file, credentials.encrypt(bytes)); return masked(o);
        }
    }
    static void number(Object v, double min, double max, boolean integer) throws Exception {
        if (v == JSONObject.NULL && !integer) return;
        if (!(v instanceof Number)) throw OnlineSupport.fail("INVALID_INPUT", "预算或价格格式不正确。");
        double n = ((Number) v).doubleValue(); if (!Double.isFinite(n) || n < min || n > max || integer && n != Math.rint(n)) throw OnlineSupport.fail("INVALID_INPUT", "预算或调用上限超出范围。");
    }
}
