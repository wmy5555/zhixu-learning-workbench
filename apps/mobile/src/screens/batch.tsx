import React, { useState } from "react";
import * as Picker from "expo-document-picker";
import { File } from "expo-file-system";
import { Alert } from "react-native";
import { useNavigation, usePreventRemove } from "expo-router/react-navigation";
import { useWorkbench } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Label,
  Row,
  useWorkbenchNavigation,
} from "../components/workbench-ui";
export default function Batch() {
  const { openNote } = useWorkbenchNavigation();
  const { api, working } = useWorkbench(),
    [rows, setRows] = useState<any[]>([]),
    [running, setRunning] = useState(false),
    [error, setError] = useState("");
  const navigation = useNavigation();
  usePreventRemove(
    running || rows.some((r) => r.state !== "done"),
    ({ data }: any) => {
      if (running) {
        Alert.alert("正在导入", "请等待当前批次结束。");
        return;
      }
      Alert.alert(
        "离开本批导入？",
        "尚未完成的文件不会继续导入；已保存的原文保留。",
        [
          { text: "继续导入", style: "cancel" },
          {
            text: "离开",
            style: "destructive",
            onPress: () => navigation.dispatch(data.action),
          },
        ],
      );
    },
  );
  async function choose() {
    try {
      const result = await Picker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      if (!result.assets.length || result.assets.length > 100)
        throw Error("每批请选择 1–100 份文本。");
      const next = [];
      for (const item of result.assets) {
        if (
          !/\.(txt|md|markdown)$/i.test(item.name) ||
          (item.size || 0) > 2 * 1024 * 1024
        )
          throw Error(item.name + " 不是 2 MB 以内的文本文件");
        const body = new TextDecoder("utf-8", { fatal: true }).decode(
          await new File(item.uri).bytes(),
        );
        if (!body.trim() || body.length > 500000)
          throw Error(item.name + " 须为 1–500000 字符");
        next.push({
          title: item.name.replace(/\.[^.]+$/, ""),
          body,
          locator: item.name,
          state: "pending",
        });
      }
      setRows(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    if (running) return;
    setRunning(true);
    try {
      for (const row of rows.filter((r) => r.state !== "done")) {
        try {
          const result = await api.post("/api/import", {
            items: [
              {
                title: row.title,
                body: row.body,
                platform: "文本文件",
                locator: row.locator,
              },
            ],
            process: false,
            research: false,
          });
          if (!result.notes?.[0]?.id) throw Error("保存回执不完整");
          row.id = result.notes[0].id;
          row.state = "done";
          row.error = "";
        } catch (e) {
          row.state = "failed";
          row.error = (e as Error).message;
          setRows([...rows]);
          break;
        }
        setRows([...rows]);
      }
    } finally {
      setRunning(false);
    }
  }
  return (
    <Body>
      <Label large>批量文本导入</Label>
      {error ? <Label>{error}</Label> : null}
      <Button
        title="选择文本文件"
        disabled={working || running || rows.some((r) => r.state === "pending")}
        onPress={() => void choose()}
      />
      {rows.map((r, i) => (
        <Card key={i}>
          <Label>{r.title}</Label>
          <Label muted>
            {r.body.length} 字 ·{" "}
            {r.state === "done"
              ? "已保存"
              : r.state === "failed"
                ? "未完成"
                : "待导入"}
          </Label>
          {r.error ? <Label>{r.error}</Label> : null}
          {r.id ? (
            <Row title="打开原文" onPress={() => openNote(r.id)} />
          ) : null}
        </Card>
      ))}
      {rows.length ? (
        <Button
          title="保存未完成项目"
          disabled={working || running || rows.every((r) => r.state === "done")}
          onPress={() => void save()}
        />
      ) : null}
    </Body>
  );
}
