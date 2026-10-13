package io.github.wmy5555.zhixu.sharedtest;

import android.test.AndroidTestCase;
import android.content.ContextWrapper;
import android.system.Os;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Disposable synthetic cache journals only; never the installed source/learning libraries. */
@SuppressWarnings("deprecation")
public class LocalSourceSyncStoreTest extends AndroidTestCase {
    private File root;
    private LocalSourceSyncStore store;
    private static final String SOURCE = "11111111-1111-4111-8111-111111111111";

    @Override protected void setUp() throws Exception {
        super.setUp(); root = new File(getContext().getCacheDir().getCanonicalFile(), "source-sync-test-" + UUID.randomUUID());
        store = new LocalSourceSyncStore(root, "formal");
    }
    @Override protected void tearDown() throws Exception { delete(root); super.tearDown(); }

    public void testInitializationAndReopenKeepPrivateIdentitiesAndRevision() throws Exception {
        JSONObject initial = store.load(); assertEquals("0", initial.getString("revision"));
        JSONObject reopened = new LocalSourceSyncStore(root, "formal").load(); assertEquals(initial.toString(), reopened.toString());
        JSONObject state = initial.getJSONObject("state");
        UUID.fromString(state.getString("replicaId")); UUID.fromString(state.getString("libraryId"));
        assertEquals(0, state.getJSONArray("events").length());
        expect("VALIDATION", () -> new LocalSourceSyncStore(root, "../formal"));
    }
    public void testTrustedFilesDirAliasWorksWithoutRelaxingPrivateChildSymlinkChecks() throws Exception {
        File target = new File(root, "synthetic-files"); assertTrue(target.mkdir());
        File alias = new File(root, "synthetic-system-alias"); Os.symlink(target.getPath(), alias.getPath());
        ContextWrapper application = new ContextWrapper(getContext()) {
            @Override public File getFilesDir() { return alias; }
        };
        try {
            LocalSourceSyncStore opened = new LocalSourceSyncStore(application, "formal");
            assertEquals(opened.load().toString(), new LocalSourceSyncStore(application, "formal").load().toString());
            File privateBase = new File(target, "local-source-sync-v1");
            File unrelated = new File(root, "synthetic-unrelated"); assertTrue(unrelated.mkdir());
            File privateAlias = new File(privateBase, "practice"); Os.symlink(unrelated.getPath(), privateAlias.getPath());
            try { expect("STORE_ERROR", () -> new LocalSourceSyncStore(application, "practice")); }
            finally { assertTrue(privateAlias.delete()); }
            assertEquals(0, unrelated.list().length);
        } finally { assertTrue(alias.delete()); }
    }
    public void testWholeJournalCASAcrossInstancesAndNoop() throws Exception {
        JSONObject initial = store.load(), state = append(initial.getJSONObject("state"), "合成第一版", "合成标题");
        LocalSourceSyncStore other = new LocalSourceSyncStore(root, "formal");
        JSONObject first = store.commit("0", state); assertEquals("1", first.getString("revision"));
        assertEquals(first.toString(), other.load().toString());
        assertEquals("1", other.commit("1", first.getJSONObject("state")).getString("revision"));
        JSONObject second = other.commit("1", append(first.getJSONObject("state"), "合成第二版", "合成标题"));
        expect("SYNC_STALE", () -> store.commit("1", state));
        assertEquals("2", second.getString("revision")); assertEquals(second.toString(), store.load().toString());
    }
    public void testSameProcessConcurrentInstancesSerializeCAS() throws Exception {
        JSONObject initial = store.load(); LocalSourceSyncStore other = new LocalSourceSyncStore(root, "formal");
        Throwable[] failures = new Throwable[2]; JSONObject[] results = new JSONObject[2];
        JSONObject left = append(initial.getJSONObject("state"), "合成左", "标题"), right = append(initial.getJSONObject("state"), "合成右", "标题");
        Thread a = new Thread(() -> { try { results[0] = store.commit("0", left); } catch (Throwable e) { failures[0] = e; } });
        Thread b = new Thread(() -> { try { results[1] = other.commit("0", right); } catch (Throwable e) { failures[1] = e; } });
        a.start(); b.start(); a.join(); b.join();
        assertTrue((results[0] == null) != (results[1] == null));
        Throwable failure = failures[0] == null ? failures[1] : failures[0]; assertTrue(failure instanceof LocalSourceStore.StoreException);
        assertEquals("SYNC_STALE", ((LocalSourceStore.StoreException) failure).code); assertEquals("1", store.load().getString("revision"));
    }
    public void testRevisionLongBoundaryAndMalformedRevisionNeverWrap() throws Exception {
        JSONObject initial = store.load(), next = append(initial.getJSONObject("state"), "合成正文", "标题");
        for (String revision : new String[] { "01", "-1", "1.0", "9223372036854775808" }) {
            expect("SYNC_INVALID", () -> store.commit(revision, next));
        }
        File main = new File(root, "formal/journal.json");
        String raw;
        try (java.io.FileInputStream input = new java.io.FileInputStream(main)) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count); raw = bytes.toString("UTF-8");
        }
        write(main, raw.replace("\"revision\":\"0\"", "\"revision\":\"9223372036854775807\""));
        JSONObject loaded = store.load(); assertEquals("9223372036854775807", loaded.getString("revision"));
        assertEquals(loaded.toString(), store.commit(loaded.getString("revision"), loaded.getJSONObject("state")).toString());
        expect("SYNC_LIMIT", () -> store.commit(loaded.getString("revision"), next)); assertEquals(loaded.toString(), store.load().toString());
    }
    public void testTombstonesAndOriginalTextCannotBePrunedOrRewritten() throws Exception {
        JSONObject initial = store.load(), state = append(initial.getJSONObject("state"), "原始合成正文", "标题");
        state = append(state, null, "unused"); JSONObject saved = store.commit("0", state);
        JSONArray events = saved.getJSONObject("state").getJSONArray("events");
        assertEquals(2, events.length()); assertEquals("delete", events.getJSONObject(1).getString("operation"));
        assertEquals("原始合成正文", events.getJSONObject(0).getJSONObject("value").getString("body"));
        JSONObject pruned = copy(saved.getJSONObject("state")).put("events", new JSONArray());
        expect("SYNC_INVALID", () -> store.commit("1", pruned));
        JSONObject rewritten = copy(saved.getJSONObject("state")); rewritten.getJSONArray("events").getJSONObject(0).getJSONObject("value").put("body", "改写历史");
        expect("SYNC_INVALID", () -> store.commit("1", rewritten)); assertEquals(saved.toString(), store.load().toString());
    }
    public void testPreCommitFailuresLeaveOldAuthorityAndAfterCommitFailureCanBeReadBack() throws Exception {
        JSONObject initial = store.load(), next = append(initial.getJSONObject("state"), "完整合成批次", "标题");
        next = append(next, "第二条整批内容", "标题"); final JSONObject intended = next;
        for (String stage : new String[] { "before-install", "before-atomic-finish" }) {
            store.setFailurePoint(at -> { if (stage.equals(at)) throw new IOException("synthetic " + stage); });
            expect("STORE_ERROR", () -> store.commit("0", intended));
            assertEquals(initial.toString(), new LocalSourceSyncStore(root, "formal").load().toString());
        }
        store.setFailurePoint(at -> { if ("after-install".equals(at)) throw new IOException("synthetic lost response"); });
        expect("SYNC_COMMIT_UNKNOWN", () -> store.commit("0", intended));
        JSONObject recovered = new LocalSourceSyncStore(root, "formal").load();
        assertEquals("1", recovered.getString("revision")); assertEquals(2, recovered.getJSONObject("state").getJSONArray("events").length());
        assertEquals(intended.toString(), recovered.getJSONObject("state").toString());
        store.setFailurePoint(null); expect("SYNC_STALE", () -> store.commit("0", intended));
    }
    public void testUncommittedNewFileCannotBecomeLoadAuthorityAndBackupRecoveryRetainsIdentity() throws Exception {
        JSONObject initial = store.load(); File main = new File(root, "formal/journal.json");
        File staging = new File(root, "formal/journal.json.new"); write(staging, "not a committed journal");
        assertEquals(initial.toString(), store.load().toString());
        File backup = new File(root, "formal/journal.json.bak"); assertTrue(main.renameTo(backup));
        write(main, "broken uncommitted main");
        assertEquals(initial.toString(), new LocalSourceSyncStore(root, "formal").load().toString());
        assertFalse(backup.exists());
    }
    public void testContextAndStableIdentitiesCannotLeakOrBeChanged() throws Exception {
        JSONObject initial = store.load(), practice = new LocalSourceSyncStore(root, "practice").load();
        assertFalse(initial.getJSONObject("state").getString("libraryId").equals(practice.getJSONObject("state").getString("libraryId")));
        expect("SYNC_SCOPE", () -> store.commit("0", practice.getJSONObject("state")));
        for (String key : new String[] { "libraryId", "replicaId" }) {
            JSONObject forged = copy(initial.getJSONObject("state")).put(key, UUID.randomUUID().toString());
            expect("SYNC_INVALID", () -> store.commit("0", forged));
        }
        JSONObject saved = store.commit("0", append(initial.getJSONObject("state"), "仅正式合成资料", "标题"));
        assertEquals(1, saved.getJSONObject("state").getJSONArray("events").length());
        assertEquals(practice.toString(), new LocalSourceSyncStore(root, "practice").load().toString());
    }
    public void testCorruptOrDeepJSONNeverResetsJournalOrAcceptsStaging() throws Exception {
        File main = new File(root, "formal/journal.json");
        String deep = repeat("[", 20) + "0" + repeat("]", 20); write(main, deep);
        expect("SYNC_LIMIT", () -> store.load()); expect("SYNC_LIMIT", () -> new LocalSourceSyncStore(root, "formal"));
        assertTrue(main.exists());
        write(main, "{\"revision\":\"0\",\"revision\":\"1\",\"state\":null}");
        expect("SYNC_INVALID", () -> store.load());
        assertTrue(main.exists()); assertFalse(new File(root, "practice").exists());
    }
    public void testNativeSchemaRejectsUnsafeBodiesAndAcceptsLegacyEmojiTitlesExactly() throws Exception {
        JSONObject initial = store.load();
        for (String body : new String[] { "", " \t\n\u00a0\u1680\u2000\u202f\u205f\u3000", "a\0b" }) {
            expect("SYNC_INVALID", () -> store.commit("0", append(initial.getJSONObject("state"), body, "标题")));
        }
        for (String body : new String[] { "\ufeff", "\u0085", "\u0001" }) {
            String title = repeat("😀", 200);
            JSONObject current = store.load(), state = append(current.getJSONObject("state"), body, title);
            JSONObject saved = store.commit(current.getString("revision"), state);
            JSONObject last = saved.getJSONObject("state").getJSONArray("events").getJSONObject(state.getJSONArray("events").length() - 1).getJSONObject("value");
            assertEquals(title, last.getString("title")); assertEquals(body, last.getString("body"));
        }
        JSONObject current = store.load();
        for (String title : new String[] { repeat("中", 201), repeat("😀", 201), "\ud800", "\udc00", "\u00a0标题", "标题\ufeff" }) {
            try { store.commit(current.getString("revision"), append(current.getJSONObject("state"), "合成正文", title)); fail("invalid title accepted"); }
            catch (LocalSourceStore.StoreException expected) { /* malformed Unicode is rejected by the shared UTF-8 validator */ }
        }
        JSONObject unknown = append(current.getJSONObject("state"), "合成正文", "标题"); unknown.getJSONArray("events").getJSONObject(3).put("permission", true);
        expect("SYNC_INVALID", () -> store.commit(current.getString("revision"), unknown));
        JSONObject gap = append(current.getJSONObject("state"), "合成正文", "标题"); gap.getJSONArray("events").getJSONObject(3).put("parents", new JSONArray());
        expect("SYNC_GAP", () -> store.commit(current.getString("revision"), gap)); assertEquals(current.toString(), store.load().toString());
    }
    public void testCapsRejectEventSourceAndEscapedByteOverflowWithoutDiscardingJournal() throws Exception {
        JSONObject initial = store.load(), state = append(initial.getJSONObject("state"), "合成正文", "标题");
        JSONObject first = state.getJSONArray("events").getJSONObject(0); String replica = state.getString("replicaId");
        JSONArray many = new JSONArray(); for (int i = 0; i < 2001; i++) many.put(first);
        JSONObject overflow = copy(state).put("events", many); expect("SYNC_LIMIT", () -> store.commit("0", overflow));
        JSONArray sources = new JSONArray();
        for (int i = 0; i < 101; i++) sources.put(copy(first).put("id", replica + ":" + (i + 1)).put("sequence", i + 1).put("sourceId", String.format(java.util.Locale.ROOT, "%08x-1111-4111-8111-111111111111", i)));
        JSONObject sourceOverflow = copy(state).put("events", sources); expect("SYNC_LIMIT", () -> store.commit("0", sourceOverflow));
        JSONArray replicas = new JSONArray();
        for (int i = 0; i < 33; i++) {
            String peer = String.format(java.util.Locale.ROOT, "%08x-1111-4111-8111-111111111111", i);
            replicas.put(copy(first).put("id", peer + ":1").put("replicaId", peer));
        }
        JSONObject replicaOverflow = copy(state).put("events", replicas); expect("SYNC_LIMIT", () -> store.commit("0", replicaOverflow));
        JSONArray huge = new JSONArray();
        for (int i = 0; i < 43; i++) {
            JSONObject item = copy(first).put("id", replica + ":" + (i + 1)).put("sequence", i + 1)
                .put("parents", i == 0 ? new JSONArray() : new JSONArray().put(replica + ":" + i));
            item.getJSONObject("value").put("body", repeat("\u0001", 128 * 1024)); huge.put(item);
        }
        JSONObject journalOverflow = copy(state).put("events", huge); expect("SYNC_LIMIT", () -> store.commit("0", journalOverflow));
        assertEquals(initial.toString(), store.load().toString());
    }
    public void testSourcePreviewCreatesSameUuidAndRepeatedPreviewDoesNotAddHistory() throws Exception {
        try (LocalSourceStore sources = syntheticSources()) {
            JSONObject snapshot = putJournal(store, "已核对的合成原文", "合成标题");
            JSONObject value = snapshot.getJSONObject("state").getJSONArray("events").getJSONObject(0).getJSONObject("value");
            expect("NOT_FOUND", () -> sources.save(new JSONObject().put("id", SOURCE).put("title", "标题").put("body", "正文")));
            JSONObject preview = store.sourcePreview(sources, SOURCE); assertTrue(preview.getBoolean("canApply")); assertTrue(preview.isNull("original"));
            JSONObject applied = store.sourceApply(sources, preview.getString("token"));
            assertEquals(SOURCE, applied.getJSONObject("note").getString("id")); assertFalse(applied.getBoolean("unchanged"));
            assertEquals(value.getString("body"), sources.read(SOURCE).getString("body"));
            expect("SYNC_STALE", () -> store.sourceApply(sources, preview.getString("token")));
            JSONObject repeated = store.sourcePreview(sources, SOURCE); assertTrue(repeated.getBoolean("identical"));
            assertFalse(repeated.getBoolean("canApply")); assertTrue(repeated.isNull("token")); assertEquals(1, sources.history(SOURCE).length());
            assertEquals(snapshot.toString(), store.load().toString()); // Apply neither commits the journal nor ACKs a cursor.
        }
    }
    public void testSourceApplyArchivesExistingBodyAndPreservesLocalPrivacyMeta() throws Exception {
        try (LocalSourceStore sources = syntheticSources()) {
            JSONObject current = store.load(), state = append(current.getJSONObject("state"), "同步新版合成正文", "同步新版标题");
            JSONObject incoming = state.getJSONArray("events").getJSONObject(0).getJSONObject("value").getJSONObject("source");
            for (String key : new String[] { "platform", "author", "url", "date", "locator", "topic" }) incoming.put(key, "合成-" + key);
            incoming.put("url", "https://example.org/synthetic-sync-source");
            JSONObject snapshot = store.commit(current.getString("revision"), state);
            JSONObject oldValue = sourceValue("原本的合成正文", "旧标题"); oldValue.getJSONObject("source").put("author", "原作者");
            JSONObject old = sources.saveSynced(SOURCE, oldValue, null);
            assertEquals("local", old.getJSONObject("meta").getString("privacy"));
            JSONObject preview = store.sourcePreview(sources, SOURCE); assertEquals(old.getString("hash"), preview.getJSONObject("original").getString("hash"));
            JSONObject result = store.sourceApply(sources, preview.getString("token")), note = result.getJSONObject("note");
            assertEquals("同步新版合成正文", note.getString("body")); assertEquals("local", note.getJSONObject("meta").getString("privacy"));
            assertEquals("reference", note.getJSONObject("meta").getString("stage"));
            for (String key : new String[] { "platform", "author", "url", "date", "locator", "topic" }) assertEquals(incoming.getString(key), note.getJSONObject("meta").getString(key));
            JSONArray history = sources.history(SOURCE); assertEquals(2, history.length());
            assertEquals("原本的合成正文", history.getJSONObject(0).getString("body"));
            assertEquals(snapshot.toString(), store.load().toString());
        }
    }
    public void testSourceOrJournalChangesInvalidateApplyWithoutOverwritingUserEdit() throws Exception {
        try (LocalSourceStore sources = syntheticSources()) {
            putJournal(store, "同步候选合成正文", "标题");
            JSONObject old = sources.saveSynced(SOURCE, sourceValue("原文旧正文", "标题"), null);
            JSONObject preview = store.sourcePreview(sources, SOURCE);
            JSONObject edited = sources.save(new JSONObject().put("id", SOURCE).put("expectedHash", old.getString("hash")).put("title", "用户改的标题").put("body", "用户保留的正文"));
            expect("SYNC_STALE", () -> store.sourceApply(sources, preview.getString("token")));
            assertEquals(edited.getString("hash"), sources.read(SOURCE).getString("hash"));
            JSONObject another = store.sourcePreview(sources, SOURCE), current = store.load();
            store.commit(current.getString("revision"), append(current.getJSONObject("state"), "日记新候选", "标题"));
            expect("SYNC_STALE", () -> store.sourceApply(sources, another.getString("token")));
            assertEquals(edited.getString("hash"), sources.read(SOURCE).getString("hash"));
        }
    }
    public void testConflictDeleteAndLegacyLongTitleHaveNoApplyToken() throws Exception {
        try (LocalSourceStore sources = syntheticSources()) {
            JSONObject snapshot = putJournal(store, "合成一端正文", "标题"), state = copy(snapshot.getJSONObject("state"));
            String peer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
            JSONObject branch = copy(state.getJSONArray("events").getJSONObject(0)).put("id", peer + ":1").put("replicaId", peer).put("sequence", 1);
            branch.getJSONObject("value").put("body", "另一端合成分支"); state.getJSONArray("events").put(branch);
            store.commit(snapshot.getString("revision"), state);
            JSONObject conflict = store.sourcePreview(sources, SOURCE); assertEquals(2, conflict.getJSONArray("heads").length());
            assertFalse(conflict.getBoolean("canApply")); assertTrue(conflict.isNull("token"));
            LocalSourceSyncStore deleted = new LocalSourceSyncStore(new File(root, "delete-journal"), "formal");
            JSONObject deletion = putJournal(deleted, null, "unused"), deletionPreview = deleted.sourcePreview(sources, SOURCE);
            assertFalse(deletionPreview.getBoolean("canApply")); assertTrue(deletionPreview.isNull("token")); assertTrue(deletionPreview.getString("reason").contains("删除"));
            LocalSourceSyncStore legacy = new LocalSourceSyncStore(new File(root, "legacy-journal"), "formal");
            putJournal(legacy, "合成旧正文", repeat("😀", 200)); JSONObject longTitle = legacy.sourcePreview(sources, SOURCE);
            assertFalse(longTitle.getBoolean("canApply")); assertTrue(longTitle.isNull("token")); assertTrue(longTitle.getString("reason").contains("不会裁剪"));
            assertEquals(0, sources.list("").length()); assertEquals(deletion.toString(), deleted.load().toString());
        }
    }
    public void testPreviewExpiryReopenAndPracticeScopeNeverReuseToken() throws Exception {
        try (LocalSourceStore sources = syntheticSources()) {
            putJournal(store, "合成候选", "标题"); long[] now = { 1000 }; store.setPreviewClockForTests(() -> now[0]);
            JSONObject preview = store.sourcePreview(sources, SOURCE); now[0] += 5 * 60 * 1000;
            expect("SYNC_STALE", () -> store.sourceApply(sources, preview.getString("token")));
            JSONObject fresh = store.sourcePreview(sources, SOURCE);
            LocalSourceSyncStore reopened = new LocalSourceSyncStore(root, "formal");
            expect("SYNC_STALE", () -> reopened.sourceApply(sources, fresh.getString("token")));
            LocalSourceSyncStore practice = new LocalSourceSyncStore(root, "practice");
            expect("SYNC_SCOPE", () -> practice.sourcePreview(sources, SOURCE));
            expect("SYNC_SCOPE", () -> practice.sourceApply(sources, fresh.getString("token")));
            assertEquals(0, sources.list("").length());
        }
    }
    public void testPreviewTokenCapAndExistingPathEvidenceProtectAbsentSource() throws Exception {
        try (LocalSourceStore sources = syntheticSources()) {
            putJournal(store, "合成候选", "标题");
            File staging = new File(root, "synthetic-sources/notes/" + SOURCE + ".md.new"); write(staging, "不明合成暂存");
            JSONObject blocked = store.sourcePreview(sources, SOURCE); assertFalse(blocked.getBoolean("canApply")); assertTrue(blocked.isNull("token"));
            assertTrue(staging.delete()); long[] now = { 100 }; store.setPreviewClockForTests(() -> now[0]);
            for (int i = 0; i < 100; i++) assertTrue(store.sourcePreview(sources, SOURCE).getBoolean("canApply"));
            JSONObject full = store.sourcePreview(sources, SOURCE); assertFalse(full.getBoolean("canApply")); assertTrue(full.isNull("token"));
            now[0] += 5 * 60 * 1000; assertTrue(store.sourcePreview(sources, SOURCE).getBoolean("canApply")); assertEquals(0, sources.list("").length());
        }
    }
    private LocalSourceStore syntheticSources() throws Exception { return new LocalSourceStore(new File(root, "synthetic-sources")); }
    private static JSONObject putJournal(LocalSourceSyncStore journal, String body, String title) throws Exception {
        JSONObject current = journal.load(); return journal.commit(current.getString("revision"), append(current.getJSONObject("state"), body, title));
    }
    private static JSONObject sourceValue(String body, String title) throws Exception {
        JSONObject provenance = new JSONObject(); for (String key : new String[] { "platform", "author", "url", "date", "locator", "topic" }) provenance.put(key, "");
        return new JSONObject().put("title", title).put("body", body).put("source", provenance);
    }
    private static JSONObject append(JSONObject original, String body, String title) throws Exception {
        JSONObject state = copy(original); JSONArray events = state.getJSONArray("events"); String replica = state.getString("replicaId");
        int sequence = events.length() + 1; JSONArray parents = new JSONArray(); if (sequence > 1) parents.put(replica + ":" + (sequence - 1));
        Object value = JSONObject.NULL;
        if (body != null) {
            JSONObject provenance = new JSONObject(); for (String key : new String[] { "platform", "author", "url", "date", "locator", "topic" }) provenance.put(key, "");
            value = new JSONObject().put("title", title).put("body", body).put("source", provenance);
        }
        events.put(new JSONObject().put("id", replica + ":" + sequence).put("replicaId", replica).put("sequence", sequence)
            .put("sourceId", SOURCE).put("parents", parents).put("operation", body == null ? "delete" : "put").put("value", value)); return state;
    }
    private static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
    private static String repeat(String value, int count) { StringBuilder out = new StringBuilder(); for (int i = 0; i < count; i++) out.append(value); return out.toString(); }
    private interface Action { void run() throws Exception; }
    private void expect(String code, Action action) throws Exception {
        try { action.run(); fail("Expected " + code); } catch (LocalSourceStore.StoreException e) { assertEquals(code, e.code); }
    }
    private static void write(File file, String text) throws IOException { try (FileOutputStream output = new FileOutputStream(file)) { output.write(text.getBytes(StandardCharsets.UTF_8)); output.getFD().sync(); } }
    private static void delete(File file) throws IOException {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) { File[] children = file.listFiles(); if (children == null) throw new IOException("Cannot list test directory"); for (File child : children) delete(child); }
        if (!file.delete()) throw new IOException("Cannot delete synthetic test path");
    }
}
