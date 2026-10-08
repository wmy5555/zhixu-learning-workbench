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
        relation(state, note.getString("id"), new JSONObject().put("answer", "保留回答").put("finished", true));
        state.getJSONObject("settings").put("dailyMinutes", 6);
        state.getJSONObject("guide").put("step", "study");
        JSONObject saved = formal.commit("empty", state);
        assertFalse("empty".equals(saved.getString("revision")));
        JSONObject reopened = new LocalLearningStore(root, "formal").load();
        assertEquals(saved.toString(), reopened.toString());
        JSONObject restoredNote = reopened.getJSONObject("state").getJSONArray("notes").getJSONObject(0);
        assertEquals("js-version-opaque", restoredNote.getString("hash"));
        assertEquals(note.getString("body"), restoredNote.getString("body"));
        assertTrue(reopened.getJSONObject("state").getJSONObject("records").getJSONObject("relations").getJSONObject(note.getString("id")).getBoolean("finished"));
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
        relation(next, "answer", new JSONObject().put("answer", "第二次回答"));
        JSONObject second = new LocalLearningStore(root, "formal").commit(revision, next);
        expectCode("CONFLICT", () -> formal.commit(revision, state(note)));
        assertEquals(second.toString(), formal.load().toString());
    }

    public void testBeforeManifestFailurePreservesOldNotesAndRecordsAfterReopen() throws Exception {
        JSONObject note = note("knowledge", "知识", "第一版", "one");
        JSONObject saved = formal.commit("empty", state(note));
        JSONObject nextNote = new JSONObject(note.toString()).put("body", "第二版").put("hash", "two");
        JSONObject next = state(nextNote);
        relation(next, "answer", new JSONObject().put("answer", "不得部分保存"));
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
        relation(next, "answer", new JSONObject().put("answer", "完整保存"));
        formal.setFailurePoint(stage -> { if ("after-manifest".equals(stage)) throw new IOException("Synthetic failure"); });
        expectCode("STORE_ERROR", () -> formal.commit(saved.getString("revision"), next));
        assertEquals(2, objectCount());
        JSONObject reopened = new LocalLearningStore(root, "formal").load();
        assertEquals(2, objectCount());
        assertFalse(saved.getString("revision").equals(reopened.getString("revision")));
        assertEquals("第二版", reopened.getJSONObject("state").getJSONArray("notes").getJSONObject(0).getString("body"));
        assertEquals("完整保存", reopened.getJSONObject("state").getJSONObject("records").getJSONObject("relations").getJSONObject("answer").getString("answer"));
        assertEquals(2, new LocalLearningStore(root, "formal").backup().getJSONArray("documents").length());
    }

    public void testCommitAndRestoreReturnKnownRevisionWhenPostCommitCleanupIoIsDeferred() throws Exception {
        JSONObject firstNote = note("knowledge", "合成提交清理回归", "旧版合成正文", "old");
        JSONObject first = formal.commit("empty", state(firstNote));
        JSONObject nextNote = new JSONObject(firstNote.toString()).put("body", "已保存的新版合成正文").put("hash", "next");
        formal.commit(first.getString("revision"), state(nextNote));
        JSONObject incoming = formal.backup();
        for (boolean restore : new boolean[] { false, true }) {
            for (String operation : Arrays.asList("list", "delete", "sync")) {
                File parent = new File(root, "deferred-" + restore + "-" + operation);
                LocalLearningStore target = new LocalLearningStore(parent, "formal");
                File directory = new File(parent, "formal/objects");
                String orphan = repeated('f', 64) + ".md";
                File unknown = new File(directory, "unrecognized.txt");
                int[] failures = { 0 };
                target.setFailurePoint(stage -> {
                    if ("after-manifest".equals(stage)) {
                        for (String suffix : Arrays.asList("", ".new", ".bak")) writeText(new File(directory, orphan + suffix), "未引用的合成暂存");
                        writeText(unknown, "未知文件保持原样");
                        target.setCleanupFailurePointForTests(point -> {
                            if (operation.equals(point)) {
                                failures[0]++;
                                throw new IOException("Synthetic persistent learning cleanup " + operation + " failure");
                            }
                        });
                    }
                });
                String token = restore ? target.previewRestore(incoming).getString("token") : null;
                JSONObject result = restore ? target.restoreBackup(token) : target.commit("empty", state(nextNote));
                assertTrue(failures[0] > 0);
                String revision = result.getString("revision");
                assertFalse("empty".equals(revision));
                assertEquals(revision, new JSONObject(readText(new File(parent, "formal/manifest.json"))).getString("revision"));
                target.setFailurePoint(stage -> {
                    if ("before-recovery-sync".equals(stage)) throw new IOException("Unchanged known-durable authority must not need another recovery sync");
                });
                assertEquals(revision, target.load().getString("revision"));
                assertEquals(result.getJSONObject("state").toString(), target.load().getJSONObject("state").toString());
                assertEquals(1, target.load().getJSONObject("state").getJSONArray("notes").length());
                assertEquals(restore ? 2 : 1, target.backup().getJSONArray("documents").length());
                assertEquals(revision, target.commit(revision, result.getJSONObject("state")).getString("revision"));
                JSONObject duplicateAttempt = state(nextNote, note("knowledge", "新的UUID操作", "不能使用过时版本重试", "duplicate"));
                expectCode("CONFLICT", () -> target.commit("empty", duplicateAttempt));
                assertEquals(revision, target.load().getString("revision"));
                if (restore) {
                    assertTrue(result.getBoolean("restored"));
                    expectCode("INVALID_PREVIEW", () -> target.restoreBackup(token));
                    JSONObject identical = target.previewRestore(incoming);
                    JSONObject unchanged = target.restoreBackup(identical.getString("token"));
                    assertTrue(unchanged.getBoolean("unchanged"));
                    assertEquals(revision, unchanged.getString("revision"));
                }
                // A real new write must clear/sync owned residue first even while read/no-op/backup stay usable.
                JSONObject newState = state(nextNote, note("topic", "新写入须严格清理", "未提交的合成专题", "new-topic"));
                String manifestBefore = readText(new File(parent, "formal/manifest.json"));
                expectCode("STORE_ERROR", () -> target.commit(revision, newState));
                assertEquals(manifestBefore, readText(new File(parent, "formal/manifest.json")));
                assertEquals(1, target.load().getJSONObject("state").getJSONArray("notes").length());
                assertEquals("未知文件保持原样", readText(unknown));
                target.setFailurePoint(null);
                target.setCleanupFailurePointForTests(null);
                LocalLearningStore reopened = new LocalLearningStore(parent, "formal");
                assertEquals(revision, reopened.load().getString("revision"));
                for (String suffix : Arrays.asList("", ".new", ".bak")) assertFalse(new File(directory, orphan + suffix).exists());
                assertEquals("未知文件保持原样", readText(unknown));
                assertEquals(restore ? 2 : 1, reopened.backup().getJSONArray("documents").length());
            }
        }
    }

    public void testResetReturnsKnownEmptyRevisionWhenPostCommitCleanupIoIsDeferred() throws Exception {
        for (String operation : Arrays.asList("list", "delete", "sync")) {
            File parent = new File(root, "reset-deferred-" + operation);
            LocalLearningStore practice = new LocalLearningStore(parent, "practice");
            JSONObject saved = practice.commit("empty", state(note("source", "合成待清空原文", "清空提交后允许延后清理", "reset")));
            File directory = new File(parent, "practice/objects");
            File unknown = new File(directory, "unrecognized.txt");
            writeText(unknown, "练习清空不删除未知文件");
            int[] failures = { 0 };
            practice.setFailurePoint(stage -> {
                if ("after-manifest".equals(stage)) {
                    practice.setCleanupFailurePointForTests(point -> {
                        if (operation.equals(point)) {
                            failures[0]++;
                            throw new IOException("Synthetic persistent reset cleanup " + operation + " failure");
                        }
                    });
                }
            });
            JSONObject result = practice.reset(saved.getString("revision"));
            assertTrue(failures[0] > 0);
            String revision = result.getString("revision");
            assertFalse(saved.getString("revision").equals(revision));
            assertEquals(revision, new JSONObject(readText(new File(parent, "practice/manifest.json"))).getString("revision"));
            practice.setFailurePoint(stage -> {
                if ("before-recovery-sync".equals(stage)) throw new IOException("Known-durable reset must not require another recovery sync");
            });
            assertEquals(revision, practice.load().getString("revision"));
            assertEquals(0, practice.load().getJSONObject("state").getJSONArray("notes").length());
            assertEquals(0, practice.backup().getJSONArray("documents").length());
            assertEquals(revision, practice.commit(revision, result.getJSONObject("state")).getString("revision"));
            expectCode("CONFLICT", () -> practice.reset(saved.getString("revision")));
            JSONObject newState = state(note("topic", "清空后的新写入", "清理恢复前不能积累残留", "reset-next"));
            String manifestBefore = readText(new File(parent, "practice/manifest.json"));
            expectCode("STORE_ERROR", () -> practice.commit(revision, newState));
            assertEquals(manifestBefore, readText(new File(parent, "practice/manifest.json")));
            assertEquals("练习清空不删除未知文件", readText(unknown));
            practice.setFailurePoint(null);
            practice.setCleanupFailurePointForTests(null);
            LocalLearningStore reopened = new LocalLearningStore(parent, "practice");
            assertEquals(revision, reopened.load().getString("revision"));
            assertEquals(0, reopened.backup().getJSONArray("documents").length());
            assertEquals(1, directory.listFiles().length);
            assertEquals("练习清空不删除未知文件", readText(unknown));
            assertEquals(1, reopened.commit(revision, newState).getJSONObject("state").getJSONArray("notes").length());
        }
    }

    public void testCleanupRejectsDangerousEntriesBeforeDeletingAnyRecognizedObject() throws Exception {
        for (boolean linked : new boolean[] { false, true }) {
            File parent = new File(root, "unsafe-cleanup-" + linked);
            LocalLearningStore target = new LocalLearningStore(parent, "formal");
            File directory = new File(parent, "formal/objects");
            File safe = new File(directory, repeated('d', 64) + ".md.new");
            File unsafe = new File(directory, repeated('c', 64) + ".md");
            File outside = new File(root, "outside-learning-cleanup-" + linked + ".txt");
            writeText(outside, "不能跟随链接删除的合成文件");
            JSONObject savedNote = note("knowledge", "安全错误仍保留", "已经提交但清理路径不安全", "safe-note");
            target.setFailurePoint(stage -> {
                if ("after-manifest".equals(stage)) {
                    writeText(safe, "整个删除集合确认安全之前必须保留");
                    if (linked) {
                        try { Os.symlink(outside.getPath(), unsafe.getPath()); }
                        catch (android.system.ErrnoException exception) { throw new IOException(exception); }
                    } else if (!unsafe.mkdir()) throw new IOException("Cannot create synthetic unsafe object entry");
                }
            });
            try {
                expectCode("STORE_ERROR", () -> target.commit("empty", state(savedNote)));
                assertEquals("整个删除集合确认安全之前必须保留", readText(safe));
                assertEquals("不能跟随链接删除的合成文件", readText(outside));
                expectCode("STORE_ERROR", target::load);
                assertTrue(safe.isFile());
            } finally { assertTrue(unsafe.delete()); } // Remove only the test link/directory itself.
            target.setFailurePoint(null);
            JSONObject saved = target.load();
            assertEquals(savedNote.getString("id"), saved.getJSONObject("state").getJSONArray("notes").getJSONObject(0).getString("id"));
            assertFalse(safe.exists());
            JSONObject unknownReference = target.backup();
            unknownReference.getJSONObject("manifest").getJSONArray("notes").getJSONObject(0).put("file", "unknown.md");
            expectCode("VALIDATION", () -> target.previewRestore(unknownReference));
            assertEquals(saved.toString(), target.load().toString());
        }
    }

    public void testRecoveredManifestMustSyncBeforeCollectingPreviousAuthorityObjects() throws Exception {
        LocalLearningStore practice = new LocalLearningStore(root, "practice");
        JSONObject saved = practice.commit("empty", state(note("source", "合成练习原文", "不能在提交目录同步前清理", "practice")));
        File objects = new File(root, "practice/objects");
        assertEquals(1, objects.listFiles().length);
        practice.setFailurePoint(stage -> {
            if ("before-manifest-directory-sync".equals(stage)) throw new SimulatedLearningProcessExit();
        });
        try { practice.reset(saved.getString("revision")); fail("Expected process interruption before directory sync"); }
        catch (SimulatedLearningProcessExit expected) { /* New manifest is visible, but its rename was not synced. */ }
        assertEquals(1, objects.listFiles().length);
        practice.setFailurePoint(stage -> {
            if ("before-recovery-sync".equals(stage)) throw new IOException("Synthetic recovery directory sync failure");
        });
        expectCode("STORE_ERROR", practice::load);
        assertEquals(1, objects.listFiles().length);
        practice.setFailurePoint(null);
        LocalLearningStore reopened = new LocalLearningStore(root, "practice");
        assertEquals(0, reopened.load().getJSONObject("state").getJSONArray("notes").length());
        assertEquals(0, objects.listFiles().length);
    }

    private static final class SimulatedLearningProcessExit extends Error { private static final long serialVersionUID = 1L; }

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
        relation(next, "answer", new JSONObject().put("answer", "新的回答"));
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
        relation(currentState, "draft", new JSONObject().put("answer", "尚未完成的回答"));
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
        relation(runtime, "retainedAnswer", new JSONObject().put("chunks", chunks(9)));
        JSONObject saved = formal.commit("empty", runtime);
        assertEquals(9, formal.load().getJSONObject("state").getJSONObject("records").getJSONObject("relations").getJSONObject("retainedAnswer").getJSONArray("chunks").length());
        JSONObject oversized = state();
        relation(oversized, "retainedAnswer", new JSONObject().put("chunks", chunks(64)));
        expectCode("VALIDATION", () -> formal.commit(saved.getString("revision"), oversized));
        JSONObject deep = state(); JSONObject nested = new JSONObject(); relation(deep, "deep", nested);
        for (int index = 0; index < 20; index++) { JSONObject child = new JSONObject(); nested.put("nested", child); nested = child; }
        expectCode("VALIDATION", () -> formal.commit(saved.getString("revision"), deep));
        JSONObject manyNodes = state();
        JSONArray turns = new JSONArray();
        for (int index = 0; index < 100; index++) {
            JSONArray row = new JSONArray(); for (int item = 0; item < 1000; item++) row.put(JSONObject.NULL); turns.put(row);
        }
        relation(manyNodes, "turns", new JSONObject().put("turns", turns));
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

    public void testInvalidSettingsNamespacesAndGuideRejectBeforePreviewOrCommit() throws Exception {
        JSONObject valid = compatibleState();
        LocalLearningStore donor = new LocalLearningStore(new File(root, "runtime-donor"), "formal");
        donor.commit("empty", valid);
        JSONObject pack = donor.backup();
        for (StateEdit edit : new StateEdit[] {
            value -> value.getJSONObject("settings").put("dailyMinutes", "25"),
            value -> value.getJSONObject("settings").put("dailyMinutes", 4),
            value -> value.getJSONObject("settings").put("dailyMinutes", 241),
            value -> value.getJSONObject("settings").put("dailyMinutes", 25.5),
            value -> value.getJSONObject("settings").put("dailyMinutes", JSONObject.NULL),
            value -> value.getJSONObject("settings").put("discoveryDays", 0),
            value -> value.getJSONObject("settings").put("discoveryDays", "7"),
            value -> value.getJSONObject("settings").put("discoveryDays", 366),
            value -> value.getJSONObject("settings").put("dailyLimit", 6),
            value -> value.getJSONObject("settings").put("timezone", 8),
            value -> value.getJSONObject("settings").put("timezone", "not-a-zone"),
            value -> value.getJSONObject("settings").put("scheduleTime", "24:00"),
            value -> value.getJSONObject("settings").put("scheduleTime", "8:00"),
            value -> value.getJSONObject("settings").put("focusTopics", new JSONArray().put("\u00a0")),
            value -> value.getJSONObject("settings").put("focusTopics", textList(101)),
            value -> value.getJSONObject("settings").put("pausedIds", textList(201)),
            value -> value.getJSONObject("settings").put("pausedIds", new JSONArray().put(1)),
            value -> value.getJSONObject("records").put("unknown", new JSONObject()),
            value -> value.getJSONObject("records").put("topics", new JSONArray()),
            value -> value.getJSONObject("records").getJSONObject("relations").put("bad", "primitive"),
            value -> value.getJSONObject("records").getJSONObject("relations").put(" ", new JSONObject()),
            value -> value.getJSONObject("records").getJSONObject("jobs").put("job", new JSONObject()),
            value -> value.getJSONObject("records").getJSONObject("plans").getJSONObject("day:note").put("state", "mastered"),
            value -> value.getJSONObject("records").getJSONObject("plans").getJSONObject("day:note").put("minutes", "5"),
            value -> value.getJSONObject("guide").put("__proto__", new JSONObject()),
            value -> value.getJSONObject("guide").put("nested", new JSONObject().put("constructor", "unsafe")),
            value -> value.getJSONObject("guide").put("", true),
            value -> value.getJSONObject("guide").put(repeated('k', 257), true),
            value -> value.getJSONObject("guide").put("items", textList(2001)),
            value -> value.getJSONObject("guide").put("body", repeated('x', 128 * 1024 + 1))
        }) assertInvalidRuntime(valid, pack, edit);
        JSONObject tooMany = new JSONObject(valid.toString());
        JSONObject records = new JSONObject();
        for (int index = 0; index < 2000; index++) records.put("r" + index, new JSONObject());
        tooMany.getJSONObject("records").put("reviews", records);
        assertInvalidRuntime(tooMany, pack, value -> {});
    }

    public void testInvalidSessionTurnsAndOfflineEvidenceRejectBeforePreviewOrCommit() throws Exception {
        JSONObject valid = compatibleState();
        LocalLearningStore donor = new LocalLearningStore(new File(root, "session-donor"), "formal");
        donor.commit("empty", valid);
        JSONObject pack = donor.backup();
        for (StateEdit edit : new StateEdit[] {
            value -> session(value).put("id", ""),
            value -> session(value).put("noteId", 1),
            value -> session(value).put("sourceHash", JSONObject.NULL),
            value -> session(value).put("status", "mastered"),
            value -> session(value).put("material", "\ufeff\u3000"),
            value -> session(value).put("hintCount", -1),
            value -> session(value).put("hintCount", 1001),
            value -> session(value).put("hintCount", "0"),
            value -> session(value).put("hintCount", 0.5),
            value -> session(value).put("pendingJobId", "pending"),
            value -> session(value).put("feedback", JSONObject.NULL),
            value -> session(value).put("turns", new JSONArray()),
            value -> session(value).put("turns", textList(501)),
            value -> session(value).put("turns", new JSONArray().put("invalid turn")),
            value -> turn(value).put("id", JSONObject.NULL),
            value -> turn(value).put("requestId", repeated('r', 129)),
            value -> turn(value).put("answer", " "),
            value -> turn(value).put("hintUsed", "false"),
            value -> turn(value).put("assessment", "correct"),
            value -> turn(value).put("feedback", JSONObject.NULL),
            value -> session(value).getJSONObject("completion").put("reviewSettled", true),
            value -> session(value).getJSONObject("completion").remove("interval"),
            value -> session(value).getJSONObject("completion").put("interval", 1),
            value -> session(value).getJSONObject("completion").getJSONObject("evidence").put("assessment", "correct"),
            value -> value.getJSONObject("records").getJSONObject("studyEvidence").getJSONObject("session").remove("spacedRecall")
        }) assertInvalidRuntime(valid, pack, edit);
        for (String key : Arrays.asList("reviewSettled", "independent", "explanationPractice", "applicationPractice", "spacedRecall")) {
            assertInvalidRuntime(valid, pack, value -> session(value).getJSONObject("completion").getJSONObject("evidence").put(key, true));
            assertInvalidRuntime(valid, pack, value -> value.getJSONObject("records").getJSONObject("studyEvidence").getJSONObject("session").put(key, true));
        }
    }

    public void testCompatibleRuntimeCandidateStateRestoreAndReopenPreserveAllFields() throws Exception {
        JSONObject valid = compatibleState();
        JSONObject saved = formal.commit("empty", valid);
        LocalLearningStore target = new LocalLearningStore(new File(root, "compatible-target"), "formal");
        JSONObject preview = target.previewRestore(roundtrip(formal.backup()));
        assertEquals(saved.getJSONObject("state").toString(), preview.getJSONObject("candidateState").toString());
        // Returning a candidate for JS preflight must not expose the cached snapshot to caller mutation.
        preview.getJSONObject("candidateState").getJSONObject("settings").put("dailyMinutes", "bad");
        JSONObject restored = target.restoreBackup(preview.getString("token"));
        assertEquals(saved.getJSONObject("state").toString(), restored.getJSONObject("state").toString());
        JSONObject reopened = new LocalLearningStore(new File(root, "compatible-target"), "formal").load();
        assertEquals(restored.getString("revision"), reopened.getString("revision"));
        assertEquals(restored.getJSONObject("state").toString(), reopened.getJSONObject("state").toString());
        JSONObject identical = target.previewRestore(formal.backup());
        assertTrue(target.restoreBackup(identical.getString("token")).getBoolean("unchanged"));
        // Full ICU aliases/case and offset syntax remain compatible; exact Intl support is checked by transport.
        for (String zone : Arrays.asList("US/Eastern", "utc", "Etc/GMT+8", "+01:30")) {
            JSONObject current = target.load();
            JSONObject next = current.getJSONObject("state"); next.getJSONObject("settings").put("timezone", zone);
            target.commit(current.getString("revision"), next);
        }
        for (String status : Arrays.asList("reading", "unassessed")) {
            JSONObject current = target.load();
            JSONObject next = current.getJSONObject("state");
            session(next).put("status", status).put("turns", new JSONArray()).remove("completion");
            next.put("settings", new JSONObject()); // Partial/missing settings use JS defaults without rewriting stored data.
            target.commit(current.getString("revision"), next);
        }
    }

    public void testPersistedNoteMetadataRejectsInvalidBackupWithoutChangingLibrary() throws Exception {
        JSONObject valid = compatibleState();
        LocalLearningStore donor = new LocalLearningStore(new File(root, "metadata-donor"), "formal");
        donor.commit("empty", valid);
        JSONObject pack = donor.backup();
        for (StateEdit edit : new StateEdit[] {
            value -> value.getJSONArray("notes").getJSONObject(0).put("body", "\u00a0\ufeff"),
            value -> value.getJSONArray("notes").getJSONObject(0).put("title", "标题\t控制字符"),
            value -> meta(value).put("stage", "mastered"),
            value -> meta(value).put("stage", JSONObject.NULL),
            value -> meta(value).put("depth", "expert"),
            value -> meta(value).put("privacy", "public"),
            value -> meta(value).put("claimType", false),
            value -> meta(value).put("confirmedAt", ""),
            value -> meta(value).put("reviewAfter", 123),
            value -> meta(value).put("reviewAfter", ""),
            value -> meta(value).put("paused", "false"),
            value -> meta(value).put("userStructured", JSONObject.NULL),
            value -> meta(value).put("noteIds", textList(501)),
            value -> meta(value).put("prerequisites", textList(101)),
            value -> meta(value).put("researchLimitations", new JSONArray().put(" ")),
            value -> meta(value).put("sessions", textList(1001)),
            value -> meta(value).put("sources", new JSONArray().put("bad")),
            value -> meta(value).put("sources", textList(101)),
            value -> meta(value).put("sources", new JSONArray().put(new JSONObject().put("id", "source").put("role", ""))),
            value -> meta(value).put("sources", new JSONArray().put(new JSONObject().put("id", "source").put("role", "input").put("hash", JSONObject.NULL))),
            value -> meta(value).put("nested", new JSONObject().put("prototype", "unsafe"))
        }) {
            JSONObject invalidState = new JSONObject(valid.toString()); edit.apply(invalidState);
            expectCode("VALIDATION", () -> formal.commit("empty", invalidState));
            JSONObject invalidPack = new JSONObject(pack.toString());
            replaceOnlyNote(invalidPack, invalidState.getJSONArray("notes").getJSONObject(0));
            expectCode("VALIDATION", () -> formal.previewRestore(invalidPack));
            assertEquals("empty", formal.load().getString("revision"));
            assertEquals(0, objectCount());
        }
        String token = formal.previewRestore(pack).getString("token");
        JSONObject restored = formal.restoreBackup(token);
        assertEquals("2026-10-08T11:02:05.243Z", meta(restored.getJSONObject("state")).getString("reviewAfter"));
    }

    private void assertInvalidRuntime(JSONObject template, JSONObject pack, StateEdit edit) throws Exception {
        JSONObject invalidState = new JSONObject(template.toString()); edit.apply(invalidState);
        expectCode("VALIDATION", () -> formal.commit("empty", invalidState));
        JSONObject invalidPack = new JSONObject(pack.toString());
        for (String field : Arrays.asList("records", "settings", "guide")) invalidPack.getJSONObject("manifest").put(field, invalidState.get(field));
        expectCode("VALIDATION", () -> formal.previewRestore(invalidPack));
        expectCode("INVALID_PREVIEW", () -> formal.restoreBackup("no-preview-token"));
        assertEquals("empty", formal.load().getString("revision"));
        assertEquals(0, objectCount());
    }
    private interface StateEdit { void apply(JSONObject state) throws Exception; }
    private static JSONObject meta(JSONObject state) throws Exception { return state.getJSONArray("notes").getJSONObject(0).getJSONObject("meta"); }
    private static JSONObject session(JSONObject state) throws Exception { return state.getJSONObject("records").getJSONObject("sessions").getJSONObject("session"); }
    private static JSONObject turn(JSONObject state) throws Exception { return session(state).getJSONArray("turns").getJSONObject(0); }
    private static JSONArray textList(int count) { JSONArray list = new JSONArray(); for (int index = 0; index < count; index++) list.put("id-" + index); return list; }
    private static JSONObject evidence() throws Exception {
        return new JSONObject().put("assessment", "unassessed").put("reviewSettled", false).put("independent", false)
            .put("explanationPractice", false).put("applicationPractice", false).put("spacedRecall", false).put("day", "10/08/2026");
    }
    private static JSONObject compatibleState() throws Exception {
        JSONObject note = note("knowledge", "合成反思", "我会观察个人计划，不把感受当作已掌握证据。", "version");
        note.getJSONObject("meta").put("depth", "explain").put("reviewAfter", "2026-10-08T11:02:05.243Z")
            .put("confirmedAt", JSONObject.NULL).put("userStructured", true).put("noteIds", new JSONArray().put("source"))
            .put("sources", new JSONArray().put(new JSONObject().put("id", "source").put("role", "input").put("hash", "source-version").put("extra", true)))
            .put("researchLimitations", new JSONArray()).put("sourceSnapshot", new JSONObject().put("body", "合成原文").put("title", repeated('文', 210)));
        JSONObject value = state(note);
        JSONObject turn = new JSONObject().put("id", "turn").put("requestId", "request").put("answer", "保留原始回答")
            .put("hintUsed", false).put("assessment", "unassessed").put("createdAt", "2026-10-08T11:02:05.243Z");
        JSONObject session = new JSONObject().put("id", "session").put("noteId", note.getString("id")).put("sourceHash", "version")
            .put("status", "completed").put("hintCount", 0).put("pendingJobId", JSONObject.NULL).put("material", note.getString("body"))
            .put("turns", new JSONArray().put(turn)).put("completion", new JSONObject().put("reviewSettled", false).put("interval", JSONObject.NULL).put("evidence", evidence()));
        value.getJSONObject("records").put("sessions", new JSONObject().put("session", session))
            .put("studyEvidence", new JSONObject().put("session", evidence()))
            .put("plans", new JSONObject().put("day:note", new JSONObject().put("state", "done").put("minutes", -0.5)))
            .put("reviews", new JSONObject().put("note", new JSONObject().put("date", "10/08/2026")))
            .put("topics", new JSONObject().put("topic", new JSONObject().put("id", "topic").put("paused", true)))
            .put("relations", new JSONObject().put("relation", new JSONObject().put("arbitrary", new JSONArray().put(JSONObject.NULL).put(true))))
            .put("jobs", new JSONObject());
        value.getJSONObject("settings").put("dailyMinutes", 25).put("discoveryDays", 7).put("timezone", "Asia/Shanghai")
            .put("scheduleTime", "08:00").put("focusTopics", new JSONArray().put("topic").put("topic")).put("pausedIds", new JSONArray());
        value.getJSONObject("guide").put("steps", new JSONArray().put("study").put(new JSONObject().put("done", true))).put("custom", JSONObject.NULL);
        return value;
    }
    private static void replaceOnlyNote(JSONObject pack, JSONObject note) throws Exception {
        JSONObject header = new JSONObject().put("format", "zhixu-local-learning-note").put("version", 1);
        for (String field : Arrays.asList("id", "kind", "title", "meta", "hash")) header.put(field, note.get(field));
        String raw = "---\n" + header.toString() + "\n---\n" + note.getString("body");
        byte[] checksum = java.security.MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder();
        for (byte item : checksum) name.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        String file = name.append(".md").toString();
        pack.getJSONArray("documents").getJSONObject(0).put("raw", raw).put("file", file);
        pack.getJSONObject("manifest").getJSONArray("notes").getJSONObject(0).put("file", file);
    }

    private static JSONObject note(String kind, String title, String body, String hash) throws Exception {
        return new JSONObject().put("id", UUID.randomUUID().toString()).put("kind", kind).put("title", title)
            .put("body", body).put("hash", hash).put("meta", new JSONObject().put("stage", "reference").put("privacy", "local"));
    }
    private static JSONObject state(JSONObject... notes) throws Exception {
        JSONArray array = new JSONArray(); for (JSONObject note : notes) array.put(note);
        return new JSONObject().put("notes", array).put("records", new JSONObject()).put("settings", new JSONObject()).put("guide", new JSONObject());
    }
    private static void relation(JSONObject state, String id, JSONObject record) throws Exception {
        JSONObject records = state.getJSONObject("records");
        if (!records.has("relations")) records.put("relations", new JSONObject());
        records.getJSONObject("relations").put(id, record);
    }
    private static JSONArray chunks(int count) {
        JSONArray values = new JSONArray();
        String text = repeated('x', 128 * 1024);
        for (int index = 0; index < count; index++) values.put(text);
        return values;
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
