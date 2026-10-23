import React, { useState } from "react";
import { BackHandler, FlatList, View, useWindowDimensions } from "react-native";
import { useFocusEffect } from "expo-router";
import { useResource } from "../services/app-state";
import {
  Choices,
  Button,
  Field,
  Label,
  Row,
  Status,
  openNote,
  usePalette,
} from "../components/workbench-ui";
import { NoteContent } from "./note";
export default function Library() {
  const [q, setQ] = useState(""),
    [kind, setKind] = useState("");
  const [selected, setSelected] = useState("");
  const wide = useWindowDimensions().width >= 840;
  useFocusEffect(React.useCallback(() => {
    if (!selected) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected("");
      return true;
    });
    return () => listener.remove();
  }, [selected]));
  const r = useResource("/api/notes"),
    c = usePalette();
  const notes = (r.data?.notes || []).filter(
    (n: any) =>
      (!kind || n.kind === kind) &&
      (!q ||
        (n.title + " " + (n.body || ""))
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  return (
    <Status resource={r}>
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.background }}>
      <View style={wide ? { width: 340, borderRightWidth: 1, borderRightColor: c.line } : { flex: 1, display: selected ? "none" : "flex" }}>
      <FlatList
        style={{ backgroundColor: c.background }}
        contentContainerStyle={{ padding: 18, gap: 10, paddingBottom: 50 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        data={notes}
        keyExtractor={(n: any) => n.id}
        refreshing={r.loading}
        onRefresh={() => void r.refresh()}
        ListHeaderComponent={
          <View style={{ gap: 18, marginBottom: 16 }}>
            <Label large>知识库</Label>
            <Field label="查找" value={q} onChange={setQ} />
            <Choices
              value={kind}
              onChange={setKind}
              options={[
                ["", "全部"],
                ["source", "原始资料"],
                ["knowledge", "知识"],
                ["topic", "主题"],
                ["mistake", "错题"],
              ]}
            />
          </View>
        }
        ListEmptyComponent={
          <Label muted>
            {q ? "没有匹配内容。" : "从收集开始保存第一份资料。"}
          </Label>
        }
        renderItem={({ item: n }: any) => (
          <Row
            title={n.title}
            detail={n.meta?.topic || n.kind}
            onPress={() => wide ? setSelected(n.id) : openNote(n.id)}
          />
        )}
      />
      </View>
      {selected ? (
        <View style={{ flex: 1 }}>
          {!wide ? <Button title="返回列表" secondary onPress={() => setSelected("")} /> : null}
          <NoteContent key={selected} id={selected} />
        </View>
      ) : wide ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Label muted>选择一份资料开始阅读</Label>
        </View>
      ) : null}
      </View>
    </Status>
  );
}
