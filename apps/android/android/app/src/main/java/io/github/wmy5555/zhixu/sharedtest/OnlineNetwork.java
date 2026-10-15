package io.github.wmy5555.zhixu.sharedtest;

import java.io.InputStream;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.*;
import okhttp3.*;
import okio.BufferedSink;
import org.json.*;

/** One-shot direct HTTPS with checked DNS pinned to the same connection, no redirect/retry. */
final class OnlineNetwork {
    static final int MAX_OUTPUT_TOKENS = 4096;
    static final int MAX_INPUT_BYTES = 192 * 1024;
    static final int MAX_RESPONSE_BYTES = 512 * 1024;
    interface Resolver { List<InetAddress> resolve(String host) throws Exception; }
    interface Prepared { JSONObject send() throws Exception; void cancel(); }
    interface Transport { Prepared prepare(JSONObject descriptor, JSONObject settings) throws Exception; }
    private static final ThreadPoolExecutor DNS_WORKERS = new ThreadPoolExecutor(0, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(2), r -> { Thread t = new Thread(r, "zhixu-dns"); t.setDaemon(true); return t; }, new ThreadPoolExecutor.AbortPolicy());
    static List<InetAddress> timedDns(String host) throws Exception {
        Future<List<InetAddress>> f;
        try { f = DNS_WORKERS.submit(() -> Arrays.asList(InetAddress.getAllByName(host))); }
        catch (RejectedExecutionException e) { throw OnlineSupport.fail("DNS_ERROR", "地址解析忙碌，请稍后重试。"); }
        try { return f.get(10, TimeUnit.SECONDS); }
        catch (Exception e) { f.cancel(true); throw OnlineSupport.fail("DNS_ERROR", "地址解析超时或失败，此次未发送。"); }
    }
    static URI validateUrl(String value) throws Exception {
        URI u;
        try { u = new URI(value); } catch (Exception e) { throw OnlineSupport.fail("INVALID_URL", "供应商或网页地址格式无效。"); }
        String host = u.getHost();
        if (!"https".equalsIgnoreCase(u.getScheme()) || host == null || host.isEmpty() || u.getRawUserInfo() != null || u.getRawFragment() != null
            || u.getPort() != -1 && u.getPort() != 443 || value.matches("(?s).*[\\x00-\\x20\\x7f\\\\].*")
            || host.endsWith(".") || host.indexOf('%') >= 0) throw OnlineSupport.fail("INVALID_URL", "只允许无账号信息的公共 HTTPS 地址与默认端口。");
        String h = host.toLowerCase(Locale.ROOT);
        if (h.equals("localhost") || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home") || !h.contains(".") && !h.contains(":")) throw OnlineSupport.fail("SSRF_BLOCKED", "不能联网访问本机或内部地址。");
        if (h.startsWith("[") || h.matches("[0-9.]+")) {
            InetAddress ip = InetAddress.getByName(h); if (!publicAddress(ip)) throw OnlineSupport.fail("SSRF_BLOCKED", "不能联网访问内部地址。");
        }
        return u;
    }
    static boolean publicAddress(InetAddress ip) {
        if (ip.isAnyLocalAddress() || ip.isLoopbackAddress() || ip.isLinkLocalAddress() || ip.isSiteLocalAddress() || ip.isMulticastAddress()) return false;
        byte[] b = ip.getAddress();
        if (b.length == 4) {
            int a = b[0] & 255, c = b[1] & 255;
            return !(a == 0 || a == 10 || a == 127 || a >= 224 || a == 100 && c >= 64 && c <= 127 || a == 169 && c == 254
                || a == 172 && c >= 16 && c <= 31 || a == 192 && (c == 168 || c == 0 || c == 2)
                || a == 198 && (c == 18 || c == 19 || c == 51) || a == 203 && c == 0 && (b[2] & 255) == 113);
        }
        // Only global unicast 2000::/3; exclude documentation, transition, mapped and protocol assignments.
        if (b.length != 16 || (b[0] & 0xe0) != 0x20) return false;
        if ((b[0] & 255) == 0x20 && (b[1] & 255) == 0x02) return false; // 6to4 embeds unchecked IPv4.
        if ((b[0] & 255) == 0x20 && (b[1] & 255) == 0x01 && ((b[2] & 255) == 0 && (b[3] & 255) < 0x20 || (b[2] & 255) == 0x0d && (b[3] & 255) == 0xb8)) return false;
        return !((b[0] & 255) == 0x3f && (b[1] & 255) == 0xff); // documentation.
    }
    static List<InetAddress> resolvePublic(String host, Resolver resolver) throws Exception {
        List<InetAddress> all = resolver.resolve(host);
        if (all == null || all.isEmpty() || all.size() > 16) throw OnlineSupport.fail("DNS_ERROR", "供应商地址解析失败。");
        for (InetAddress ip : all) if (!publicAddress(ip)) throw OnlineSupport.fail("SSRF_BLOCKED", "地址解析包含内部网络，已拒绝发送。");
        // One address means no route fallback can send a second billable request.
        return Collections.singletonList(all.get(0));
    }
    static String endpoint(String base, String path) throws Exception {
        URI u = validateUrl(base); if (u.getRawQuery() != null) throw OnlineSupport.fail("INVALID_URL", "供应商基础地址不能包含查询参数。");
        return base.replaceAll("/+$", "") + "/" + path;
    }
    static JSONObject modelBody(JSONObject d, JSONObject settings) throws Exception {
        JSONObject in = d.getJSONObject("input"), ai = settings.getJSONObject("ai"); boolean json = in.optBoolean("json");
        String system = in.optString("system", ""); if (json) system += "\n请仅返回完整 JSON 对象。";
        JSONArray messages = new JSONArray(); if (!system.isEmpty()) messages.put(new JSONObject().put("role", "system").put("content", system));
        messages.put(new JSONObject().put("role", "user").put("content", in.getString("prompt")));
        JSONObject body = new JSONObject().put("model", ai.getString("model")).put("messages", messages).put("stream", false).put("max_tokens", MAX_OUTPUT_TOKENS);
        if (json) body.put("response_format", new JSONObject().put("type", "json_object"));
        if ("api.deepseek.com".equalsIgnoreCase(validateUrl(ai.getString("baseUrl")).getHost())) body.put("thinking", new JSONObject().put("type", "disabled"));
        return body;
    }
    static final class HttpTransport implements Transport {
        private final Resolver resolver;
        HttpTransport() { this(OnlineNetwork::timedDns); }
        HttpTransport(Resolver resolver) { this.resolver = resolver; }
        @Override public Prepared prepare(JSONObject d, JSONObject settings) throws Exception {
            String cap = d.getString("capability"), url; JSONObject body = null; String key = null;
            if ("model".equals(cap)) { url = endpoint(settings.getJSONObject("ai").getString("baseUrl"), "chat/completions"); body = modelBody(d, settings); key = settings.getJSONObject("credentials").getString("model"); }
            else if ("search".equals(cap)) { url = endpoint(settings.getJSONObject("search").getString("baseUrl"), "search"); key = settings.getJSONObject("credentials").getString("search");
                body = new JSONObject().put("query", d.getJSONObject("input").getString("query")).put("search_depth", "advanced").put("max_results", 6).put("include_answer", false).put("include_raw_content", false); }
            else url = d.getJSONObject("input").getString("url");
            URI u = validateUrl(url); final String host = u.getHost(); final List<InetAddress> pinned = resolvePublic(host, resolver);
            OkHttpClient client = client(host, pinned);
            Request.Builder req = new Request.Builder().url(url).header("Accept", "fetch".equals(cap) ? "text/html, text/plain;q=0.9" : "application/json");
            if (key != null) req.header("Authorization", "Bearer " + key);
            if (body != null) { String raw = body.toString(); if (raw.getBytes(StandardCharsets.UTF_8).length > MAX_INPUT_BYTES) throw OnlineSupport.fail("TOO_LARGE", "联网输入过长。"); req.post(oneShot(RequestBody.create(MediaType.get("application/json; charset=utf-8"), raw))); }
            final Call call = client.newCall(req.build());
            final String protectedKey = key;
            return new Prepared() {
                public void cancel() { call.cancel(); }
                public JSONObject send() throws Exception {
                    try (Response response = call.execute()) {
                        requireSuccess(response.code());
                        ResponseBody rb = response.body(); if (rb == null) throw OnlineSupport.fail("INVALID_RESPONSE", "供应商响应为空。");
                        if (rb.contentLength() > MAX_RESPONSE_BYTES) throw OnlineSupport.fail("TOO_LARGE", "联网响应过长。");
                        String raw; try (InputStream input = rb.byteStream()) { raw = new String(OnlineSupport.bounded(input, MAX_RESPONSE_BYTES), StandardCharsets.UTF_8); }
                        if ("fetch".equals(cap)) {
                            String type = response.header("Content-Type", "").toLowerCase(Locale.ROOT);
                            if (!(type.startsWith("text/plain") || type.startsWith("text/html") || type.startsWith("application/xhtml+xml"))) throw OnlineSupport.fail("INVALID_RESPONSE", "网页类型不受支持。");
                            return page(url, raw, type);
                        }
                        if (protectedKey != null && !protectedKey.isEmpty()) raw = raw.replace(protectedKey, "[credential-redacted]");
                        JSONObject json = new JSONObject(raw);
                        if ("model".equals(cap)) {
                            JSONObject choice = json.getJSONArray("choices").getJSONObject(0);
                            if (!"stop".equals(choice.optString("finish_reason"))) throw OnlineSupport.fail("INCOMPLETE_RESPONSE", "模型输出未完整结束，不能保存为成功结果。");
                            String text = choice.getJSONObject("message").getString("content"); if (text.trim().isEmpty()) throw OnlineSupport.fail("INVALID_RESPONSE", "模型未返回正文。");
                            if (d.getJSONObject("input").optBoolean("json")) new JSONObject(text);
                            JSONObject usage = new JSONObject(), supplied = json.optJSONObject("usage");
                            if (supplied != null) {
                                for (String name : new String[] {"prompt_tokens", "completion_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens"}) if (supplied.opt(name) instanceof Number) usage.put(name, supplied.get(name));
                                JSONObject details = supplied.optJSONObject("prompt_tokens_details"); if (details != null && details.opt("cached_tokens") instanceof Number) usage.put("prompt_tokens_details", new JSONObject().put("cached_tokens", details.get("cached_tokens")));
                            }
                            return new JSONObject().put("text", text).put("usage", usage);
                        }
                        JSONArray results = json.getJSONArray("results"), out = new JSONArray();
                        for (int i = 0; i < Math.min(6, results.length()); i++) { JSONObject item = results.getJSONObject(i);
                            try { validateUrl(item.getString("url")); } catch (Exception ignored) { continue; }
                            out.put(new JSONObject().put("title", limited(item.optString("title"), 1024)).put("url", item.getString("url")).put("snippet", limited(item.optString("content", item.optString("snippet")), 16000)));
                        }
                        return new JSONObject().put("results", out);
                    } finally { client.connectionPool().evictAll(); client.dispatcher().executorService().shutdown(); }
                }
            };
        }
    }
    static OkHttpClient client(String host, List<InetAddress> pinned) {
        java.util.concurrent.atomic.AtomicInteger exchanges = new java.util.concurrent.atomic.AtomicInteger();
        return new OkHttpClient.Builder().proxy(Proxy.NO_PROXY).dns(h -> {
            if (!host.equalsIgnoreCase(h)) throw new UnknownHostException("Host changed"); return pinned;
        }).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .authenticator(okhttp3.Authenticator.NONE).proxyAuthenticator(okhttp3.Authenticator.NONE)
            .addNetworkInterceptor(chain -> { if (exchanges.incrementAndGet() > 1) throw new java.io.IOException("Second exchange forbidden"); return chain.proceed(chain.request()); })
            .protocols(Collections.singletonList(Protocol.HTTP_1_1)).connectionPool(new ConnectionPool(0, 1, TimeUnit.SECONDS))
            .callTimeout(45, TimeUnit.SECONDS).connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).writeTimeout(15, TimeUnit.SECONDS).build();
    }
    static RequestBody oneShot(RequestBody body) {
        return new RequestBody() {
            @Override public MediaType contentType() { return body.contentType(); }
            @Override public long contentLength() throws java.io.IOException { return body.contentLength(); }
            @Override public void writeTo(BufferedSink sink) throws java.io.IOException { body.writeTo(sink); }
            @Override public boolean isOneShot() { return true; }
        };
    }
    static void requireSuccess(int status) throws Exception {
        if (status >= 300 && status < 400) throw OnlineSupport.fail("REDIRECT_BLOCKED", "供应商返回跳转，已拒绝向新地址发送凭据。");
        if (status < 200 || status >= 300) throw OnlineSupport.fail("PROVIDER_ERROR", "供应商未返回成功结果，请检查设置或账单；此请求不会自动重发。");
    }
    static String limited(String s, int max) { return s.substring(0, Math.min(max, s.length())); }
    static JSONObject page(String url, String raw, String type) throws Exception {
        String title = ""; String text = raw;
        if (!type.startsWith("text/plain")) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?is)<title[^>]*>(.*?)</title>").matcher(raw); if (m.find()) title = limited(m.group(1).replaceAll("<[^>]+>", ""), 1024);
            text = raw.replaceAll("(?is)<(script|style|noscript|template)[^>]*>.*?</\\1\\s*>", " ").replaceAll("(?is)<!--.*?-->", " ")
                .replaceAll("(?is)<[^>]*>", " ").replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replaceAll("[ \\t\\x0B\\f\\r]+", " ").trim();
        }
        return new JSONObject().put("url", url).put("title", title).put("text", limited(text, 128 * 1024)).put("fetchedAt", OnlineSupport.at(System.currentTimeMillis()));
    }
}
