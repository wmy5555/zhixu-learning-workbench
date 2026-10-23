import React, { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import {
  readClock,
  transition,
  elapsed,
  dailyFocus,
} from "../reference/focus-model.mjs";
import { useWorkbench } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Choices,
  Field,
  Label,
} from "../components/workbench-ui";
import runtime from "../platform/runtime.native.js";
export default function Focus() {
  const { api } = useWorkbench(),
    focused = useIsFocused(),
    [clock, setClock] = useState<any>(null),
    [minutes, setMinutes] = useState("25"),
    [kind, setKind] = useState("focus"),
    [now, setNow] = useState(() => Date.now()),
    [active, setActive] = useState(AppState.currentState === "active"),
    [error, setError] = useState("");
  useEffect(() => {
    api
      .get("/api/draft-work?id=focus-clock")
      .then((v) => setClock(readClock(v)))
      .catch((e) => setError(e.message));
    const sub = AppState.addEventListener("change", (s) =>
      setActive(s === "active"),
    );
    return () => sub.remove();
  }, [api]);
  const move = useCallback(
    async (action: any) => {
      try {
        const next = transition(clock, action, Date.now());
        await api.put("/api/draft-work", { id: "focus-clock", value: next });
        setClock(next);
        setNow(Date.now());
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api, clock],
  );
  useEffect(() => {
    if (!focused || !active || clock?.active?.status !== "running") return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (elapsed(clock.active, at) >= clock.active.durationMs)
        void move({ type: "tick" });
    }, 1000);
    return () => clearInterval(timer);
  }, [focused, active, clock, move]);
  const remaining = clock?.active
    ? Math.max(
        0,
        Math.ceil(
          (clock.active.durationMs - elapsed(clock.active, now)) / 1000,
        ),
      )
    : Number(minutes) * 60;
  return (
    <Body>
      <Label large>专注</Label>
      {error ? <Label>{error}</Label> : null}
      <Card>
        <Label large>
          {Math.floor(remaining / 60)
            .toString()
            .padStart(2, "0")}
          :{(remaining % 60).toString().padStart(2, "0")}
        </Label>
        <Choices
          value={kind}
          onChange={setKind}
          options={[
            ["focus", "专注"],
            ["break", "休息"],
          ]}
        />
        <Field label="分钟" value={minutes} onChange={setMinutes} numeric />
        {!clock?.active || clock.active.status === "finished" ? (
          <Button
            title="开始"
            disabled={!clock}
            onPress={() =>
              void move({
                type: "start",
                id: runtime.uuid(),
                kind,
                minutes: Number(minutes),
              })
            }
          />
        ) : (
          <>
            <Button
              title={clock.active.status === "paused" ? "继续" : "暂停"}
              onPress={() =>
                void move({
                  type: clock.active.status === "paused" ? "resume" : "pause",
                })
              }
            />
            <Button
              title="结束"
              secondary
              onPress={() => void move({ type: "end" })}
            />
          </>
        )}
      </Card>
      {dailyFocus(clock?.records || [])
        .slice(0, 30)
        .map(([day, ms]: any) => (
          <Card key={day}>
            <Label>{day}</Label>
            <Label muted>{Math.round(ms / 60000)} 分钟</Label>
          </Card>
        ))}
    </Body>
  );
}
