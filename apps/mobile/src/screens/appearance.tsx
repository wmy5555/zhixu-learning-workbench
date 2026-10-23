import React, { useState } from "react";
import { useWorkbench } from "../services/app-state";
import { useAppearance, setAppearance } from "../services/appearance";
import { validAccent } from "../reference/accent.mjs";
import {
  Body,
  Button,
  Choices,
  Field,
  Label,
} from "../components/workbench-ui";
export default function AppearanceScreen() {
  const { api, working } = useWorkbench(),
    saved = useAppearance(),
    [mode, setMode] = useState(saved.mode),
    [accent, setAccent] = useState(saved.accent),
    [error, setError] = useState("");
  return (
    <Body form>
      <Label large>外观</Label>
      <Choices
        label="主题"
        value={mode}
        onChange={setMode}
        options={[
          ["system", "跟随系统"],
          ["light", "浅色"],
          ["dark", "深色"],
        ]}
      />
      <Choices
        label="强调色"
        value={accent}
        onChange={setAccent}
        options={[
          ["#a25d40", "陶土"],
          ["#487c67", "松绿"],
          ["#5c75a5", "蓝灰"],
          ["#856492", "紫灰"],
        ]}
      />
      <Field label="颜色代码" value={accent} onChange={setAccent} />
      {error ? <Label>{error}</Label> : null}
      <Button
        title="保存外观"
        disabled={working || !validAccent(accent)}
        onPress={async () => {
          try {
            await api.put("/api/draft-work", {
              id: "appearance",
              value: { mode, accent },
            });
            setAppearance({ mode, accent });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      <Button
        title="恢复默认"
        secondary
        onPress={() => {
          setMode("system");
          setAccent("#a25d40");
        }}
      />
    </Body>
  );
}
