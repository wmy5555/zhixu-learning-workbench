package io.github.wmy5555.zhixu.sharedtest;

import android.test.AndroidTestCase;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.math.BigInteger;
import java.security.*;
import java.security.cert.X509Certificate;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import okhttp3.*;
import org.json.*;

/** Random disposable storage, generated test-only Keystore alias and synthetic transport/loopback server. No provider calls. */
@SuppressWarnings("deprecation")
public class OnlineSecurityTest extends AndroidTestCase {
    private File root;
    private OnlineCredentialStore credentials;
    private OnlineSettings settings;
    private OnlineLedger ledger;
    private OnlineAuthorization auth;
    private AtomicInteger sends;
    private JSONObject material;
    @Override protected void setUp() throws Exception {
        super.setUp(); root = new File(getContext().getCacheDir().getCanonicalFile(), "online-test-" + UUID.randomUUID());
        credentials = new OnlineCredentialStore("zhixu.online.test." + UUID.randomUUID()); settings = new OnlineSettings(root, credentials); ledger = new OnlineLedger(root);
        material = new JSONObject().put("body", "合成材料第一版"); auth = new OnlineAuthorization(d -> new JSONObject().put("synthetic", new JSONObject(material.toString()))); sends = new AtomicInteger();
    }
    @Override protected void tearDown() throws Exception {
        if (credentials != null) credentials.deleteForTests(); if (root != null) delete(root); super.tearDown();
    }
    private static void delete(File f) { if (f.isDirectory()) { File[] children = f.listFiles(); if (children != null) for (File c : children) delete(c); } if (f.exists() && !f.delete()) throw new AssertionError("Synthetic fixture cleanup failed"); }
    private JSONObject configure(JSONObject ai) throws Exception {
        ai.put("enabled", true); return settings.update(new JSONObject().put("expectedRevision", settings.get().getString("revision")).put("ai", ai)
            .put("credentials", new JSONObject().put("model", "synthetic-only-" + UUID.randomUUID())));
    }
    private JSONObject priced() throws Exception { return new JSONObject().put("inputPrice", 1).put("outputPrice", 2).put("cachedInputPrice", 0.1).put("dailyCallLimit", 50).put("sourceCallLimit", 10); }
    private JSONObject d(String id) throws Exception {
        return new JSONObject().put("requestId", id).put("context", "formal").put("purpose", "ask").put("capability", "model")
            .put("input", new JSONObject().put("system", "合成指令").put("prompt", "合成问题").put("json", true)).put("materials", new JSONArray()).put("includeAnswer", false).put("includeHistory", false);
    }
    private JSONObject grant(JSONObject d) throws Exception { return auth.grant(auth.inspect(d, settings.raw()), settings.raw()); }
    private JSONObject request(JSONObject d) throws Exception { JSONObject input = new JSONObject(d.toString()); input.put("authorizationId", grant(d).getString("authorizationId")); return input; }
    private JSONObject result() throws Exception { return new JSONObject().put("text", "{\"answer\":\"合成回复\"}").put("usage", new JSONObject().put("prompt_tokens", 30).put("completion_tokens", 20).put("prompt_cache_hit_tokens", 10)); }
    private OnlineEngine engine(OnlineNetwork.Transport transport) { return new OnlineEngine(settings, ledger, auth, transport); }
    private OnlineNetwork.Transport okTransport() { return (d, s) -> new OnlineNetwork.Prepared() { public JSONObject send() throws Exception { sends.incrementAndGet(); return result(); } public void cancel() {} }; }
    interface Action { void run() throws Exception; }
    private void code(String wanted, Action a) throws Exception { try { a.run(); fail("Expected " + wanted); } catch (OnlineSupport.Failure e) { assertEquals(wanted, e.code); } }

    public void testSettingsDefaultClosedWriteOnlyEncryptedCASAndClear() throws Exception {
        JSONObject initial = settings.get(); assertFalse(initial.getJSONObject("ai").getBoolean("enabled")); assertFalse(initial.getJSONObject("search").getBoolean("enabled")); assertFalse(initial.getJSONObject("fetch").getBoolean("enabled"));
        String secret = "synthetic-only-" + UUID.randomUUID(); JSONObject saved = settings.update(new JSONObject().put("expectedRevision", initial.getString("revision"))
            .put("credentials", new JSONObject().put("model", secret)));
        assertTrue(saved.getJSONObject("ai").getBoolean("hasKey")); assertFalse(saved.has("credentials")); assertFalse(saved.toString().contains(secret));
        assertFalse(new String(OnlineSupport.read(new File(root, "settings.aes"), 32000), StandardCharsets.UTF_8).contains(secret));
        code("CONFLICT", () -> settings.update(new JSONObject().put("expectedRevision", initial.getString("revision"))));
        JSONObject kept = settings.update(new JSONObject().put("expectedRevision", saved.getString("revision")).put("credentials", new JSONObject().put("model", "")));
        assertTrue(kept.getJSONObject("ai").getBoolean("hasKey"));
        JSONObject cleared = settings.update(new JSONObject().put("expectedRevision", kept.getString("revision")).put("clearCredentials", new JSONObject().put("model", true)));
        assertFalse(cleared.getJSONObject("ai").getBoolean("hasKey"));
        assertFalse(new OnlineSettings(root, credentials).get().getJSONObject("ai").getBoolean("hasKey"));
        byte[] encrypted = credentials.encrypt("synthetic".getBytes(StandardCharsets.UTF_8)); encrypted[encrypted.length - 1] ^= 1;
        try { credentials.decrypt(encrypted); fail("GCM integrity must reject tampering"); } catch (javax.crypto.AEADBadTagException expected) { }
    }

    public void testExactNativeDigestVersionExpiryOneShotAndSupplierRevision() throws Exception {
        configure(priced()); JSONObject d = d(UUID.randomUUID().toString()), original = request(d); String token = original.getString("authorizationId");
        JSONObject changed = new JSONObject(d.toString()); changed.getJSONObject("input").put("prompt", "合成问题二");
        code("STALE_AUTHORIZATION", () -> auth.consume(token, changed, settings.raw()));
        code("AUTHORIZATION_REQUIRED", () -> auth.consume(token, d, settings.raw()));
        JSONObject versionGrant = grant(d); material.put("body", "合成材料第二版");
        code("STALE_AUTHORIZATION", () -> auth.consume(versionGrant.getString("authorizationId"), d, settings.raw()));
        JSONObject supplierGrant = grant(d); settings.update(new JSONObject().put("expectedRevision", settings.get().getString("revision")).put("ai", new JSONObject().put("baseUrl", "https://provider.example.org/v1")));
        code("STALE_AUTHORIZATION", () -> auth.consume(supplierGrant.getString("authorizationId"), d, settings.raw()));
        AtomicLong now = new AtomicLong(1); auth.clockForTests(now::get); JSONObject expiring = grant(d); now.set(OnlineAuthorization.TTL_MS + 2);
        code("AUTHORIZATION_REQUIRED", () -> auth.consume(expiring.getString("authorizationId"), d, settings.raw()));
        JSONObject current = grant(d); assertTrue(current.getString("inputDigest").matches("[0-9a-f]{64}")); assertTrue(auth.inspect(d, settings.raw()).display.contains("合成问题"));
        JSONObject practice = new JSONObject(d.toString()).put("context", "practice"); code("STALE_AUTHORIZATION", () -> auth.consume(current.getString("authorizationId"), practice, settings.raw()));
    }

    public void testRealLocalMaterialsDetectOpaqueHashCollisionAncestorChangeAndPracticeIsolation() throws Exception {
        configure(priced().put("sourceCallLimit", 1)); File local = new File(root, "local-fixture"); LocalSourceStore sources = new LocalSourceStore(new File(local, "sources"));
        try {
            LocalLearningStore formal = new LocalLearningStore(new File(local, "learning"), "formal"), practice = new LocalLearningStore(new File(local, "learning"), "practice");
            JSONObject source = sources.save(new JSONObject().put("title", "合成原文").put("body", "合成原文第一版"));
            JSONObject note = new JSONObject().put("id", UUID.randomUUID().toString()).put("kind", "knowledge").put("title", "合成知识").put("body", "知识第一版").put("hash", "opaque-token")
                .put("meta", new JSONObject().put("privacy", "local").put("sources", new JSONArray().put(new JSONObject().put("id", source.getString("id")).put("hash", source.getString("hash")).put("role", "input"))));
            JSONObject state = new JSONObject().put("notes", new JSONArray().put(note)).put("records", new JSONObject()).put("settings", new JSONObject()).put("guide", new JSONObject());
            JSONObject saved = formal.commit("empty", state);
            OnlineAuthorization actual = new OnlineAuthorization(new OnlineAuthorization.LocalMaterials(sources, formal, practice));
            JSONObject d = d(UUID.randomUUID().toString()).put("materials", new JSONArray().put(new JSONObject().put("id", note.getString("id")).put("hash", note.getString("hash")).put("kind", "knowledge")));
            OnlineAuthorization.Inspection inspection = actual.inspect(d, settings.raw()); JSONObject g = actual.grant(inspection, settings.raw());
            assertTrue(inspection.snapshot.has("source:" + source.getString("id"))); assertEquals("local", sources.read(source.getString("id")).getJSONObject("meta").getString("privacy"));
            note.put("body", "知识被修改，但仍带同一个不可信opaque版本令牌"); formal.commit(saved.getString("revision"), state);
            code("STALE_AUTHORIZATION", () -> actual.consume(g.getString("authorizationId"), d, settings.raw()));
            JSONObject practiceD = new JSONObject(d.toString()).put("context", "practice"); code("STALE_MATERIAL", () -> actual.inspect(practiceD, settings.raw()));
            OnlineEngine actualEngine = new OnlineEngine(settings, ledger, actual, okTransport());
            JSONObject firstInput = new JSONObject(d.toString()).put("authorizationId", actual.grant(actual.inspect(d, settings.raw()), settings.raw()).getString("authorizationId"));
            assertEquals("succeeded", actualEngine.request(firstInput).getString("state"));
            JSONObject nextD = new JSONObject(d.toString()).put("requestId", UUID.randomUUID().toString());
            JSONObject secondInput = new JSONObject(nextD.toString()).put("authorizationId", actual.grant(actual.inspect(nextD, settings.raw()), settings.raw()).getString("authorizationId"));
            code("SOURCE_LIMIT", () -> actualEngine.request(secondInput)); assertEquals(1, sends.get()); // Descriptor contained only knowledge; native ancestry still enforced the real source's limit.
            JSONObject session = new JSONObject().put("id", UUID.randomUUID().toString()).put("noteId", note.getString("id")).put("sourceHash", note.getString("hash"))
                .put("status", "unassessed").put("material", note.getString("body")).put("hintCount", 0).put("turns", new JSONArray().put(new JSONObject()
                    .put("id", UUID.randomUUID().toString()).put("requestId", UUID.randomUUID().toString()).put("answer", "合成原答").put("hintUsed", false).put("assessment", "unassessed")));
            state.getJSONObject("records").put("sessions", new JSONObject().put(session.getString("id"), session)); formal.commit(formal.load().getString("revision"), state);
            JSONObject turn = session.getJSONArray("turns").getJSONObject(0);
            JSONObject answerD = d(UUID.randomUUID().toString()).put("includeAnswer", true).put("materials", new JSONArray().put(new JSONObject().put("id", turn.getString("id")).put("hash", turn.getString("requestId")).put("kind", "answer")));
            JSONObject answerGrant = actual.grant(actual.inspect(answerD, settings.raw()), settings.raw());
            assertTrue(actual.inspect(answerD, settings.raw()).snapshot.has("source:" + source.getString("id")));
            JSONObject fresh = actual.grant(actual.inspect(d, settings.raw()), settings.raw());
            sources.save(new JSONObject().put("id", source.getString("id")).put("expectedHash", source.getString("hash")).put("title", "合成原文").put("body", "原文第二版"));
            code("STALE_MATERIAL", () -> actual.consume(fresh.getString("authorizationId"), d, settings.raw()));
            code("STALE_MATERIAL", () -> actual.consume(answerGrant.getString("authorizationId"), answerD, settings.raw()));
            assertFalse(formal.backup().toString().contains("credentials")); assertFalse(sources.backup().toString().contains("synthetic-only-"));
        } finally { sources.close(); }
    }

    public void testIdempotencyDigestConflictAndContextCannotReturnOtherLibrary() throws Exception {
        configure(priced()); OnlineEngine engine = engine(okTransport()); JSONObject d = d(UUID.randomUUID().toString()), input = request(d);
        assertEquals("succeeded", engine.request(input).getString("state")); assertEquals("succeeded", engine.request(input).getString("state")); assertEquals(1, sends.get());
        JSONObject different = new JSONObject(input.toString()); different.getJSONObject("input").put("prompt", "different"); code("CONFLICT", () -> engine.request(different));
        code("CONTEXT_MISMATCH", () -> ledger.lookup(d.getString("requestId"), null, "practice")); code("CONTEXT_MISMATCH", () -> engine.cancel(d.getString("requestId"), "practice"));
        assertEquals(0, ledger.usage(new JSONObject().put("context", "practice"), settings.raw(), System.currentTimeMillis()).getJSONArray("calls").length());
        assertEquals(1, ledger.usage(new JSONObject().put("context", "formal"), settings.raw(), System.currentTimeMillis()).getJSONArray("calls").length());
        engine.close();
    }

    public void testCrashSentBecomesPermanentUnknownNeverPreparesOrResends() throws Exception {
        configure(priced()); JSONObject d = d(UUID.randomUUID().toString()); String digest = auth.digest(d);
        ledger.reserve(d, digest, settings.raw(), System.currentTimeMillis()); ledger.sent(d.getString("requestId"));
        OnlineLedger reopened = new OnlineLedger(root); assertEquals("unknown", reopened.lookup(d.getString("requestId"), null, "formal").getString("state"));
        OnlineEngine engine = new OnlineEngine(settings, reopened, auth, (descriptor, s) -> { fail("Unknown request must not prepare transport"); return null; });
        assertEquals("unknown", engine.request(request(d)).getString("state")); assertEquals(0, sends.get());
        assertEquals("unknown", reopened.cancel(d.getString("requestId"), "formal").getString("state")); assertTrue(reopened.lookup(d.getString("requestId"), null, "formal").getJSONObject("usage").isNull("cost"));
        configure(new JSONObject().put("monthlyBudget", 10)); JSONObject next = d(UUID.randomUUID().toString()); code("UNKNOWN_COST", () -> reopened.reserve(next, auth.digest(next), settings.raw(), System.currentTimeMillis()));
    }

    public void testProvenPendingCrashFreeAndTimeoutNeverBecomesFreeFailure() throws Exception {
        configure(priced()); JSONObject pending = d(UUID.randomUUID().toString()); ledger.reserve(pending, auth.digest(pending), settings.raw(), System.currentTimeMillis());
        ledger = new OnlineLedger(root); JSONObject recovered = ledger.lookup(pending.getString("requestId"), null, "formal"); assertEquals("failed", recovered.getString("state")); assertEquals(0.0, recovered.getJSONObject("usage").getDouble("cost"));
        OnlineEngine engine = engine((descriptor, s) -> new OnlineNetwork.Prepared() { public JSONObject send() throws Exception { sends.incrementAndGet(); throw new SocketTimeoutException("Synthetic timeout"); } public void cancel() {} });
        JSONObject d = d(UUID.randomUUID().toString()), input = request(d); assertEquals("unknown", engine.request(input).getString("state")); assertEquals("unknown", engine.request(input).getString("state")); assertEquals(1, sends.get());
        assertEquals(1, ledger.budget(settings.raw(), System.currentTimeMillis()).getInt("unknownCostCalls"));
    }

    public void testConcurrentReservationMonthlyDailyAndSourceLimits() throws Exception {
        configure(priced()); JSONObject a = d(UUID.randomUUID().toString()), b = d(UUID.randomUUID().toString()); double one = OnlineLedger.reservation(a, settings.raw());
        configure(new JSONObject().put("monthlyBudget", one * 1.5)); AtomicInteger admitted = new AtomicInteger(), blocked = new AtomicInteger(); CountDownLatch start = new CountDownLatch(1); AtomicReference<Throwable> failure = new AtomicReference<>();
        Runnable submit = () -> { try { start.await(); JSONObject d = d(UUID.randomUUID().toString()); ledger.reserve(d, auth.digest(d), settings.raw(), System.currentTimeMillis()); admitted.incrementAndGet(); }
            catch (OnlineSupport.Failure e) { if ("MONTHLY_BUDGET".equals(e.code)) blocked.incrementAndGet(); else failure.set(e); } catch (Throwable e) { failure.set(e); } };
        Thread first = new Thread(submit), second = new Thread(submit); first.start(); second.start(); start.countDown(); first.join(5000); second.join(5000);
        assertNull(failure.get()); assertFalse(first.isAlive()); assertFalse(second.isAlive()); assertEquals(1, admitted.get()); assertEquals(1, blocked.get());
        configure(new JSONObject().put("monthlyBudget", JSONObject.NULL).put("dailyCallLimit", 1)); code("DAILY_LIMIT", () -> ledger.reserve(b, auth.digest(b), settings.raw(), System.currentTimeMillis()));
        File extra = new File(root, "source-ledger"); OnlineLedger sourceLedger = new OnlineLedger(extra); configure(new JSONObject().put("dailyCallLimit", 50).put("sourceCallLimit", 1));
        String sourceId = UUID.randomUUID().toString(); JSONArray sourceIds = new JSONArray().put(sourceId); sourceLedger.reserve(a, auth.digest(a), settings.raw(), System.currentTimeMillis(), sourceIds);
        code("SOURCE_LIMIT", () -> sourceLedger.reserve(b, auth.digest(b), settings.raw(), System.currentTimeMillis(), sourceIds));
        JSONObject practice = new JSONObject(b.toString()).put("context", "practice"); sourceLedger.reserve(practice, auth.digest(practice), settings.raw(), System.currentTimeMillis(), sourceIds);
    }

    public void testUnknownPricingBlocksMonthlyAndCachedTokensCostAccurately() throws Exception {
        configure(new JSONObject().put("monthlyBudget", 1)); JSONObject d = d(UUID.randomUUID().toString()); code("UNKNOWN_COST", () -> ledger.reserve(d, auth.digest(d), settings.raw(), System.currentTimeMillis()));
        configure(priced()); JSONObject u = OnlineLedger.account(d, result(), settings.raw()); assertEquals((20 + 1 + 40) / 1000000.0, u.getDouble("cost"), 1e-12);
        JSONObject noCache = result(); noCache.getJSONObject("usage").remove("prompt_cache_hit_tokens"); assertTrue(OnlineLedger.account(d, noCache, settings.raw()).isNull("cost"));
        JSONObject badUsage = result(); badUsage.getJSONObject("usage").put("completion_tokens", OnlineNetwork.MAX_OUTPUT_TOKENS + 1); assertTrue(OnlineLedger.account(d, badUsage, settings.raw()).isNull("cost"));
    }

    public void testCancelAndKnownSuccessRaceKeepsKnownResultAndCost() throws Exception {
        configure(priced()); CountDownLatch sent = new CountDownLatch(1), complete = new CountDownLatch(1); AtomicReference<Throwable> failure = new AtomicReference<>();
        OnlineEngine engine = engine((descriptor, s) -> new OnlineNetwork.Prepared() { public JSONObject send() throws Exception { sends.incrementAndGet(); sent.countDown(); if (!complete.await(5, TimeUnit.SECONDS)) throw new IOException("Synthetic delay"); return result(); } public void cancel() {} });
        JSONObject d = d(UUID.randomUUID().toString()), request = request(d); Thread t = new Thread(() -> { try { engine.request(request); } catch (Throwable e) { failure.set(e); } }); t.start(); assertTrue(sent.await(5, TimeUnit.SECONDS));
        assertEquals("unknown", engine.cancel(d.getString("requestId"), "formal").getString("state")); complete.countDown(); t.join(5000); assertFalse(t.isAlive()); assertNull(failure.get());
        JSONObject finalState = ledger.lookup(d.getString("requestId"), null, "formal"); assertEquals("succeeded", finalState.getString("state")); assertTrue(finalState.has("result")); assertFalse(finalState.getJSONObject("usage").isNull("cost"));
        assertEquals("succeeded", engine.cancel(d.getString("requestId"), "formal").getString("state"));
    }

    public void testPublicHttpsPinnedDnsNoProxyRedirectRetryAndBoundedBodies() throws Exception {
        for (String url : new String[] {"http://example.org", "https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://example.org:8443", "https://user:pass@example.org", "https://example.org/#secret"}) {
            try { OnlineNetwork.validateUrl(url); fail("Must reject " + url); } catch (OnlineSupport.Failure expected) { }
        }
        for (String ip : new String[] {"0.0.0.0", "10.1.1.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.1.1", "192.168.1.1", "198.18.0.1", "224.1.1.1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002:7f00:1::"}) assertFalse(ip, OnlineNetwork.publicAddress(InetAddress.getByName(ip)));
        InetAddress publicIp = InetAddress.getByAddress(new byte[] {8, 8, 8, 8}); AtomicInteger lookups = new AtomicInteger();
        List<InetAddress> pinned = OnlineNetwork.resolvePublic("provider.example.org", host -> { lookups.incrementAndGet(); return Arrays.asList(publicIp, InetAddress.getByAddress(new byte[] {1, 1, 1, 1})); });
        assertEquals(1, pinned.size()); OkHttpClient client = OnlineNetwork.client("provider.example.org", pinned);
        try { assertEquals(pinned, client.dns().lookup("provider.example.org")); assertEquals(1, lookups.get()); assertEquals(Proxy.NO_PROXY, client.proxy()); assertFalse(client.followRedirects()); assertFalse(client.followSslRedirects()); assertFalse(client.retryOnConnectionFailure());
            try { client.dns().lookup("different.example.org"); fail("Cannot change pinned host"); } catch (UnknownHostException expected) { }
        } finally { client.connectionPool().evictAll(); client.dispatcher().executorService().shutdown(); }
        code("SSRF_BLOCKED", () -> OnlineNetwork.resolvePublic("provider.example.org", host -> Arrays.asList(publicIp, InetAddress.getByName("127.0.0.1"))));
        code("REDIRECT_BLOCKED", () -> OnlineNetwork.requireSuccess(302)); code("PROVIDER_ERROR", () -> OnlineNetwork.requireSuccess(503));
        code("TOO_LARGE", () -> OnlineSupport.bounded(new ByteArrayInputStream(new byte[20]), 19)); assertEquals(20, OnlineSupport.bounded(new ByteArrayInputStream(new byte[20]), 20).length);
        JSONObject page = OnlineNetwork.page("https://example.org", "<title>合成标题</title><script>secret-script</script><p>正文</p>", "text/html"); assertFalse(page.getString("text").contains("secret-script")); assertTrue(page.getString("text").contains("正文"));
    }

    public void testActualOkHttp503RetryAfterZeroWritesBillableBodyOnce() throws Exception {
        // Runtime-generated test-only TLS identity: production transport and cleartext policy remain unchanged.
        String alias = "zhixu.online.tls.test." + UUID.randomUUID();
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        try {
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
        long now = System.currentTimeMillis();
        generator.initialize(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
            .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1, KeyProperties.SIGNATURE_PADDING_RSA_PSS).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1)
            .setCertificateSubject(new X500Principal("CN=localhost")).setCertificateSerialNumber(new BigInteger(128, new SecureRandom()).add(BigInteger.ONE))
            .setCertificateNotBefore(new Date(now - 60000)).setCertificateNotAfter(new Date(now + 86400000)).build());
        generator.generateKeyPair();
        PrivateKey key = (PrivateKey) keys.getKey(alias, null); X509Certificate certificate = (X509Certificate) keys.getCertificate(alias);
        certificate.verify(certificate.getPublicKey());
        X509KeyManager keyManager = new X509KeyManager() {
            public String[] getClientAliases(String type, Principal[] issuers) { return null; }
            public String chooseClientAlias(String[] types, Principal[] issuers, Socket socket) { return null; }
            public String[] getServerAliases(String type, Principal[] issuers) { return "RSA".equals(type) ? new String[] { alias } : null; }
            public String chooseServerAlias(String type, Principal[] issuers, Socket socket) { return "RSA".equals(type) ? alias : null; }
            public X509Certificate[] getCertificateChain(String selected) { return alias.equals(selected) ? new X509Certificate[] { certificate } : null; }
            public PrivateKey getPrivateKey(String selected) { return alias.equals(selected) ? key : null; }
        };
        KeyStore trusted = KeyStore.getInstance(KeyStore.getDefaultType()); trusted.load(null); trusted.setCertificateEntry(alias, certificate);
        TrustManagerFactory trustFactory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); trustFactory.init(trusted);
        X509TrustManager trust = (X509TrustManager) trustFactory.getTrustManagers()[0];
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(new KeyManager[] { keyManager }, new TrustManager[] { trust }, new SecureRandom());
        AtomicInteger bodies = new AtomicInteger(); AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicReference<Socket> active = new AtomicReference<>(); AtomicBoolean closing = new AtomicBoolean();
        try (ServerSocket server = tls.getServerSocketFactory().createServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(1500); Thread fixture = new Thread(() -> {
                try { while (true) { try (Socket socket = server.accept()) { active.set(socket); socket.setSoTimeout(2000); BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)); String line = in.readLine(); int length = -1;
                        if (!"POST /synthetic HTTP/1.1".equals(line)) throw new IOException("Unexpected synthetic request");
                        while ((line = in.readLine()) != null && !line.isEmpty()) if (line.toLowerCase(Locale.ROOT).startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                        if (length != 2 || in.read() != '{' || in.read() != '}') throw new IOException("Unexpected synthetic body"); bodies.incrementAndGet();
                        socket.getOutputStream().write("HTTP/1.1 503 Service Unavailable\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().flush();
                    } finally { active.set(null); } } } catch (SocketTimeoutException expected) { } catch (Throwable e) { if (!closing.get()) failure.set(e); }
            }, "zhixu-synthetic-https"); fixture.setDaemon(true);
            final int port = server.getLocalPort();
            OkHttpClient client = new OkHttpClient.Builder().sslSocketFactory(tls.getSocketFactory(), trust)
                .hostnameVerifier((host, session) -> {
                    try { return "127.0.0.1".equals(host) && session.getPeerPort() == port && certificate.equals(session.getPeerCertificates()[0]); }
                    catch (SSLPeerUnverifiedException e) { return false; }
                }).proxy(Proxy.NO_PROXY).retryOnConnectionFailure(false).followRedirects(false).callTimeout(4, TimeUnit.SECONDS).build();
            try { fixture.start(); Request request = new Request.Builder().url("https://127.0.0.1:" + port + "/synthetic")
                    .post(OnlineNetwork.oneShot(RequestBody.create(MediaType.get("application/json"), "{}"))).build();
                try (Response response = client.newCall(request).execute()) { assertEquals(503, response.code()); }
                fixture.join(4000); assertFalse(fixture.isAlive()); assertNull(failure.get()); assertEquals(1, bodies.get());
            } finally {
                closing.set(true); server.close(); Socket socket = active.get(); if (socket != null) socket.close();
                client.connectionPool().evictAll(); client.dispatcher().executorService().shutdownNow();
                fixture.join(5000); assertFalse("Synthetic TLS fixture must stop", fixture.isAlive());
            }
        }
        } finally { keys.deleteEntry(alias); }
    }

    public void testDeepSeekJsonNonThinkingLimitAndGenericDoesNotReceiveProviderField() throws Exception {
        configure(priced()); JSONObject deepseek = OnlineNetwork.modelBody(d(UUID.randomUUID().toString()), settings.raw()); assertEquals("disabled", deepseek.getJSONObject("thinking").getString("type")); assertEquals(OnlineNetwork.MAX_OUTPUT_TOKENS, deepseek.getInt("max_tokens"));
        assertEquals("json_object", deepseek.getJSONObject("response_format").getString("type")); assertTrue(deepseek.getJSONArray("messages").getJSONObject(0).getString("content").contains("JSON"));
        settings.update(new JSONObject().put("expectedRevision", settings.get().getString("revision")).put("ai", new JSONObject().put("baseUrl", "https://provider.example.org/v1")));
        assertFalse(OnlineNetwork.modelBody(d(UUID.randomUUID().toString()), settings.raw()).has("thinking")); assertEquals("https://provider.example.org/v1/chat/completions", OnlineNetwork.endpoint("https://provider.example.org/v1", "chat/completions"));
    }
}
