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
    private JSONObject evidence() throws Exception { return new JSONObject().put("assessmentMode", "online").put("assessment", "correct").put("reviewSettled", true).put("independent", true).put("explanationPractice", true).put("applicationPractice", false).put("spacedRecall", false).put("usedHints", false).put("errorObserved", false).put("ambiguous", false); }
}
