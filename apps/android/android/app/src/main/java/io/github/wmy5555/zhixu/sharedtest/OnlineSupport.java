package io.github.wmy5555.zhixu.sharedtest;

import android.system.Os;
import android.system.OsConstants;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Private bounded atomic files and canonical SHA-256; no arbitrary web paths. */
final class OnlineSupport {
    static final Object LOCK = new Object();
    static final class Failure extends Exception {
        final String code;
        Failure(String code, String message) { super(message); this.code = code; }
    }
    static Failure fail(String code, String message) { return new Failure(code, message); }
    static void fields(JSONObject o, String... allowed) throws Failure {
        Set<String> names = new HashSet<>(Arrays.asList(allowed));
        for (Iterator<String> keys = o.keys(); keys.hasNext();) if (!names.contains(keys.next())) throw fail("INVALID_INPUT", "请求包含不受支持的字段。");
    }
    static String text(JSONObject o, String key, int max, boolean empty) throws Failure {
        Object v = o.opt(key);
        if (!(v instanceof String)) throw fail("INVALID_INPUT", "请求文本格式不正确。");
        String s = (String) v;
        if (s.indexOf('\0') >= 0 || s.getBytes(StandardCharsets.UTF_8).length > max || !empty && s.trim().isEmpty()) throw fail("INVALID_INPUT", "请求文本为空或过长。");
        return s;
    }
    static String id(JSONObject o, String key) throws Failure {
        String s = text(o, key, 128, false);
        if (!s.matches("[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")) throw fail("INVALID_INPUT", "请求标识格式不正确。");
        return s;
    }
    static boolean bool(JSONObject o, String key) throws Failure {
        if (!(o.opt(key) instanceof Boolean)) throw fail("INVALID_INPUT", "开关格式不正确。");
        return o.optBoolean(key);
    }
    static JSONObject copy(JSONObject o) throws JSONException { return new JSONObject(o.toString()); }
    static String canonical(Object v) throws Exception { return canonical(v, 0); }
    private static String canonical(Object v, int depth) throws Exception {
        if (depth > 20) throw fail("INVALID_INPUT", "请求内容嵌套过深。");
        if (v instanceof JSONObject) {
            JSONObject o = (JSONObject) v; List<String> keys = new ArrayList<>(); o.keys().forEachRemaining(keys::add); Collections.sort(keys);
            StringBuilder b = new StringBuilder("{");
            for (String k : keys) { if (b.length() > 1) b.append(','); b.append(JSONObject.quote(k)).append(':').append(canonical(o.get(k), depth + 1)); }
            return b.append('}').toString();
        }
        if (v instanceof JSONArray) {
            JSONArray a = (JSONArray) v; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.length(); i++) { if (i > 0) b.append(','); b.append(canonical(a.get(i), depth + 1)); }
            return b.append(']').toString();
        }
        if (v == null || v == JSONObject.NULL) return "null";
        if (v instanceof String) return JSONObject.quote((String) v);
        if (v instanceof Boolean) return v.toString();
        if (v instanceof Number) { double n = ((Number) v).doubleValue(); if (!Double.isFinite(n)) throw fail("INVALID_INPUT", "无效数值。"); return JSONObject.numberToString((Number) v); }
        throw fail("INVALID_INPUT", "不受支持的内容。");
    }
    static String sha(String s) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder b = new StringBuilder(); for (byte v : bytes) b.append(String.format(Locale.ROOT, "%02x", v & 255)); return b.toString();
    }
    static File child(File root, String name) throws Exception {
        File f = new File(root, name);
        if (!f.getCanonicalFile().equals(f.getAbsoluteFile()) || !f.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())) throw fail("STORE_ERROR", "在线存储路径不安全。");
        if (f.exists() && !f.isFile()) throw fail("STORE_ERROR", "在线存储文件不安全。");
        return f;
    }
    static void directory(File root) throws Exception {
        if (!root.getAbsoluteFile().equals(root.getCanonicalFile())) throw fail("STORE_ERROR", "在线存储路径不安全。");
        if (!root.isDirectory() && !root.mkdirs()) throw fail("STORE_ERROR", "无法创建在线存储。");
        syncDir(root.getParentFile());
    }
    static byte[] read(File f, int max) throws Exception {
        child(f.getParentFile(), f.getName());
        for (String suffix : new String[] {".bak", ".new"}) child(f.getParentFile(), f.getName() + suffix);
        try (InputStream in = new AtomicFile(f).openRead()) { return bounded(in, max); }
    }
    static byte[] bounded(InputStream in, int max) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf, 0, Math.min(buf.length, max - out.size() + 1))) != -1) {
            if (n == 0) continue; out.write(buf, 0, n); if (out.size() > max) throw fail("TOO_LARGE", "内容超出手机联网读取上限。");
        }
        return out.toByteArray();
    }
    static void write(File f, byte[] bytes) throws Exception {
        child(f.getParentFile(), f.getName()); for (String suffix : new String[] {".bak", ".new"}) child(f.getParentFile(), f.getName() + suffix);
        AtomicFile a = new AtomicFile(f); FileOutputStream out = null;
        try { out = a.startWrite(); out.write(bytes); out.getFD().sync(); a.finishWrite(out); out = null; syncDir(f.getParentFile());
            if (!Arrays.equals(bytes, read(f, bytes.length + 1))) throw new IOException("Atomic readback failed");
        } catch (Exception e) { if (out != null) a.failWrite(out); throw e; }
    }
    static void syncDir(File root) throws Exception {
        if (!root.getAbsoluteFile().equals(root.getCanonicalFile()) || !root.isDirectory()) throw fail("STORE_ERROR", "在线存储目录不安全。");
        java.io.FileDescriptor fd = Os.open(root.getAbsolutePath(), OsConstants.O_RDONLY, 0);
        try { Os.fsync(fd); } finally { Os.close(fd); }
    }
    static String at(long now) { return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT) {{ setTimeZone(TimeZone.getTimeZone("UTC")); }}.format(new Date(now)); }
}
