import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useWorkbench, useDraftFlush } from "../services/app-state";
import { Body, Field, Toggle, useWorkbenchNavigation } from "../components/workbench-ui";
import { Action, Caption, Icon, PageHeading, Panel, useAndroidPalette } from "../components/android-design";
import { pickFile } from "../services/files";
import runtime from "../platform/runtime.native.js";
import { afterTextSave } from "../services/capture-state.mjs";

function CaptureForm() {
  const { router, openNote } = useWorkbenchNavigation();
  const { api, working } = useWorkbench();
  const c = useAndroidPalette();
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [process, setProcess] = useState(false),
    [research, setResearch] = useState(false),
    [error, setError] = useState(""),
    [hydrated, setHydrated] = useState(false),
    [pendingFile, setPendingFile] = useState<any>(null),
    [metadata, setMetadata] = useState<any>({}),
    [showMetadata, setShowMetadata] = useState(false),
    [showProcessing, setShowProcessing] = useState(false),
    [retry, setRetry] = useState(0);
  const currentDraft = useRef({ title, body, metadata, pendingFile });
  useLayoutEffect(() => {
    currentDraft.current = { title, body, metadata, pendingFile };
  }, [title, body, metadata, pendingFile]);
  const flushDraft = useCallback(
    () => hydrated
      ? api.put("/api/draft-work", { id: "capture", value: currentDraft.current })
      : Promise.resolve(),
    [api, hydrated],
  );
  useDraftFlush(flushDraft);
  useEffect(() => {
    let current = true;
    api.get("/api/draft-work?id=capture").then((d) => {
      if (!current) return;
      setError("");
      setTitle(d.title || "");
      setBody(d.body || "");
      setMetadata(d.metadata || {});
      setPendingFile(d.pendingFile || null);
      setProcess(false);
      setResearch(false);
      setHydrated(true);
    }).catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [api, retry]);
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      void flushDraft().catch((e) => setError(e.message));
    }, 700);
    return () => clearTimeout(timer);
  }, [flushDraft, hydrated, title, body, metadata, pendingFile]);
  async function save() {
    setError("");
    try {
      const submitted = currentDraft.current;
      const result = await api.post("/api/import", {
        items: [{ title, body, ...metadata }],
        process,
        research: process && research,
      });
      const next = afterTextSave(submitted, currentDraft.current);
      currentDraft.current = next.draft;
      if (!next.changed) { setBody(""); setTitle(""); }
      setProcess(false);
      setResearch(false);
      await api.put("/api/draft-work", { id: "capture", value: next.draft });
      if (next.changed) setError("提交时的原文已保存，后续输入仍保留在这里。");
      else if (result.notes?.[0]) openNote(result.notes[0].id);
    } catch (e) { setError((e as Error).message); }
  }
  async function choose() {
    setError("");
    try {
      const f = await pickFile();
      if (!f) return;
      if (/\.(md|txt|markdown)$/i.test(f.name)) {
        if ((f.size || 0) > 2 * 1024 * 1024) throw Error("文本文件最多 2 MB");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(await f.file.bytes());
        if (!text.trim() || text.length > 500000) throw Error("正文为空或超过 50 万字符");
        if (body.trim()) { setError("请先保存当前输入，再导入文本。"); return; }
        setTitle(f.name.replace(/\.[^.]+$/, ""));
        setBody(text);
        return;
      }
      const uploadId = runtime.uuid();
      const upload = await api.post(`/api/uploads?name=${encodeURIComponent(f.name)}&uploadId=${uploadId}`, {
        mime: f.mimeType, base64: await f.file.base64(),
      });
      setPendingFile({ uploadId: upload.id, title: f.name });
    } catch (e) { setError((e as Error).message); }
  }
  function disclosure(label: string, open: boolean, onPress: () => void, detail?: string) {
    return <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12,
        borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? 0.65 : 1 })}>
      <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{label}</Text>
      {detail ? <Text style={{ color: c.muted, fontSize: 12, flexShrink: 1 }}>{detail}</Text> : null}
      <Icon name={open ? "down" : "plus"} size={17} color={c.muted} />
    </Pressable>;
  }
  if (!hydrated) return <Body>
    <Caption>{error || "正在恢复草稿…"}</Caption>
    {error ? <Action title="重新读取草稿" onPress={() => { setError(""); setRetry((v) => v + 1); }} /> : null}
  </Body>;
  return <Body form>
    <PageHeading title="先把想法放在这里。" eyebrow="CAPTURE / A SMALL BEGINNING" />
    {error ? <Panel><Text selectable accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 14, lineHeight: 22 }}>{error}</Text></Panel> : null}
    <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 18, backgroundColor: c.surface, paddingHorizontal: 18, paddingTop: 14 }}>
      <TextInput accessibilityLabel="标题" placeholder="标题，留空也可以" placeholderTextColor={c.subtle}
        value={title} onChangeText={setTitle} multiline
        style={{ color: c.text, fontFamily: "serif", fontSize: 22, lineHeight: 32, minHeight: 50, padding: 0, paddingBottom: 12, textAlignVertical: "top" }} />
      <TextInput accessibilityLabel="原始资料" placeholder={"一段摘录、一个问题，\n或还没想清楚的念头。"} placeholderTextColor={c.subtle}
        value={body} onChangeText={setBody} multiline
        style={{ color: c.text, fontSize: 15, lineHeight: 26, minHeight: 176, padding: 0, paddingBottom: 14, textAlignVertical: "top" }} />
      <View style={{ borderTopWidth: 1, borderTopColor: c.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Action title="添加资料" icon="attach" kind="text" disabled={working || !!pendingFile} onPress={() => void choose()} />
        <Caption>{body.length.toLocaleString()} 字</Caption>
      </View>
    </View>
    <View>
      {disclosure("来源信息", showMetadata, () => setShowMetadata((v) => !v))}
      {showMetadata ? <View style={{ paddingVertical: 16, gap: 14 }}>
        {Object.entries({ platform: "来源平台", url: "来源网址", author: "作者", date: "日期（YYYY-MM-DD）", locator: "页码或位置" }).map(([key, label]) =>
          <Field key={key} label={label} value={metadata[key] || ""} onChange={(v) => setMetadata((m: any) => ({ ...m, [key]: v }))} />)}
      </View> : null}
      {disclosure("保存后如何处理", showProcessing, () => setShowProcessing((v) => !v), process ? research ? "AI 拆解 · 联网检验" : "AI 拆解" : "只保存原文")}
      {showProcessing ? <View style={{ paddingVertical: 12, gap: 8 }}>
        <Toggle label="AI 拆解" value={process} onChange={(v) => { setProcess(v); if (!v) setResearch(false); }} />
        <Toggle label="拆解时联网检验" value={research} disabled={!process} onChange={setResearch} />
      </View> : null}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Caption>{process ? "按已有授权和预算处理" : "留在自己的知识里"}</Caption>
      <Action title="保存原文" icon="arrow" disabled={working || !hydrated || !body.trim()} onPress={() => void save()} />
    </View>
    {pendingFile ? <Panel>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Icon name="file" size={20} color={c.accent} />
        <Text style={{ color: c.text, fontSize: 15, lineHeight: 23, flex: 1 }}>{pendingFile.title}</Text></View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action title="保存原件" disabled={working} onPress={async () => {
          try { setError(""); const r = await api.post("/api/file-import", pendingFile); setPendingFile(null); openNote(r.note.id); }
          catch (e) { setError((e as Error).message); }
        }} />
        <Action title="移除暂存" kind="text" disabled={working} onPress={async () => {
          try { setError(""); await api.remove("/api/uploads/" + pendingFile.uploadId); setPendingFile(null); }
          catch (e) { setError((e as Error).message); }
        }} />
      </View>
    </Panel> : null}
    <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 }}>
      <Action title="批量导入文本" icon="file" kind="text" disabled={working} onPress={() => router.push("/batch" as any)} />
    </View>
  </Body>;
}

export default function Capture() {
  const { practiceId } = useWorkbench();
  return <CaptureForm key={practiceId} />;
}
