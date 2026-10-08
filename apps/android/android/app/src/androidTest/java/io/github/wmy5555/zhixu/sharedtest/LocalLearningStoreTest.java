package io.github.wmy5555.zhixu.sharedtest;

import android.system.Os;
import android.test.AndroidTestCase;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Disposable app-cache fixtures only. No installed learning library or network is used. */
@SuppressWarnings("deprecation")
public class LocalLearningStoreTest extends AndroidTestCase {
    private File root;
    private LocalLearningStore formal;

    @Override protected void setUp() throws Exception {
        super.setUp();
        root = new File(getContext().getCacheDir().getCanonicalFile(), "learning-store-test-" + UUID.randomUUID());
        formal = new LocalLearningStore(root, "formal");
    }

    @Override protected void tearDown() throws Exception {
        if (root != null) deleteTestTree(root);
        super.tearDown();
    }

    public void testEmptyRevisionStableAndMarkdownRuntimeReopenTogether() throws Exception {
        JSONObject initial = formal.load();
        assertEquals("empty", initial.getString("revision"));
        assertEquals(initial.toString(), new LocalLearningStore(root, "formal").load().toString());
        JSONObject note = note("knowledge", "概念", "# 合成 Markdown\n\n末行保留空格  \n", "js-version-opaque");
        JSONObject state = state(note);
        state.getJSONObject("records").put(note.getString("id"), new JSONObject().put("answer", "保留回答").put("finished", true));
        state.getJSONObject("settings").put("dailyLimit", 6);
        state.getJSONObject("guide").put("step", "study");
        JSONObject saved = formal.commit("empty", state);
        assertFalse("empty".equals(saved.getString("revision")));
        JSONObject reopened = new LocalLearningStore(root, "formal").load();
        assertEquals(saved.toString(), reopened.toString());
        JSONObject restoredNote = reopened.getJSONObject("state").getJSONArray("notes").getJSONObject(0);
        assertEquals("js-version-opaque", restoredNote.getString("hash"));
        assertEquals(note.getString("body"), restoredNote.getString("body"));
        assertTrue(reopened.getJSONObject("state").getJSONObject("records").getJSONObject(note.getString("id")).getBoolean("finished"));
        JSONObject document = formal.backup().getJSONArray("documents").getJSONObject(0);
        assertTrue(document.getString("raw").startsWith("---\n{"));
        assertTrue(document.getString("raw").endsWith(note.getString("body")));
        assertTrue(document.getString("file").matches("[0-9a-f]{64}\\.md"));
        assertFalse(document.getString("file").startsWith(note.getString("hash")));
    }

    public void testCASAndNoopRejectStaleWholeState() throws Exception {
        JSONObject note = note("knowledge", "知识", "第一版", "one");
        JSONObject saved = formal.commit("empty", state(note));
        String revision = saved.getString("revision");
        assertEquals(revision, formal.commit(revision, saved.getJSONObject("state")).getString("revision"));
        JSONObject next = state(note);
        next.getJSONObject("records").put("answer", "第二次回答");
        JSONObject second = new LocalLearningStore(root, "formal").commit(revision, next);
        expectCode("CONFLICT", () -> formal.commit(revision, state(note)));
        assertEquals(second.toString(), formal.load().toString());
    }

    public void testBeforeManifestFailurePreservesOldNotesAndRecordsAfterReopen() throws Exception {
        JSONObject note = note("knowledge", "知识", "第一版", "one");
        JSONObject saved = formal.commit("empty", state(note));
        JSONObject nextNote = new JSONObject(note.toString()).put("body", "第二版").put("hash", "two");
        JSONObject next = state(nextNote);
        next.getJSONObject("records").put("answer", "不得部分保存");
        formal.setFailurePoint(stage -> { if ("before-manifest".equals(stage)) throw new IOException("Synthetic failure"); });
        expectCode("STORE_ERROR", () -> formal.commit(saved.getString("revision"), next));
        assertEquals(2, objectCount());
        assertEquals(saved.toString(), new LocalLearningStore(root, "formal").load().toString());
        assertEquals(1, objectCount());
        assertEquals(1, new LocalLearningStore(root, "formal").backup().getJSONArray("documents").length());
    }

    public void testAfterManifestFailureExposesCompleteNewStateAfterReopen() throws Exception {
        JSONObject note = note("knowledge", "知识", "第一版", "one");
        JSONObject saved = formal.commit("empty", state(note));
        JSONObject nextNote = new JSONObject(note.toString()).put("body", "第二版").put("hash", "two");
        JSONObject next = state(nextNote);
        next.getJSONObject("records").put("answer", "完整保存");
        formal.setFailurePoint(stage -> { if ("after-manifest".equals(stage)) throw new IOException("Synthetic failure"); });
        expectCode("STORE_ERROR", () -> formal.commit(saved.getString("revision"), next));
        assertEquals(2, objectCount());
        JSONObject reopened = new LocalLearningStore(root, "formal").load();
        assertEquals(2, objectCount());
        assertFalse(saved.getString("revision").equals(reopened.getString("revision")));
        assertEquals("第二版", reopened.getJSONObject("state").getJSONArray("notes").getJSONObject(0).getString("body"));
        assertEquals("完整保存", reopened.getJSONObject("state").getJSONObject("records").getString("answer"));
        assertEquals(2, new LocalLearningStore(root, "formal").backup().getJSONArray("documents").length());
    }

    public void testInterruptedFirstCommitAndAtomicPreviousManifestRecovery() throws Exception {
        formal.setFailurePoint(stage -> { if ("before-manifest".equals(stage)) throw new IOException("Synthetic failure"); });
        expectCode("STORE_ERROR", () -> formal.commit("empty", state(note("topic", "专题", "合成正文", "v1"))));
        assertEquals(1, objectCount());
        assertEquals("empty", new LocalLearningStore(root, "formal").load().getString("revision"));
        assertEquals(0, objectCount());
        formal = new LocalLearningStore(root, "formal");
        JSONObject saved = formal.commit("empty", state(note("topic", "专题", "已提交正文", "v2")));
        File manifest = new File(root, "formal/manifest.json");
        assertTrue(manifest.renameTo(new File(root, "formal/manifest.json.bak")));
        writeText(manifest, "{broken-current");
        writeText(new File(root, "formal/manifest.json.new"), "{unfinished");
        assertEquals(saved.toString(), new LocalLearningStore(root, "formal").load().toString());
    }

    public void testUpdatedDeletedMarkdownHistorySurvivesExportAndRestore() throws Exception {
        JSONObject original = note("mistake", "错题", "第一版原文", "opaque-one");
        JSONObject first = formal.commit("empty", state(original));
        JSONObject secondNote = new JSONObject(original.toString()).put("body", "用户修正后正文").put("hash", "opaque-two");
        JSONObject second = formal.commit(first.getString("revision"), state(secondNote));
        JSONObject deleted = formal.commit(second.getString("revision"), state());
        assertEquals(0, deleted.getJSONObject("state").getJSONArray("notes").length());
        JSONObject backup = formal.backup();
        assertEquals(2, backup.getJSONArray("documents").length());
        assertEquals(2, backup.getJSONObject("manifest").getJSONArray("history").length());
        String all = backup.getJSONArray("documents").toString();
        assertTrue(all.contains("第一版原文"));
        assertTrue(all.contains("用户修正后正文"));
        LocalLearningStore target = new LocalLearningStore(new File(root, "restored"), "formal");
        JSONObject preview = target.previewRestore(roundtrip(backup));
        assertTrue(preview.getBoolean("canRestore"));
        target.restoreBackup(preview.getString("token"));
        assertEquals(all, target.backup().getJSONArray("documents").toString());
        JSONObject differing = state(note("knowledge", "已有学习", "保留", "existing"));
        JSONObject current = target.load();
        target.commit(current.getString("revision"), differing);
        JSONObject blocked = target.previewRestore(backup);
        assertFalse(blocked.getBoolean("canRestore"));
        expectCode("CONFLICT", () -> target.restoreBackup(blocked.getString("token")));
    }

    public void testInterruptedCommitReclaimsOnlyOrphansAndKeepsCommittedHistory() throws Exception {
        JSONObject original = note("knowledge", "知识", "原始合成版本", "one");
        JSONObject first = formal.commit("empty", state(original));
        JSONObject updated = new JSONObject(original.toString()).put("body", "已提交修订").put("hash", "two");
        JSONObject second = formal.commit(first.getString("revision"), state(updated));
        String historyBefore = formal.backup().getJSONArray("documents").toString();
        JSONObject failed = new JSONObject(original.toString()).put("body", "未提交版本").put("hash", "three");
        formal.setFailurePoint(stage -> { if ("before-manifest".equals(stage)) throw new IOException("Synthetic failure"); });
        expectCode("STORE_ERROR", () -> formal.commit(second.getString("revision"), state(failed)));
        assertEquals(3, objectCount());
        // Identified orphan sidecars are also reclaimed, while every committed current/history reference remains.
        String orphan = repeated('f', 64) + ".md";
        writeText(new File(root, "formal/objects/" + orphan + ".new"), "未提交 staging");
        writeText(new File(root, "formal/objects/" + orphan + ".bak"), "未引用 backup");
        assertEquals(5, objectCount());
        LocalLearningStore reopened = new LocalLearningStore(root, "formal");
        assertEquals(2, objectCount());
        assertEquals(second.toString(), reopened.load().toString());
        assertEquals(historyBefore, reopened.backup().getJSONArray("documents").toString());
    }

    public void testFormalPracticeAndRawSourcesRemainSeparateAndOnlyPracticeResets() throws Exception {
        LocalLearningStore practice = new LocalLearningStore(root, "practice");
        JSONObject exercise = practice.commit("empty", state(note("source", "练习资料", "仅合成演练", "practice-version")));
        assertEquals(0, formal.load().getJSONObject("state").getJSONArray("notes").length());
        expectCode("VALIDATION", () -> formal.commit("empty", exercise.getJSONObject("state")));
        expectCode("VALIDATION", () -> formal.reset("empty"));
        LocalSourceStore raw = new LocalSourceStore(new File(root, "local-sources-v1"));
        try {
            raw.save(new JSONObject().put("title", "独立原始资料").put("body", "原始资料正文"));
            practice.reset(exercise.getString("revision"));
            assertEquals(0, practice.load().getJSONObject("state").getJSONArray("notes").length());
            assertEquals(1, raw.list("").length());
            assertFalse(practice.backup().toString().contains("独立原始资料"));
        } finally { raw.close(); }
    }

    public void testPreviewTokenSingleUseStaleContextAndIdenticalRestore() throws Exception {
        formal.commit("empty", state(note("knowledge", "知识", "合成内容", "v1")));
        JSONObject backup = formal.backup();
        LocalLearningStore target = new LocalLearningStore(new File(root, "target"), "formal");
        String token = target.previewRestore(backup).getString("token");
        JSONObject restored = target.restoreBackup(token);
        assertTrue(restored.getBoolean("restored"));
        expectCode("INVALID_PREVIEW", () -> target.restoreBackup(token));
        JSONObject identical = target.previewRestore(backup);
        assertTrue(identical.getBoolean("identical"));
        JSONObject unchanged = target.restoreBackup(identical.getString("token"));
        assertTrue(unchanged.getBoolean("unchanged"));
        assertEquals(restored.getString("revision"), unchanged.getString("revision"));
        JSONObject stale = target.previewRestore(backup);
        JSONObject next = unchanged.getJSONObject("state");
        next.getJSONObject("records").put("answer", "新的回答");
        target.commit(unchanged.getString("revision"), next);
        expectCode("INVALID_PREVIEW", () -> target.restoreBackup(stale.getString("token")));
        expectCode("INVALID_PREVIEW", () -> target.restoreBackup(stale.getString("token")));
        LocalLearningStore practice = new LocalLearningStore(root, "practice");
        expectCode("VALIDATION", () -> practice.previewRestore(backup));
        expectCode("INVALID_PREVIEW", () -> practice.restoreBackup(identical.getString("token")));
        expectCode("VALIDATION", () -> target.previewRestore(new JSONObject().put("format", "zhixu-android-source-backup")));
    }

    public void testPersistedTitleUtf16BoundaryRejectsOversizedBackupBeforeMutation() throws Exception {
        String emoji = "\uD83D\uDE00";
        StringBuilder title = new StringBuilder();
        for (int index = 0; index < 100; index++) title.append(emoji);
        String boundary = title.toString();
        String oversized = boundary + emoji;
        assertEquals(200, boundary.length());
        assertEquals(202, oversized.length());
        JSONObject note = note("knowledge", boundary, "合成的标题边界回归", "title-version");
        JSONObject empty = formal.load();
        expectCode("VALIDATION", () -> formal.commit("empty", state(new JSONObject(note.toString()).put("title", oversized))));
        assertEquals(empty.toString(), formal.load().toString());

        LocalLearningStore donor = new LocalLearningStore(new File(root, "title-donor"), "formal");
        donor.commit("empty", state(note));
        JSONObject validBackup = roundtrip(donor.backup());
        JSONObject oversizedBackup = new JSONObject(validBackup.toString());
        JSONObject document = oversizedBackup.getJSONArray("documents").getJSONObject(0);
        String raw = document.getString("raw");
        int end = raw.indexOf("\n---\n", 4);
        JSONObject header = new JSONObject(raw.substring(4, end)).put("title", oversized);
        String changedRaw = "---\n" + header.toString() + "\n---\n" + raw.substring(end + 5);
        byte[] checksum = java.security.MessageDigest.getInstance("SHA-256").digest(changedRaw.getBytes(StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder();
        for (byte item : checksum) name.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        String changedFile = name.append(".md").toString();
        document.put("raw", changedRaw).put("file", changedFile);
        oversizedBackup.getJSONObject("manifest").getJSONArray("notes").getJSONObject(0).put("file", changedFile);
        // Keep physical integrity valid, so the failure is specifically the persisted title contract.
        expectCode("VALIDATION", () -> formal.previewRestore(oversizedBackup));
        assertEquals(empty.toString(), formal.load().toString());
        assertEquals(0, formal.backup().getJSONArray("documents").length());

        JSONObject preview = formal.previewRestore(validBackup);
        assertTrue(preview.getBoolean("canRestore"));
        JSONObject restored = formal.restoreBackup(preview.getString("token"));
        assertTrue(restored.getBoolean("restored"));
        assertEquals(boundary, restored.getJSONObject("state").getJSONArray("notes").getJSONObject(0).getString("title"));
        assertEquals(boundary, new LocalLearningStore(root, "formal").load().getJSONObject("state")
            .getJSONArray("notes").getJSONObject(0).getString("title"));
    }

    public void testDifferentNonemptyRuntimeCannotBeOverwrittenByRestore() throws Exception {
        JSONObject backup = formal.backup();
        JSONObject currentState = state();
        currentState.getJSONObject("records").put("draft", "尚未完成的回答");
        JSONObject current = formal.commit("empty", currentState);
        JSONObject preview = formal.previewRestore(backup);
        assertFalse(preview.getBoolean("canRestore"));
        expectCode("CONFLICT", () -> formal.restoreBackup(preview.getString("token")));
        assertEquals(current.toString(), formal.load().toString());
    }

    public void testPreviewExpiresWithoutChangingOrReadingTheLibrary() throws Exception {
        long[] clock = { 1000 };
        formal.setClockForTests(() -> clock[0]);
        String token = formal.previewRestore(formal.backup()).getString("token");
        clock[0] += LocalLearningStore.PREVIEW_TTL_MS + 1;
        expectCode("INVALID_PREVIEW", () -> formal.restoreBackup(token));
        assertEquals("empty", formal.load().getString("revision"));
    }

    public void testLargeRetainedSourceSnapshotCommitsExportsAndRestores() throws Exception {
        JSONObject knowledge = note("knowledge", "整理后的知识", repeated('k', 128 * 1024), "knowledge-version");
        JSONObject sourceSnapshot = new JSONObject().put("id", UUID.randomUUID().toString()).put("kind", "source")
            .put("title", "合成整理依据").put("body", repeated('s', 128 * 1024)).put("hash", "source-version")
            .put("meta", new JSONObject().put("privacy", "local"));
        knowledge.getJSONObject("meta").put("sourceSnapshot", sourceSnapshot);
        JSONObject saved = formal.commit("empty", state(knowledge));
        JSONObject backup = roundtrip(formal.backup());
        LocalLearningStore target = new LocalLearningStore(new File(root, "snapshot-target"), "formal");
        String token = target.previewRestore(backup).getString("token");
        JSONObject restored = target.restoreBackup(token);
        JSONObject nextNote = restored.getJSONObject("state").getJSONArray("notes").getJSONObject(0);
        assertEquals(128 * 1024, nextNote.getString("body").length());
        assertEquals("source-version", nextNote.getJSONObject("meta").getJSONObject("sourceSnapshot").getString("hash"));
        assertEquals(sourceSnapshot.getString("body"), nextNote.getJSONObject("meta").getJSONObject("sourceSnapshot").getString("body"));
        assertEquals(saved.getJSONObject("state").toString(), restored.getJSONObject("state").toString());
        assertEquals(saved.getJSONObject("state").toString(), new LocalLearningStore(root, "formal").load().getJSONObject("state").toString());
    }

    public void testCorruptMarkdownAndManifestRefuseSilentResetOrOverwrite() throws Exception {
        JSONObject saved = formal.commit("empty", state(note("knowledge", "知识", "不可静默丢弃", "v1")));
        String name = formal.backup().getJSONArray("documents").getJSONObject(0).getString("file");
        File markdown = new File(root, "formal/objects/" + name);
        writeText(markdown, "---\n{}\n---\n被篡改正文");
        File orphan = new File(root, "formal/objects/" + repeated('e', 64) + ".md");
        writeText(orphan, "损坏库中的未知事务快照，不能猜测清理");
        expectCode("CORRUPT", () -> formal.load());
        expectCode("CORRUPT", () -> new LocalLearningStore(root, "formal"));
        expectCode("CORRUPT", () -> formal.commit(saved.getString("revision"), state()));
        assertTrue(markdown.exists());
        assertTrue(orphan.exists());
        File manifest = new File(root, "formal/manifest.json");
        writeText(manifest, "{truncated");
        expectCode("CORRUPT", () -> formal.load());
        assertEquals("{truncated", readText(manifest));
        assertTrue(orphan.exists());
    }

    public void testInvalidNamespaceIDsFieldsFileReferencesAndUtf8Rejected() throws Exception {
        expectCode("VALIDATION", () -> new LocalLearningStore(root, "../formal"));
        expectCode("VALIDATION", () -> new LocalLearningStore(root, "cloud"));
        JSONObject note = note("knowledge", "知识", "正文", "v1");
        expectCode("VALIDATION", () -> formal.commit("empty", state(new JSONObject(note.toString()).put("id", "../index.sqlite"))));
        expectCode("VALIDATION", () -> formal.commit("empty", state(new JSONObject(note.toString()).put("kind", "source"))));
        expectCode("VALIDATION", () -> formal.commit("empty", state(new JSONObject(note.toString()).put("path", "/sdcard/private"))));
        expectCode("VALIDATION", () -> formal.commit("empty", state(new JSONObject(note.toString()).put("body", "无效\uD800"))));
        expectCode("VALIDATION", () -> formal.commit("empty", state(new JSONObject(note.toString()).put("hash", ""))));
        JSONObject duplicates = state(note, new JSONObject(note.toString()));
        expectCode("VALIDATION", () -> formal.commit("empty", duplicates));
        formal.commit("empty", state(note));
        JSONObject pack = formal.backup();
        pack.getJSONObject("manifest").getJSONArray("notes").getJSONObject(0).put("file", "../raw.md");
        expectCode("VALIDATION", () -> formal.previewRestore(pack));
    }

    public void testSymlinkRootMarkdownAndAtomicSidecarCannotEscapePrivateDirectory() throws Exception {
        File outside = new File(root, "outside");
        assertTrue(outside.mkdir());
        File linked = new File(root, "linked");
        Os.symlink(outside.getPath(), linked.getPath());
        expectCode("STORE_ERROR", () -> new LocalLearningStore(linked, "formal"));
        assertTrue(linked.delete());
        JSONObject note = note("knowledge", "知识", "正文", "v1");
        JSONObject saved = formal.commit("empty", state(note));
        File manifestSidecar = new File(root, "formal/manifest.json.new");
        File protectedFile = new File(outside, "protected.json");
        writeText(protectedFile, "保持原样");
        Os.symlink(protectedFile.getPath(), manifestSidecar.getPath());
        expectCode("STORE_ERROR", () -> formal.commit(saved.getString("revision"), state()));
        assertEquals("保持原样", readText(protectedFile));
        assertTrue(manifestSidecar.delete());
        String file = formal.backup().getJSONArray("documents").getJSONObject(0).getString("file");
        File markdown = new File(root, "formal/objects/" + file);
        assertTrue(markdown.delete());
        Os.symlink(protectedFile.getPath(), markdown.getPath());
        expectCode("STORE_ERROR", () -> formal.load());
        assertEquals("保持原样", readText(protectedFile));
        assertTrue(markdown.delete());
    }

    public void testCapacityUtf8DepthAndStrictJsonAreBounded() throws Exception {
        JSONObject note = note("knowledge", "知识", "正文", "v1");
        expectCode("VALIDATION", () -> formal.commit("empty", state(new JSONObject(note.toString()).put("body", repeated('文', 44000)))));
        expectCode("VALIDATION", () -> formal.commit("empty", state(new JSONObject(note.toString()).put("hash", repeated('x', 257)))));
        JSONObject runtime = state();
        runtime.getJSONObject("records").put("retainedAnswer", repeated('x', 1024 * 1024 + 1));
        JSONObject saved = formal.commit("empty", runtime);
        assertEquals(1024 * 1024 + 1, formal.load().getJSONObject("state").getJSONObject("records").getString("retainedAnswer").length());
        JSONObject oversized = state();
        oversized.getJSONObject("records").put("answer", repeated('x', LocalLearningStore.MAX_RUNTIME_BYTES));
        expectCode("VALIDATION", () -> formal.commit(saved.getString("revision"), oversized));
        JSONObject deep = state(); JSONObject nested = deep.getJSONObject("records");
        for (int index = 0; index < 20; index++) { JSONObject child = new JSONObject(); nested.put("nested", child); nested = child; }
        expectCode("VALIDATION", () -> formal.commit(saved.getString("revision"), deep));
        JSONObject manyNodes = state();
        JSONArray turns = new JSONArray();
        for (int index = 0; index < LocalLearningStore.MAX_JSON_NODES; index++) turns.put(JSONObject.NULL);
        manyNodes.getJSONObject("records").put("turns", turns);
        expectCode("VALIDATION", () -> formal.commit(saved.getString("revision"), manyNodes));
        for (String raw : Arrays.asList("{\"x\":1,\"x\":2}", "{\"x\":1} trailing", "{/*comment*/\"x\":1}", "{'x':1}", "{\"x\":01}", "{\"x\":1,}")) {
            expectCode("VALIDATION", () -> LocalLearningStore.readPackage(new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8))));
        }
    }

    public void testEverySuccessfulCommitKeepsEntireLibraryWithinBackupBudget() throws Exception {
        JSONObject note = note("knowledge", "容量", "第一版", "v0");
        JSONObject first = formal.commit("empty", state(note));
        JSONObject currentNote = new JSONObject(note.toString()).put("body", "第二版").put("hash", "v1");
        JSONObject result = formal.commit(first.getString("revision"), state(currentNote));
        JSONObject tooLarge = state();
        String largeBody = repeated('x', 128 * 1024);
        // Metadata JSON is encoded inside Markdown, then again in the backup. The state fits but its export does not.
        String sourceBody = repeated('\n', 64 * 1024);
        for (int index = 0; index < 52; index++) {
            JSONObject largeNote = note("knowledge", "容量 " + index, largeBody, "new-" + index);
            largeNote.getJSONObject("meta").put("sourceSnapshot", new JSONObject().put("body", sourceBody));
            tooLarge.getJSONArray("notes").put(largeNote);
        }
        expectCode("VALIDATION", () -> formal.commit(result.getString("revision"), tooLarge));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        LocalLearningStore.writePackage(formal.backup(), output);
        assertTrue(output.size() <= LocalLearningStore.MAX_BACKUP_BYTES);
        assertEquals(1, formal.backup().getJSONObject("manifest").getJSONArray("history").length());
        assertEquals(result.toString(), new LocalLearningStore(root, "formal").load().toString());
    }

    private static JSONObject note(String kind, String title, String body, String hash) throws Exception {
        return new JSONObject().put("id", UUID.randomUUID().toString()).put("kind", kind).put("title", title)
            .put("body", body).put("hash", hash).put("meta", new JSONObject().put("stage", "reference").put("privacy", "local"));
    }
    private static JSONObject state(JSONObject... notes) throws Exception {
        JSONArray array = new JSONArray(); for (JSONObject note : notes) array.put(note);
        return new JSONObject().put("notes", array).put("records", new JSONObject()).put("settings", new JSONObject()).put("guide", new JSONObject());
    }
    private static JSONObject roundtrip(JSONObject pack) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        LocalLearningStore.writePackage(pack, bytes);
        return LocalLearningStore.readPackage(new ByteArrayInputStream(bytes.toByteArray()));
    }
    private static String repeated(char item, int count) { char[] value = new char[count]; Arrays.fill(value, item); return new String(value); }
    private int objectCount() {
        File[] files = new File(root, "formal/objects").listFiles();
        assertNotNull(files);
        return files.length;
    }
    private static void writeText(File file, String text) throws IOException { try (FileOutputStream output = new FileOutputStream(file)) { output.write(text.getBytes(StandardCharsets.UTF_8)); } }
    private static String readText(File file) throws Exception { try (java.io.FileInputStream input = new java.io.FileInputStream(file)) { return SourceDocumentFiles.readUtf8(input, LocalLearningStore.MAX_BACKUP_BYTES); } }
    private interface Operation { void run() throws Exception; }
    private static void expectCode(String code, Operation operation) throws Exception {
        try { operation.run(); fail("Expected " + code); }
        catch (LocalSourceStore.StoreException exception) { assertEquals(code, exception.code); }
    }
    private static void deleteTestTree(File directory) throws IOException {
        File canonical = directory.getCanonicalFile();
        if (!canonical.equals(directory.getAbsoluteFile())) throw new IOException("Refusing a symlink during fixture cleanup");
        File[] children = directory.listFiles();
        if (children != null) for (File child : children) {
            if (child.isDirectory()) deleteTestTree(child);
            else if (!child.delete() && child.exists()) throw new IOException("Cannot delete fixture file");
        }
        if (!directory.delete() && directory.exists()) throw new IOException("Cannot delete fixture directory");
    }
}
