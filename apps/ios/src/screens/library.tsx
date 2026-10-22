import React, { useState } from "react";
import { FlatList, View } from "react-native";
import { useResource } from "../services/app-state";
import {
  Choices,
  Field,
  Label,
  Row,
  Status,
  openNote,
  usePalette,
} from "../components/workbench-ui";
export default function Library() {
  const [q, setQ] = useState(""),
    [kind, setKind] = useState("");
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
            onPress={() => openNote(n.id)}
          />
        )}
      />
    </Status>
  );
}
