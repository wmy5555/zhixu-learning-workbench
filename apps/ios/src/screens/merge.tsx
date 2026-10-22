import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Alert } from "react-native";
import { useResource, useWorkbench } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Label,
  Row,
  Status,
  openNote,
} from "../components/workbench-ui";
import { Markdown } from "../components/native-markdown";
export default function Merge() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    r = useResource("/api/notes?kind=knowledge"),
    { api, working } = useWorkbench(),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState("");
  return (
    <Status resource={r}>
      <Body>
        <Label large>合并知识</Label>
        {error ? <Label>{error}</Label> : null}
        {!preview ? (
          (r.data?.notes || [])
            .filter((n: any) => n.id !== id)
            .map((n: any) => (
              <Row
                key={n.id}
                title={n.title}
                onPress={async () => {
                  try {
                    setPreview(
                      await api.post("/api/notes/merge", {
                        keepId: id,
                        mergeId: n.id,
                        preview: true,
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            ))
        ) : (
          <>
            <Label>{preview.warning}</Label>
            <Card>
              <Markdown body={preview.after} />
            </Card>
            <Button
              title="确认合并"
              disabled={working}
              onPress={() =>
                Alert.alert("确认合并", "两份原文与来源均保留。", [
                  { text: "取消", style: "cancel" },
                  {
                    text: "合并",
                    onPress: async () => {
                      try {
                        await api.post("/api/notes/merge", {
                          ...preview,
                          preview: false,
                        });
                        openNote(id);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    },
                  },
                ])
              }
            />
            <Button
              title="重新选择"
              secondary
              onPress={() => setPreview(null)}
            />
          </>
        )}
      </Body>
    </Status>
  );
}
