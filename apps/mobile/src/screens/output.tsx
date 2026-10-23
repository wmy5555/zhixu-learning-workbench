import React, { useCallback, useEffect, useRef, useState } from "react";
import { useWorkbench, useDraftFlush } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Choices,
  Field,
  Label,
  Row,
  Toggle,
  useWorkbenchNavigation,
} from "../components/workbench-ui";
import { Markdown } from "../components/native-markdown";
import runtime from "../platform/runtime.native.js";

export default function Output() {
  const { openNote, openSection, openForm } = useWorkbenchNavigation();
  const { api, working } = useWorkbench();
  const [question, setQuestion] = useState(""),
    [mode, setMode] = useState("answer");
  const [cloud, setCloud] = useState(false),
    [scope, setScope] = useState("all");
  const [result, setResult] = useState<any>(null),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const requestId = useRef(runtime.uuid());
  useEffect(() => {
    let current = true;
    api
      .get("/api/draft-work?id=output")
      .then((saved) => {
        if (!current) return;
        setQuestion(saved.question || "");
        setMode(saved.mode || "answer");
        setScope(saved.scope || "all");
        // An old draft is never authorization for a new outbound request.
        if (saved.requestId && !saved.cloud)
          requestId.current = saved.requestId;
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => {
      current = false;
    };
  }, [api]);
  const save = useCallback(
    () =>
      ready
        ? api.put("/api/draft-work", {
            id: "output",
            value: {
              question,
              mode,
              scope,
              cloud,
              requestId: requestId.current,
            },
          })
        : Promise.resolve(),
    [api, ready, question, mode, scope, cloud],
  );
  useDraftFlush(save);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () => void save().catch((e) => setError(e.message)),
      500,
    );
    return () => clearTimeout(timer);
  }, [ready, save]);
  function change(fn: () => void) {
    fn();
    requestId.current = runtime.uuid();
    setResult(null);
  }
  async function generate() {
    setError("");
    try {
      await save();
      setResult(
        await api.post("/api/ask", {
          question,
          mode,
          scope: scope === "all" ? ["knowledge", "source"] : [scope],
          privacy: cloud ? "cloud" : "local",
          requestId: requestId.current,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Body form>
      <Label large>检索与应用</Label>
      <Row title="输出草稿" onPress={() => openSection("drafts")} />
      {error ? <Label>{error}</Label> : null}
      {ready ? (
        <>
          <Field
            label="问题或输出目标"
            value={question}
            onChange={(v) => change(() => setQuestion(v))}
            multiline
          />
          <Choices
            label="输出方式"
            value={mode}
            onChange={(v) => change(() => setMode(v))}
            options={[
              ["answer", "回答"],
              ["outline", "提纲"],
              ["draft", "草稿"],
            ]}
          />
          <Choices
            label="取材范围"
            value={scope}
            onChange={(v) => change(() => setScope(v))}
            options={[
              ["all", "全部"],
              ["knowledge", "知识"],
              ["source", "原始资料"],
            ]}
          />
          <Toggle
            label="允许本次使用外部模型"
            value={cloud}
            onChange={(v) => change(() => setCloud(v))}
          />
          <Button
            title={cloud ? "检索并生成" : "本地检索"}
            disabled={working || !question.trim()}
            onPress={() => void generate()}
          />
        </>
      ) : (
        <Label>正在恢复输入…</Label>
      )}
      {result ? (
        <Card>
          <Label>{result.generated ? "AI 草稿" : "本地材料"}</Label>
          <Markdown body={result.answer} />
          {result.limitations?.map((v: string, i: number) => (
            <Label key={i} muted>
              {v}
            </Label>
          ))}
          {result.citations?.map((n: any) => (
            <Row key={n.id} title={n.title} onPress={() => openNote(n.id)} />
          ))}
          <Button
            title="编辑与确认采用"
            onPress={() => openForm("draft", result.draftId)}
          />
        </Card>
      ) : null}
    </Body>
  );
}
