import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWorkbench, useDraftFlush } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Field,
  Label,
  Toggle,
  useWorkbenchNavigation,
} from "../components/workbench-ui";
import { pickFile } from "../services/files";
import runtime from "../platform/runtime.native.js";
import { afterTextSave } from "../services/capture-state.mjs";
function CaptureForm() {
  const { router, openNote } = useWorkbenchNavigation();
  const { api, working } = useWorkbench();
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [process, setProcess] = useState(false),
    [research, setResearch] = useState(false),
    [error, setError] = useState(""),
    [hydrated, setHydrated] = useState(false),
    [pendingFile, setPendingFile] = useState<any>(null),
    [metadata, setMetadata] = useState<any>({}),
    [showMetadata, setShowMetadata] = useState(false);
  const currentDraft = useRef({ title, body, metadata, pendingFile });
  useLayoutEffect(() => {
    currentDraft.current = { title, body, metadata, pendingFile };
  }, [title, body, metadata, pendingFile]);
  const flushDraft = useCallback(
    () =>
      hydrated
        ? api.put("/api/draft-work", {
            id: "capture",
            value: currentDraft.current,
          })
        : Promise.resolve(),
    [api, hydrated],
  );
  useDraftFlush(flushDraft);
  useEffect(() => {
    api
      .get("/api/draft-work?id=capture")
      .then((d) => {
        setTitle(d.title || "");
        setBody(d.body || "");
        setMetadata(d.metadata || {});
        setPendingFile(d.pendingFile || null);
        setProcess(false);
        setResearch(false);
        setHydrated(true);
      })
      .catch((e) => setError(e.message));
  }, [api]);
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
      if (!next.changed) {
        setBody("");
        setTitle("");
      }
      setProcess(false);
      setResearch(false);
      await api.put("/api/draft-work", { id: "capture", value: next.draft });
      if (next.changed) setError("提交时的原文已保存，后续输入仍保留在这里。");
      else if (result.notes?.[0]) openNote(result.notes[0].id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function choose() {
    try {
      const f = await pickFile();
      if (!f) return;
      if (/\.(md|txt|markdown)$/i.test(f.name)) {
        if ((f.size || 0) > 2 * 1024 * 1024) throw Error("文本文件最多 2 MB");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          await f.file.bytes(),
        );
        if (!text.trim() || text.length > 500000)
          throw Error("正文为空或超过 50 万字符");
        if (body.trim()) {
          setError("请先保存当前输入，再导入文本。");
          return;
        }
        setTitle(f.name.replace(/\.[^.]+$/, ""));
        setBody(text);
        return;
      }
      const uploadId = runtime.uuid();
      const upload = await api.post(
        `/api/uploads?name=${encodeURIComponent(f.name)}&uploadId=${uploadId}`,
        { mime: f.mimeType, base64: await f.file.base64() },
      );
      setPendingFile({ uploadId: upload.id, title: f.name });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Body form>
      <Label large>收集</Label>
      {error ? <Label>{error}</Label> : null}
      <Field label="标题" value={title} onChange={setTitle} />
      <Field label="原始资料" value={body} onChange={setBody} multiline />
      <Button
        title="来源信息"
        secondary
        onPress={() => setShowMetadata((v) => !v)}
      />
      {showMetadata
        ? Object.entries({
            platform: "来源平台",
            url: "来源网址",
            author: "作者",
            date: "日期（YYYY-MM-DD）",
            locator: "页码或位置",
          }).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={metadata[key] || ""}
              onChange={(v) => setMetadata((m: any) => ({ ...m, [key]: v }))}
            />
          ))
        : null}
      <Toggle
        label="AI 拆解"
        value={process}
        onChange={(v) => {
          setProcess(v);
          if (!v) setResearch(false);
        }}
      />
      <Toggle
        label="拆解时联网检验"
        value={research}
        disabled={!process}
        onChange={setResearch}
      />
      <Button
        title="保存原文"
        disabled={working || !hydrated || !body.trim()}
        onPress={() => void save()}
      />
      <Button
        title="选择文件"
        secondary
        disabled={working || !!pendingFile}
        onPress={() => void choose()}
      />
      <Button
        title="批量导入文本"
        secondary
        disabled={working}
        onPress={() => router.push("/batch" as any)}
      />
      {pendingFile ? (
        <Card>
          <Label>{pendingFile.title}</Label>
          <Button
            title="保存原件"
            disabled={working}
            onPress={async () => {
              try {
                const r = await api.post("/api/file-import", pendingFile);
                setPendingFile(null);
                openNote(r.note.id);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
          <Button
            title="移除暂存"
            secondary
            disabled={working}
            onPress={async () => {
              try {
                await api.remove("/api/uploads/" + pendingFile.uploadId);
                setPendingFile(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </Card>
      ) : null}
    </Body>
  );
}

export default function Capture() {
  const { practiceId } = useWorkbench();
  return <CaptureForm key={practiceId} />;
}
