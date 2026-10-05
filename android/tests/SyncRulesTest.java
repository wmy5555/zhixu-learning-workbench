package io.github.wmy5555.zhixu.test;

public final class SyncRulesTest {
    private static void expect(SyncRules.Decision wanted, boolean dirty, String base, String remote,
                               String title, String body, String remoteTitle, String remoteBody) {
        var got = SyncRules.decide(dirty, base, remote, title, body, remoteTitle, remoteBody);
        if (got != wanted) throw new AssertionError("Wanted " + wanted + ", got " + got);
    }
    public static void main(String[] args) {
        expect(SyncRules.Decision.USE_REMOTE, false, "old", "new", "甲", "正文", "乙", "更新");
        expect(SyncRules.Decision.KEEP_LOCAL, true, "old", "old", "手机编辑", "未发送", "甲", "正文");
        expect(SyncRules.Decision.CONFLICT, true, "old", "new", "手机编辑", "手机内容", "电脑编辑", "电脑内容");
        expect(SyncRules.Decision.ACKNOWLEDGED, true, "old", "new", "手机编辑", "已保存", "手机编辑", "已保存");
        expect(SyncRules.Decision.CONFLICT, true, "old", "new", "同标题", "手机内容", "同标题", "电脑内容");
        System.out.println("5 Java merge decisions passed; no Android SDK or device used.");
    }
}
