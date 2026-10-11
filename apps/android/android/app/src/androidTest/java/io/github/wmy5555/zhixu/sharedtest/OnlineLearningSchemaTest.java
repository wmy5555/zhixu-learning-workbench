package io.github.wmy5555.zhixu.sharedtest;

import android.test.AndroidTestCase;
import java.io.File;
import java.util.UUID;
import org.json.*;

/** Explicit online schema extension; legacy offline restrictions remain enforced with synthetic app-cache records. */
@SuppressWarnings("deprecation")
public final class OnlineLearningSchemaTest extends AndroidTestCase {
    private File root;
    private LocalLearningStore store;
    @Override protected void setUp() throws Exception { super.setUp(); root = new File(getContext().getCacheDir().getCanonicalFile(), "online-schema-test-" + UUID.randomUUID()); store = new LocalLearningStore(root, "formal"); }
    @Override protected void tearDown() throws Exception { if (root != null) delete(root); super.tearDown(); }
    private static void delete(File f) { if (f.isDirectory()) { File[] children = f.listFiles(); if (children != null) for (File c : children) delete(c); } if (f.exists() && !f.delete()) throw new AssertionError("Fixture cleanup failed"); }
    private JSONObject state() throws Exception { return new JSONObject().put("notes", new JSONArray()).put("records", new JSONObject()).put("settings", new JSONObject()).put("guide", new JSONObject()); }
    private JSONObject job(String context) throws Exception { return new JSONObject().put("id", UUID.randomUUID().toString()).put("onlineVersion", 1).put("type", "process").put("context", context).put("state", "queued").put("phase", "extract").put("progress", 0)
        .put("createdAt", "2026-10-12T00:00:00.000Z").put("updatedAt", "2026-10-12T00:00:00.000Z").put("dedupKey", "synthetic")
        .put("payload", new JSONObject().put("noteId", UUID.randomUUID().toString()).put("hash", "synthetic-hash").put("research", false).put("reuseExtracted", false)).put("requests", new JSONObject()); }
    interface Action { void run() throws Exception; }
    private void invalid(Action action) throws Exception { try { action.run(); fail("Expected schema rejection"); } catch (LocalSourceStore.StoreException e) { assertEquals("VALIDATION", e.code); } }
    public void testOnlineJobsReopenAndBackupButNeverCredentialsOrAuthorization() throws Exception {
        JSONObject state = state(), job = job("formal"); job.getJSONObject("requests").put("extract", new JSONObject().put("requestId", UUID.randomUUID().toString()).put("state", "unknown").put("capability", "model")); state.getJSONObject("records").put("jobs", new JSONObject().put(job.getString("id"), job));
        JSONObject saved = store.commit("empty", state); assertEquals(saved.toString(), new LocalLearningStore(root, "formal").load().toString());
        String pack = store.backup().toString(); assertTrue(pack.contains("unknown")); assertFalse(pack.contains("authorizationId")); assertFalse(pack.contains("credentials"));
        JSONObject rejected = new JSONObject(state.toString()); rejected.getJSONObject("records").getJSONObject("jobs").getJSONObject(job.getString("id")).put("checkpoint", new JSONObject().put("authorizationId", "synthetic-not-exportable"));
        invalid(() -> store.commit(saved.getString("revision"), rejected));
        assertEquals(saved.toString(), store.load().toString());
    }
    public void testWrongContextOldUnmarkedJobsAndUnknownNamespacesFailClosed() throws Exception {
        JSONObject wrong = state(), job = job("practice"); wrong.getJSONObject("records").put("jobs", new JSONObject().put(job.getString("id"), job)); invalid(() -> store.commit("empty", wrong));
        job.put("context", "formal"); job.remove("onlineVersion"); invalid(() -> store.commit("empty", wrong));
        JSONObject unknown = state(); unknown.getJSONObject("records").put("sourceStructures", new JSONObject()); invalid(() -> store.commit("empty", unknown));
        assertEquals("empty", store.load().getString("revision"));
    }
    public void testStructureJobUsesBoundedExplicitPayloadWithoutChangingLearningNotes() throws Exception {
        JSONObject state = state(), job = job("formal"); job.put("type", "structure").put("phase", "structure").put("payload", new JSONObject().put("noteId", UUID.randomUUID().toString()).put("hash", "synthetic-source-hash")
            .put("basis", new JSONArray().put(new JSONObject().put("id", UUID.randomUUID().toString()).put("hash", "synthetic-knowledge-hash")))
            .put("structure", new JSONObject().put("hierarchy", new JSONArray()).put("edges", new JSONArray())));
        state.getJSONObject("records").put("jobs", new JSONObject().put(job.getString("id"), job)); JSONObject saved = store.commit("empty", state);
        assertEquals(0, saved.getJSONObject("state").getJSONArray("notes").length()); assertEquals("structure", new LocalLearningStore(root, "formal").load().getJSONObject("state").getJSONObject("records").getJSONObject("jobs").getJSONObject(job.getString("id")).getString("type"));
    }
    public void testOfflineEvidenceCannotClaimMasteryAndAmbiguousOnlineCannotSettle() throws Exception {
        JSONObject state = state(), evidence = evidence(); evidence.remove("assessmentMode"); evidence.put("assessment", "unassessed"); state.getJSONObject("records").put("studyEvidence", new JSONObject().put("synthetic", evidence)); invalid(() -> store.commit("empty", state));
        evidence.put("assessmentMode", "online").put("assessment", "ambiguous").put("ambiguous", true); invalid(() -> store.commit("empty", state));
        evidence.put("reviewSettled", false).put("independent", false).put("explanationPractice", false); store.commit("empty", state);
    }
    public void testOnlineQueueCheckpointAndDraftLifecycleKeepOptionalFieldsOptional() throws Exception {
        JSONObject state = state(), jobs = new JSONObject(), process = job("formal"), structure = job("formal"), ask = job("formal"), grade = job("formal");
        structure.put("type", "structure").put("payload", new JSONObject().put("noteId", "source").put("hash", "source-hash").put("basis", new JSONArray()));
        ask.put("type", "ask").put("payload", new JSONObject().put("question", "问题").put("scope", new JSONArray().put("source")).put("mode", "draft").put("privacy", "local").put("basis", new JSONArray()));
        grade.put("type", "grade").put("payload", new JSONObject().put("sessionId", "session").put("turnId", "turn"));
        for (JSONObject job : new JSONObject[] {process, structure, ask, grade}) jobs.put(job.getString("id"), job);
        JSONObject records = state.getJSONObject("records"); records.put("jobs", jobs);
        JSONObject saved = store.commit("empty", state);
        process.put("state", "running").put("error", "").put("code", JSONObject.NULL).put("extractionSaved", true).put("researchProgress", new JSONObject().put("total", 1).put("covered", 1).put("verified", 0));
        process.getJSONObject("payload").put("savedCandidates", new JSONObject().put("ids", new JSONArray().put("candidate"))).put("extracted", new JSONObject().put("candidates", new JSONArray().put(new JSONObject().put("title", "知识").put("body", "内容").put("claims", new JSONArray().put("主张")))));
        JSONObject draft = new JSONObject().put("id", "draft").put("onlineVersion", 1).put("mode", "draft").put("question", "问题").put("body", "可编辑草稿").put("citations", new JSONArray().put(new JSONObject().put("id", "source").put("title", "原文").put("excerpt", "摘录").put("sources", new JSONArray())))
            .put("limitations", new JSONArray().put("尚未生成 AI 内容。")).put("usedIds", new JSONArray()).put("createdAt", "2026-10-12T00:00:00.000Z");
        records.put("drafts", new JSONObject().put("draft", draft));
        records.put("sessions", new JSONObject().put("session", new JSONObject().put("id", "session").put("noteId", "source").put("sourceHash", "source-hash").put("assessmentMode", "online").put("status", "feedback").put("material", "原文材料").put("hintCount", 0).put("turns", new JSONArray())
            .put("feedback", new JSONObject().put("assessment", "partial").put("feedback", "还需要补充解释。"))));
        records.put("proposals", new JSONObject().put("proposal", new JSONObject().put("id", "proposal").put("onlineVersion", 1).put("noteId", "candidate").put("expectedHash", "candidate-hash").put("body", "研究修订建议").put("meta", new JSONObject()).put("state", "pending").put("reason", "保留人工修改").put("createdAt", "2026-10-12T00:00:00.000Z")));
        records.put("research", new JSONObject().put("research", new JSONObject().put("id", "research").put("onlineVersion", 1).put("sourceId", "source").put("sourceHash", "source-hash").put("claim", "主张").put("at", "2026-10-12T00:00:00.000Z")
            .put("result", new JSONObject().put("claim", "主张").put("evidence", new JSONArray()).put("limitations", new JSONArray().put("未取得网页正文。")).put("conclusion", "尚待核验。").put("coverage", "incomplete"))));
        saved = store.commit(saved.getString("revision"), state);
        draft.put("updatedAt", "2026-10-12T01:00:00.000Z").put("usedIds", new JSONArray().put("source"));
        records.put("uses", new JSONObject().put("use", new JSONObject().put("id", "use").put("onlineVersion", 1).put("draftId", "draft").put("noteId", "source").put("actualUse", true).put("at", "2026-10-12T01:00:00.000Z")));
        saved = store.commit(saved.getString("revision"), state);
        assertEquals(saved.toString(), new LocalLearningStore(root, "formal").load().toString());
        final String revision = saved.getString("revision");
        process.put("unexpected", true); invalid(() -> store.commit(revision, state)); process.remove("unexpected");
        Object research = process.getJSONObject("payload").remove("research"); invalid(() -> store.commit(revision, state)); process.getJSONObject("payload").put("research", research);
        process.put("checkpoint", "not-an-object"); invalid(() -> store.commit(revision, state)); process.remove("checkpoint");
        ask.getJSONObject("payload").put("basis", "not-an-array"); invalid(() -> store.commit(revision, state)); ask.getJSONObject("payload").put("basis", new JSONArray());
        draft.put("updatedAt", false); invalid(() -> store.commit(revision, state));
        assertEquals(saved.toString(), store.load().toString());
    }
    private JSONObject evidence() throws Exception { return new JSONObject().put("assessmentMode", "online").put("assessment", "correct").put("reviewSettled", true).put("independent", true).put("explanationPractice", true).put("applicationPractice", false).put("spacedRecall", false).put("usedHints", false).put("errorObserved", false).put("ambiguous", false); }
}
