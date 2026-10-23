import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  useResource,
  useWorkbench,
  useDraftFlush,
} from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Field,
  Label,
  Status,
  useWorkbenchNavigation,
} from "../components/workbench-ui";
import { Markdown } from "../components/native-markdown";
import runtime from "../platform/runtime.native.js";
export default function Session() {
  const { openForm } = useWorkbenchNavigation();
  const { id } = useLocalSearchParams<{ id: string }>(),
    r = useResource("/api/study/" + id),
    { api, working } = useWorkbench();
  const [answer, setAnswer] = useState(""),
    [reading, setReading] = useState(true),
    [hint, setHint] = useState(""),
    [error, setError] = useState(""),
    [hydrated, setHydrated] = useState(false);
  const intent = useRef(runtime.uuid()),
    s = r.data;
  useEffect(() => {
    api
      .get("/api/draft-work?id=session-" + id)
      .then((d) => {
        setAnswer(d.answer || "");
        setHydrated(true);
      })
      .catch((e) => setError(e.message));
  }, [api, id]);
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      void api
        .put("/api/draft-work", { id: "session-" + id, value: { answer } })
        .catch((e) => setError(e.message));
    }, 700);
    return () => clearTimeout(timer);
  }, [api, answer, hydrated, id]);
  const saveDraft = useCallback(
    () =>
      hydrated
        ? api.put("/api/draft-work", { id: "session-" + id, value: { answer } })
        : Promise.resolve(),
    [api, hydrated, id, answer],
  );
  useDraftFlush(saveDraft);
  async function submit() {
    try {
      await saveDraft();
      await api.post(`/api/study/${id}/answer`, {
        answer,
        requestId: intent.current,
      });
      intent.current = runtime.uuid();
      setAnswer("");
      await api.remove("/api/draft-work", { id: "session-" + id });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Status resource={r}>
      <Body form>
        <Label large>{s?.goal || "练习"}</Label>
        {error ? <Label>{error}</Label> : null}
        <Card>
          <Label>{s?.question}</Label>
          {s?.materialWarnings?.map((w: string, i: number) => (
            <Label key={i} muted>
              {w}
            </Label>
          ))}
        </Card>
        {reading ? (
          <>
            <Markdown body={s?.material || ""} />
            <Button
              title="合上材料，开始作答"
              onPress={() => setReading(false)}
            />
          </>
        ) : (
          <Button
            title="再看原文"
            secondary
            onPress={async () => {
              try {
                const h = await api.post(`/api/study/${id}/hint`);
                setHint(h.hint);
                setReading(true);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        )}
        {s?.turns?.map((turn: any) => (
          <Card key={turn.id}>
            <Label>我的回答</Label>
            <Markdown body={turn.answer} />
            {turn.feedback ? (
              <>
                <Label>AI 反馈</Label>
                <Markdown
                  body={
                    turn.feedback.feedback ||
                    turn.feedback.explanation ||
                    turn.feedback.reason ||
                    JSON.stringify(turn.feedback)
                  }
                />
                {turn.feedback.nextQuestion ? (
                  <Label>{turn.feedback.nextQuestion}</Label>
                ) : null}
              </>
            ) : (
              <Label muted>回答已保存，等待反馈。</Label>
            )}
          </Card>
        ))}
        {s?.status !== "completed" ? (
          <>
            <Field
              label="我的回答"
              value={answer}
              onChange={(v) => {
                setAnswer(v);
                intent.current = runtime.uuid();
              }}
              multiline
            />
            <Button
              title="保存草稿"
              secondary
              disabled={working}
              onPress={() => void saveDraft().catch((e) => setError(e.message))}
            />
            <Button
              title="提交回答"
              disabled={
                working || !answer.trim() || s?.status === "awaiting_feedback"
              }
              onPress={() => void submit()}
            />
            <Button
              title="提示"
              secondary
              disabled={working}
              onPress={async () => {
                try {
                  const h = await api.post(`/api/study/${id}/hint`);
                  setHint(h.hint);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
            {hint ? <Label>{hint}</Label> : null}
            <Button
              title="结束本轮练习"
              disabled={working || !s?.turns?.length || s?.pendingJobId}
              onPress={() =>
                void api
                  .post(`/api/study/${id}/finish`)
                  .catch((e) => setError(e.message))
              }
            />
          </>
        ) : (
          <Card>
            <Label>{s?.completion?.reason}</Label>
          </Card>
        )}
        <Button
          title="确认个人理解"
          secondary
          onPress={() => openForm("study-confirm", id)}
        />
      </Body>
    </Status>
  );
}
