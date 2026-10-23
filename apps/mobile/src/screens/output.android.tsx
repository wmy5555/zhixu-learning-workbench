import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useWorkbench, useDraftFlush } from "../services/app-state";
import { Body, Choices, Toggle, useWorkbenchNavigation } from "../components/workbench-ui";
import { Action, Caption, Icon, PageHeading, Panel, SectionHeading, useAndroidPalette } from "../components/android-design";
import { Markdown } from "../components/native-markdown";
import runtime from "../platform/runtime.native.js";
import { submitOutput } from "../services/output-submission.mjs";

function OutputForm() {
  const { openNote, openSection, openForm } = useWorkbenchNavigation();
  const { api, working } = useWorkbench();
  const c = useAndroidPalette();
  const [question, setQuestion] = useState(""), [mode, setMode] = useState("answer");
  const [cloud, setCloud] = useState(false), [scope, setScope] = useState("all");
  const [result, setResult] = useState<any>(null), [error, setError] = useState("");
  const [ready, setReady] = useState(false), [showScope, setShowScope] = useState(false), [retry, setRetry] = useState(0);
  const requestId = useRef(runtime.uuid());
  useEffect(() => {
    let current = true;
    api.get("/api/draft-work?id=output").then((saved) => {
      if (!current) return;
      setError("");
      setQuestion(saved.question || "");
      setMode(saved.mode || "answer");
      setScope(saved.scope || "all");
      // Restoring a draft never grants fresh outbound authorization.
      setCloud(false);
      if (saved.requestId && !saved.cloud) requestId.current = saved.requestId;
      setReady(true);
    }).catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [api, retry]);
  const save = useCallback(() => ready ? api.put("/api/draft-work", {
    id: "output", value: { question, mode, scope, cloud, requestId: requestId.current },
  }) : Promise.resolve(), [api, ready, question, mode, scope, cloud]);
  useDraftFlush(save);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void save().catch((e) => setError(e.message)), 500);
    return () => clearTimeout(timer);
  }, [ready, save]);
  function change(fn: () => void) {
    fn();
    requestId.current = runtime.uuid();
    setResult(null);
  }
  async function generate() {
    setError("");
    await submitOutput({
      input: {
        question, mode, scope: scope === "all" ? ["knowledge", "source"] : [scope],
        privacy: cloud ? "cloud" : "local", requestId: requestId.current,
      },
      save,
      ask: (snapshot: any) => api.post("/api/ask", snapshot),
      currentRequestId: () => requestId.current,
      onResult: setResult,
      onError: setError,
    });
  }
  return <Body form>
    <PageHeading title="从已有的理解出发。" eyebrow="MAKE SOMETHING OF YOUR IDEAS" />
    {error ? <Panel><Text selectable accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 14, lineHeight: 22 }}>{error}</Text>
      {!ready ? <Action title="重新读取输入" kind="text" onPress={() => { setError(""); setRetry((v) => v + 1); }} /> : null}
    </Panel> : null}
    {ready ? <>
      <View style={{ borderRadius: 16, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, paddingHorizontal: 16, paddingTop: 16 }}>
        <TextInput accessibilityLabel="问题或输出目标" placeholder="你想问什么，或写点什么？" placeholderTextColor={c.subtle}
          value={question} onChangeText={(v) => change(() => setQuestion(v))} multiline
          style={{ color: c.text, fontSize: 15, lineHeight: 26, minHeight: 132, padding: 0, paddingBottom: 16, textAlignVertical: "top" }} />
        <View style={{ borderTopWidth: 1, borderTopColor: c.line, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 8 }}>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {[["answer", "回答"], ["outline", "提纲"], ["draft", "草稿"]].map(([key, label]) =>
              <Pressable key={key} accessibilityRole="radio" accessibilityState={{ selected: mode === key }} onPress={() => change(() => setMode(key))}
                style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 13, alignItems: "center", justifyContent: "center", borderRadius: 8,
                  backgroundColor: mode === key ? c.tint : "transparent", opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: mode === key ? c.accent : c.muted, fontSize: 14 }}>{label}</Text>
              </Pressable>)}
          </View>
          <Action title={cloud ? "检索并生成" : "本地检索"} icon="arrow" disabled={working || !question.trim()} onPress={() => void generate()} />
        </View>
      </View>
      <View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showScope }} onPress={() => setShowScope((v) => !v)}
          style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: c.muted, fontSize: 14, flex: 1 }}>取材于 <Text style={{ color: c.accent }}>{scope === "all" ? "我的知识库" : scope === "knowledge" ? "知识" : "原始资料"}</Text>{cloud ? " · 使用外部模型" : ""}</Text>
          <Icon name={showScope ? "down" : "settings"} size={18} color={c.muted} />
        </Pressable>
        {showScope ? <View style={{ paddingVertical: 16, gap: 14 }}>
          <Choices label="取材范围" value={scope} onChange={(v) => change(() => setScope(v))}
            options={[["all", "全部"], ["knowledge", "知识"], ["source", "原始资料"]]} />
          <Toggle label="允许本次使用外部模型" value={cloud} onChange={(v) => change(() => setCloud(v))} />
        </View> : null}
      </View>
    </> : !error ? <Caption>正在恢复输入…</Caption> : null}
    {result ? <View style={{ paddingTop: 12, gap: 18 }}>
      <SectionHeading title={result.generated ? "AI 草稿" : "本地材料"} />
      <Markdown body={result.answer} />
      {result.limitations?.map((v: string, i: number) => <Caption key={i}>{v}</Caption>)}
      {result.citations?.length ? <View style={{ gap: 4 }}>
        <SectionHeading title="引用与依据" />
        {result.citations.map((n: any) => <Pressable key={n.id} accessibilityRole="button" onPress={() => openNote(n.id)}
          style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? 0.65 : 1 })}>
          <Icon name="book" size={18} color={c.accent} />
          <Text style={{ color: c.text, fontSize: 14, lineHeight: 23, flex: 1 }}>{n.title}</Text>
          <Icon name="right" size={16} color={c.muted} />
        </Pressable>)}
      </View> : null}
      <Action title="编辑与确认采用" onPress={() => openForm("draft", result.draftId)} />
    </View> : ready && !question.trim() ? <View style={{ gap: 6 }}>
      <SectionHeading title="试着问问" />
      {[
        ["把最近的笔记，连成一条线。", "把关于学习的笔记，整理成一份提纲"],
        ["我对这个问题，已经知道了什么？", "我记录过哪些帮助理解的方法？"],
      ].map(([title, prompt]) => <Pressable key={prompt} accessibilityRole="button" onPress={() => change(() => setQuestion(prompt))}
        style={({ pressed }) => ({ minHeight: 64, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: c.line,
          flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ color: c.text, fontFamily: "serif", fontSize: 18, lineHeight: 28, flex: 1 }}>{title}</Text>
        <Icon name="up" size={17} color={c.muted} />
      </Pressable>)}
    </View> : null}
    <Action title="输出草稿" icon="pen" kind="text" onPress={() => openSection("drafts")} />
  </Body>;
}

export default function Output() {
  const { practiceId } = useWorkbench();
  return <OutputForm key={practiceId} />;
}
