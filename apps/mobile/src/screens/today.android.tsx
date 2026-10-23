import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useResource, useWorkbench } from "../services/app-state";
import { Body, Status, useWorkbenchNavigation } from "../components/workbench-ui";
import {
  Action, Caption, EmptyState, Icon, Panel, SectionHeading, useAndroidPalette,
} from "../components/android-design";

const planStates: Record<string, string> = {
  done: "已完成", skip: "今日跳过", defer: "已延期", pause: "已暂停",
  paused: "已暂停", budget_deferred: "留待以后",
};

function calendarLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return { day: "", detail: value || "" };
  // The server's learning date already reflects its configured timezone.
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return {
    day: String(day).padStart(2, "0"),
    detail: `${month} 月 · ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]}`,
  };
}

export default function Today() {
  const c = useAndroidPalette();
  const { router, openNote } = useWorkbenchNavigation();
  const r = useResource("/api/today");
  const { api, working, practiceId } = useWorkbench();
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const d = r.data;
  const plans: any[] = d?.items || [];
  const pending = plans.filter((p) => p.state === "pending");
  const lead = pending[0];
  const date = calendarLabel(d?.date);
  const reserved = plans.filter((p) => p.state === "pending" || p.state === "done")
    .reduce((sum, p) => sum + (Number(p.minutes) || 0), 0);
  const ticks = d?.budget > 0 ? Math.min(8, Math.round(reserved / d.budget * 8)) : 0;

  async function start(p: any) {
    if (working) return;
    setError("");
    try {
      const s = await api.post("/api/study/start", {
        noteId: p.noteId, planId: p.id, topicId: p.topicId, mistakeId: p.mistakeId,
      });
      router.push({ pathname: "/session/[id]", params: { id: s.id } } as any);
    } catch (e) { setError((e as Error).message); }
  }

  async function changePlan(p: any, action: string) {
    if (working) return;
    setError("");
    try {
      await api.post(`/api/today/${encodeURIComponent(p.id)}/action`, { action });
      setExpanded(null);
    } catch (e) { setError((e as Error).message); }
  }

  async function regenerate() {
    if (working) return;
    setError("");
    try { await api.post("/api/today/generate"); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <Status resource={r}>
      <Body>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 16, paddingTop: 4 }}>
          <View style={{ flex: 1, gap: 12 }}>
            <Caption>{practiceId ? "练习空间 · EVERY DAY" : "A LITTLE LEARNING, EVERY DAY"}</Caption>
            <Text style={{ color: c.text, fontFamily: "serif", fontSize: 27, lineHeight: 39 }}>
              把今天的理解，{"\n"}再往前推一点。
            </Text>
          </View>
          {date.day ? <View style={{ alignItems: "flex-end", paddingTop: 5, gap: 3 }}>
            <Text style={{ color: c.accent, fontFamily: "serif", fontSize: 36, lineHeight: 42 }}>{date.day}</Text>
            <Text style={{ color: c.muted, fontSize: 11, lineHeight: 18 }}>{date.detail}</Text>
          </View> : null}
        </View>

        {error ? <Panel><Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 14, lineHeight: 22 }}>{error}</Text></Panel> : null}

        <Panel style={{ padding: 23, gap: 19, overflow: "hidden" }}>
          <View pointerEvents="none" style={{ position: "absolute", right: 8, top: 22, opacity: 0.12 }}>
            <Icon name="leaf" size={100} color={c.accent} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Icon name={lead ? "book" : "spark"} size={15} color={c.accent} />
            <Text style={{ color: c.accent, fontSize: 12 }}>{lead ? "接着这份思考" : "从一个问题开始"}</Text>
          </View>
          <Text style={{ color: c.text, fontFamily: "serif", fontSize: 27, lineHeight: 40, paddingRight: 20 }}>
            {lead ? "读懂之后，\n试着自己说一次。" : "留点余地，\n让理解慢慢生长。"}
          </Text>
          {lead ? <Text style={{ color: c.muted, fontSize: 14, lineHeight: 23 }}>{lead.title} · {lead.minutes} 分钟</Text> : null}
          {lead?.materialWarnings?.map((warning: string, index: number) => (
            <Text key={index} style={{ color: c.muted, fontSize: 13, lineHeight: 21 }}>{warning}</Text>
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <Action title={lead ? "开始学习" : "留下一个新起点"} icon="arrow"
              disabled={lead ? working : false}
              onPress={() => lead ? void start(lead) : router.navigate("/(tabs)/capture" as any)} />
            {lead ? <Action title="先看原文" kind="text" onPress={() => openNote(lead.noteId)} /> : null}
          </View>
        </Panel>

        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, paddingVertical: 2 }}>
          <Text style={{ color: c.muted, fontSize: 12 }}>今日预算 {d?.budget ?? 0} 分钟</Text>
          <View accessibilityLabel={`已安排 ${reserved} 分钟`} style={{ flexDirection: "row", gap: 3, flex: 1, minWidth: 65 }}>
            {Array.from({ length: 8 }, (_, index) => <View key={index} style={{ flex: 1, maxWidth: 8, height: 12, borderRadius: 1, backgroundColor: index < ticks ? c.accent : c.line }} />)}
          </View>
          <Text style={{ color: c.muted, fontSize: 12 }}>待学 {d?.minutes ?? 0} 分钟</Text>
        </View>

        <SectionHeading title="今日安排" action={<Action title={working ? "正在处理" : "更新安排"} kind="text" disabled={working} onPress={() => void regenerate()} />} />
        {plans.length ? <View>
          {plans.map((p, index) => <View key={p.id} style={{ borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 15, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
              <Text style={{ color: c.subtle, fontFamily: "serif", fontSize: 18 }}>{String(index + 1).padStart(2, "0")}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`阅读 ${p.title}`} onPress={() => openNote(p.noteId)} style={{ flex: 1, minHeight: 48, justifyContent: "center", gap: 4 }}>
                <Text style={{ color: c.text, fontFamily: "serif", fontSize: 19, lineHeight: 28 }}>{p.title}</Text>
                <Text style={{ color: c.muted, fontSize: 12, lineHeight: 19 }}>{p.minutes} 分钟 · {p.state === "pending" ? p.reason : planStates[p.state] || p.state}</Text>
              </Pressable>
              {p.state === "pending" ? <Action title="开始" kind="text" disabled={working} onPress={() => void start(p)} /> : null}
              {p.state === "pending" ? <Pressable accessibilityRole="button" accessibilityLabel={`${p.title}，更多安排操作`} accessibilityState={{ expanded: expanded === p.id }} onPress={() => setExpanded(expanded === p.id ? null : p.id)} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
                <Icon name="more" size={18} color={c.muted} />
              </Pressable> : null}
            </View>
            {p.state === "pending" && expanded === p.id ? <View style={{ paddingLeft: 31 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                {[["skip", "今日跳过"], ["defer", "延期一天"], ["pause", "暂停学习"]].map(([action, title]) => <Action key={action} title={title} kind="secondary" disabled={working} onPress={() => void changePlan(p, action)} />)}
              </View>
            </View> : null}
          </View>)}
        </View> : <EmptyState title="今天的安排暂时是空的。" action={<Action title="从知识库选择" kind="text" onPress={() => router.navigate("/(tabs)/library" as any)} />} />}

        <View style={{ flexDirection: "row", gap: 15, paddingTop: 6 }}>
          <Pressable accessibilityRole="button" onPress={() => router.navigate("/(tabs)/capture" as any)} style={{ flex: 1, minHeight: 72, paddingVertical: 12, gap: 10, borderTopWidth: 1, borderTopColor: c.line }}>
            <Icon name="plus" size={20} color={c.accent} />
            <Text style={{ color: c.text, fontSize: 14 }}>随手记下</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/focus" as any)} style={{ flex: 1, minHeight: 72, paddingVertical: 12, gap: 10, borderTopWidth: 1, borderTopColor: c.line }}>
            <Icon name="clock" size={20} color={c.accent} />
            <Text style={{ color: c.text, fontSize: 14 }}>留一段专注</Text>
          </Pressable>
        </View>
      </Body>
    </Status>
  );
}
