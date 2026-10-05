package io.github.wmy5555.zhixu.test;

import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.Arrays;

final class LibraryStore {
    static final int MAX_BYTES = 8 * 1024 * 1024;
    static final String FORMAT = "zhixu-mobile-sync";
    private final AtomicFile file;
    private JSONObject data;
    private static LibraryStore active;

    static synchronized LibraryStore open(File directory) throws Exception {
        if (active == null) active = new LibraryStore(directory);
        return active;
    }

    private LibraryStore(File directory) throws Exception {
        file = new AtomicFile(new File(directory, "library.json"));
        if (file.getBaseFile().exists() || new File(file.getBaseFile() + ".bak").exists()) {
            data = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
        } else data = new JSONObject().put("version", 1).put("libraryId", "").put("notes", new JSONArray());
        if (data.getInt("version") != 1) throw new Exception("本地资料库版本不支持，未覆盖文件。");
    }

    synchronized JSONArray all() throws Exception { return new JSONArray(data.getJSONArray("notes").toString()); }
    synchronized JSONObject get(String id) throws Exception {
        for (int i = 0; i < data.getJSONArray("notes").length(); i++) {
            JSONObject note = data.getJSONArray("notes").getJSONObject(i);
            if (note.getString("id").equals(id)) return new JSONObject(note.toString());
        }
        throw new Exception("资料不存在。");
    }

    private void commit(JSONObject next) throws Exception {
        byte[] bytes = next.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new Exception("本地测试资料超过 8 MiB，请先导出保留副本。");
        FileOutputStream stream = file.startWrite();
        try { stream.write(bytes); file.finishWrite(stream); data = next; }
        catch (Exception error) { file.failWrite(stream); throw error; }
    }

    synchronized String save(String id, String title, String body) throws Exception {
        if (title.trim().isEmpty() || title.length() > 200 || body.trim().isEmpty() || body.length() > 500000)
            throw new Exception("标题须为 1–200 字，正文须为 1–500000 字。");
        JSONObject next = new JSONObject(data.toString()), note;
        if (id == null) {
            if (next.getJSONArray("notes").length() >= 100) throw new Exception("个人测试版最多保存 100 条资料。");
            id = UUID.randomUUID().toString();
            note = new JSONObject().put("id", id).put("desktopId", "").put("baseHash", "")
                .put("kind", "source").put("stage", "reference").put("privacy", "local").put("readOnly", false);
            next.getJSONArray("notes").put(note);
        } else {
            note = find(next.getJSONArray("notes"), id);
            if (!note.getString("kind").equals("source")) throw new Exception("学习知识只读，请在电脑端维护。");
            if (note.has("conflict")) throw new Exception("请先处理双方修改冲突。");
            if (title.equals(note.getString("title")) && body.equals(note.getString("body"))) return id;
        }
        note.put("title", title).put("body", body).put("dirty", true);
        commit(next);
        return id;
    }

    private static JSONObject find(JSONArray notes, String id) throws Exception {
        for (int i = 0; i < notes.length(); i++) if (notes.getJSONObject(i).getString("id").equals(id)) return notes.getJSONObject(i);
        throw new Exception("资料不存在。");
    }

    private static JSONObject cleanSnapshot(JSONObject raw) throws Exception {
        String id = raw.getString("id"), desktopId = raw.getString("desktopId"), baseHash = raw.getString("baseHash");
        String kind = raw.getString("kind"), title = raw.getString("title"), body = raw.getString("body");
        var kinds = Arrays.asList("source", "knowledge", "mistake", "topic", "report");
        if (!id.matches("[a-zA-Z0-9_-]{1,100}") || !desktopId.matches("[a-zA-Z0-9_-]{1,100}")
            || !baseHash.matches("[a-f0-9]{64}") || !kinds.contains(kind) || raw.getBoolean("dirty")
            || title.trim().isEmpty() || title.length() > 200 || body.trim().isEmpty() || body.length() > 500000)
            throw new Exception("电脑交换文件包含无效资料，未导入。");
        return new JSONObject().put("id", id).put("desktopId", desktopId).put("baseHash", baseHash)
            .put("kind", kind).put("title", title).put("body", body).put("dirty", false)
            .put("stage", raw.optString("stage", "reference")).put("privacy", "local").put("readOnly", !kind.equals("source"));
    }

    synchronized int merge(byte[] bytes) throws Exception {
        if (bytes.length > MAX_BYTES) throw new Exception("交换文件超过 8 MiB。");
        JSONObject incoming = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        String libraryId = incoming.getString("libraryId");
        if (!FORMAT.equals(incoming.getString("format")) || incoming.getInt("version") != 1
            || !libraryId.matches("[a-zA-Z0-9_-]{1,100}") || incoming.getJSONArray("notes").length() > 100)
            throw new Exception("不是支持的电脑资料交换文件。");
        if (!data.getString("libraryId").isEmpty() && !data.getString("libraryId").equals(libraryId))
            throw new Exception("文件属于另一知识库，未导入。测试版一次只绑定一个知识库。");
        JSONArray clean = new JSONArray();
        Set<String> ids = new HashSet<>(), desktops = new HashSet<>();
        for (int i = 0; i < incoming.getJSONArray("notes").length(); i++) {
            JSONObject note = cleanSnapshot(incoming.getJSONArray("notes").getJSONObject(i));
            if (!ids.add(note.getString("id")) || !desktops.add(note.getString("desktopId"))) throw new Exception("交换文件有重复资料身份。");
            clean.put(note);
        }
        JSONObject next = new JSONObject(data.toString());
        JSONArray notes = next.getJSONArray("notes");
        for (int i = 0; i < clean.length(); i++) {
            JSONObject remote = clean.getJSONObject(i), local = null;
            int index = -1;
            for (int j = 0; j < notes.length(); j++) {
                JSONObject candidate = notes.getJSONObject(j);
                if (candidate.getString("id").equals(remote.getString("id"))
                    || !candidate.getString("desktopId").isEmpty() && candidate.getString("desktopId").equals(remote.getString("desktopId"))) {
                    if (local != null) throw new Exception("本机资料身份冲突，未导入。");
                    local = candidate; index = j;
                }
            }
            if (local == null) { notes.put(remote); continue; }
            if (!local.getString("desktopId").isEmpty() && !local.getString("desktopId").equals(remote.getString("desktopId")))
                throw new Exception("资料身份不匹配，未导入。");
            // Preserve phone identity when the desktop refresh uses its own note ID.
            remote.put("id", local.getString("id"));
            if (!local.getString("kind").equals(remote.getString("kind"))) throw new Exception("资料类型已改变，请在电脑端核对。");
            SyncRules.Decision decision = SyncRules.decide(local.getBoolean("dirty"), local.getString("baseHash"),
                remote.getString("baseHash"), local.getString("title"), local.getString("body"), remote.getString("title"), remote.getString("body"));
            if (decision == SyncRules.Decision.USE_REMOTE || decision == SyncRules.Decision.ACKNOWLEDGED) notes.put(index, remote);
            else if (decision == SyncRules.Decision.CONFLICT) local.put("conflict", remote);
        }
        if (notes.length() > 100) throw new Exception("合并后超过 100 条测试资料，未导入。");
        JSONArray results = incoming.optJSONArray("results");
        if (results != null) {
            if (results.length() > 100) throw new Exception("回执数量超过限制。");
            for (int i = 0; i < results.length(); i++) {
                JSONObject result = results.getJSONObject(i);
                if (!result.optString("status").equals("conflict")) continue;
                try {
                    JSONObject local = find(notes, result.getString("id"));
                    String reason = result.optString("reason", "电脑未保存此修改，请在电脑端核对。");
                    local.put("syncIssue", reason.substring(0, Math.min(reason.length(), 300)));
                } catch (Exception missing) { /* Receipts for other selections do not change local notes. */ }
            }
        }
        next.put("libraryId", libraryId);
        commit(next);
        return clean.length();
    }

    synchronized void resolve(String id, boolean keepPhoneAsCopy) throws Exception {
        JSONObject next = new JSONObject(data.toString());
        JSONObject note = find(next.getJSONArray("notes"), id), remote = note.getJSONObject("conflict");
        if (keepPhoneAsCopy) {
            if (next.getJSONArray("notes").length() >= 100) throw new Exception("资料数量已达上限，请先导出副本。");
            JSONObject copy = new JSONObject().put("id", UUID.randomUUID().toString()).put("desktopId", "").put("baseHash", "")
                .put("kind", "source").put("stage", "reference").put("privacy", "local").put("readOnly", false)
                .put("title", note.getString("title")).put("body", note.getString("body")).put("dirty", true);
            next.getJSONArray("notes").put(copy);
        }
        JSONArray notes = next.getJSONArray("notes");
        for (int i = 0; i < notes.length(); i++) if (notes.getJSONObject(i).getString("id").equals(id)) notes.put(i, remote);
        commit(next);
    }

    synchronized byte[] export() throws Exception {
        JSONArray exported = new JSONArray(), notes = data.getJSONArray("notes");
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = new JSONObject(notes.getJSONObject(i).toString());
            if (note.has("conflict")) throw new Exception("有未处理冲突，请先采用电脑版本或将手机版本另存为新资料。");
            note.remove("conflict"); exported.put(note);
        }
        return new JSONObject().put("format", FORMAT).put("version", 1).put("libraryId", data.getString("libraryId"))
            .put("notes", exported).toString().getBytes(StandardCharsets.UTF_8);
    }
}
