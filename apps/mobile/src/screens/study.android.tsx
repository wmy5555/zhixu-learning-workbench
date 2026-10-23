import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useResource, useWorkbench } from "../services/app-state";
import { Body, Status, useWorkbenchNavigation } from "../components/workbench-ui";
import {
  Action, EmptyState, Icon, PageHeading, Panel, SectionHeading, useAndroidPalette,
} from "../components/android-design";

const statusLabel = (status: string) => status === "completed" ? "已结束"
  : status === "awaiting_feedback" ? "等待反馈" : "继续练习";

function sessionDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date) : "";
}

export default function Study() {
  const c = useAndroidPalette();
  const { router, openNote } = useWorkbenchNavigation();
  const { api, working } = useWorkbench();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const r = useResource("/api/study?limit=30&offset=" + offset);
  const today = useResource("/api/today");
  const sessions: any[] = r.data?.sessions || [];
  const pending: any[] = (today.data?.items || []).filter((p: any) => p.state === "pending");
  // These are actual sessions from the displayed history page, never a mock question.
  const unfinished = [...sessions].filter((s) => s.status !== "completed")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  const plan = pending[0];

  function openSession(id: string) {
    router.push({ pathname: "/session/[id]", params: { id } } as any);
  }

  async function start() {
    if (working || !plan) return;
    setError("");
    try {
      const s = await api.post("/api/study/start", {
        noteId: plan.noteId, planId: plan.id, topicId: plan.topicId, mistakeId: plan.mistakeId,
      });
      openSession(s.id);
    } catch (e) { setError((e as Error).message); }
  }

  const card = unfinished || plan;
  const warnings: string[] = card?.materialWarnings || [];
  return (
    <Status resource={r}>
      <Body>
        <PageHeading title="让理解，变成自己的。" eyebrow="LEARN / IN YOUR OWN WORDS" />
        {error ? <Panel><Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 14, lineHeight: 22 }}>{error}</Text></Panel> : null}
        {today.error ? <Panel>
          <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 14, lineHeight: 22 }}>{today.error}</Text>
          <Action title="重新读取今日安排" kind="text" onPress={today.refresh} />
        </Panel> : null}
        {today.data === undefined && !today.error && !unfinished ? <ActivityIndicator accessibilityLabel="正在读取今日安排" color={c.accent} /> : null}
        {card || today.data !== undefined ? <>
          {card ? <Panel style={{ alignItems: "center", paddingHorizontal: 24, paddingVertical: 29, gap: 18 }}>
            <Icon name="learn" size={32} color={c.accent} />
            <Text style={{ color: c.muted, fontSize: 11, letterSpacing: 1 }}>{unfinished ? "接着自己的思考" : "一次有意识的回想"}</Text>
            <Text style={{ color: c.text, fontFamily: "serif", fontSize: 26, lineHeight: 40, textAlign: "center" }}>{unfinished ? unfinished.question : plan.title}</Text>
            <Text style={{ color: c.muted, fontSize: 13, lineHeight: 22, textAlign: "center" }}>
              {unfinished ? [unfinished.goal, statusLabel(unfinished.status)].filter(Boolean).join(" · ") : `${plan.minutes} 分钟 · ${plan.reason}`}
            </Text>
            {warnings.map((warning, index) => <Text key={index} style={{ color: c.muted, fontSize: 13, lineHeight: 22, textAlign: "center" }}>{warning}</Text>)}
            <Action title={unfinished ? (unfinished.status === "awaiting_feedback" ? "查看这次练习" : "继续练习") : "开始这一小步"} icon="arrow" disabled={!unfinished && working} onPress={() => unfinished ? openSession(unfinished.id) : void start()} />
            <Action title="先看原文" kind="text" onPress={() => openNote(card.noteId)} />
          </Panel> : <EmptyState title="学习从一份资料开始" detail="收集一份资料，或从知识库选择想继续理解的内容。" action={<View style={{ gap: 8 }}>
            <Action title="留下一份资料" icon="plus" onPress={() => router.navigate("/(tabs)/capture" as any)} />
            <Action title="去知识库选择" kind="text" onPress={() => router.navigate("/(tabs)/library" as any)} />
          </View>} />}
        </> : null}

        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 17, gap: 28 }}>
          {today.data ? <View style={{ gap: 6 }}>
            <Text style={{ color: c.text, fontFamily: "serif", fontSize: 27 }}>{pending.length}</Text>
            <Text style={{ color: c.muted, fontSize: 11 }}>今日待学</Text>
          </View> : null}
          <View style={{ gap: 6 }}>
            <Text style={{ color: c.text, fontFamily: "serif", fontSize: 27 }}>{r.data?.total ?? 0}</Text>
            <Text style={{ color: c.muted, fontSize: 11 }}>学习记录</Text>
          </View>
          {typeof today.data?.budget === "number" ? <View style={{ gap: 6 }}>
            <Text style={{ color: c.text, fontFamily: "serif", fontSize: 27 }}>{today.data.budget}<Text style={{ fontSize: 12 }}> 分钟</Text></Text>
            <Text style={{ color: c.muted, fontSize: 11 }}>今日预算</Text>
          </View> : null}
        </View>

        <SectionHeading title="学习记录" />
        {sessions.length ? <View>
          {sessions.map((s) => <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`${s.question}，${statusLabel(s.status)}`} onPress={() => openSession(s.id)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 13, minHeight: 76, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: pressed ? c.tint : "transparent" })}>
            <View style={{ width: 29, height: 29, borderRadius: 15, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}><Icon name={s.status === "completed" ? "check" : "pen"} size={14} color={c.accent} /></View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text numberOfLines={3} style={{ color: c.text, fontSize: 14, lineHeight: 23 }}>{s.question}</Text>
              <Text style={{ color: c.muted, fontSize: 11, lineHeight: 18 }}>{[sessionDate(s.createdAt), statusLabel(s.status)].filter(Boolean).join(" · ")}</Text>
            </View>
            <Icon name="right" size={15} color={c.subtle} />
          </Pressable>)}
        </View> : <Text style={{ color: c.muted, fontSize: 14, lineHeight: 23 }}>{offset ? "这一页还没有学习记录。" : "第一次尝试，会从这里留下。"}</Text>}
        {offset > 0 || (r.data?.total || 0) > 30 ? <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <Action title="上一页" kind="text" disabled={offset === 0 || r.loading} onPress={() => setOffset((n) => Math.max(0, n - 30))} />
          <Text style={{ color: c.muted, fontSize: 12 }}>第 {offset / 30 + 1} 页</Text>
          <Action title="下一页" kind="text" disabled={offset + 30 >= (r.data?.total || 0) || r.loading} onPress={() => setOffset((n) => n + 30)} />
        </View> : null}
      </Body>
    </Status>
  );
}
