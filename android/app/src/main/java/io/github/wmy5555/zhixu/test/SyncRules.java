package io.github.wmy5555.zhixu.test;

/** Transport-independent merge rule; dirty drafts never disappear on refresh. */
public final class SyncRules {
    private SyncRules() {}
    public enum Decision { USE_REMOTE, ACKNOWLEDGED, KEEP_LOCAL, CONFLICT }
    public static Decision decide(boolean dirty, String baseHash, String remoteHash,
                                  String title, String body, String remoteTitle, String remoteBody) {
        if (!dirty) return Decision.USE_REMOTE;
        if (title.equals(remoteTitle) && body.equals(remoteBody)) return Decision.ACKNOWLEDGED;
        if (baseHash.equals(remoteHash)) return Decision.KEEP_LOCAL;
        return Decision.CONFLICT;
    }
}
