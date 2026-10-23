import React from "react";
import { Alert, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useResource, useWorkbench } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Label,
  Row,
  Status,
  useWorkbenchNavigation,
} from "../components/workbench-ui";
import { Markdown } from "../components/native-markdown";
import { shareAttachment } from "../services/files";
export default function Note() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <NoteContent id={id} />;
}
export function NoteContent({ id }: { id: string }) {
  const { router, openForm, openNote } = useWorkbenchNavigation();
  const r = useResource("/api/notes/" + encodeURIComponent(id)),
    { api, working } = useWorkbench(),
    n = r.data;
  const action = async (p: string, b: any = {}) => {
    try {
      return await api.post(p, b);
    } catch (e) {
      Alert.alert("操作未完成", (e as Error).message);
    }
  };
  return (
    <Status resource={r}>
      <Body>
        <Label large>{n?.title}</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Button title="编辑" onPress={() => openForm("edit", id)} />
          <Button
            title="版本"
            secondary
            onPress={() =>
              router.push({
                pathname: "/section/[name]",
                params: { name: "history", id },
              } as any)
            }
          />
          <Button
            title="依据"
            secondary
            onPress={() =>
              router.push({
                pathname: "/section/[name]",
                params: { name: "evidence", id },
              } as any)
            }
          />
        </View>
        <Markdown
          body={n?.body || ""}
          conversation={
            n?.meta?.platform === "ChatGPT" || !!n?.meta?.conversationId
          }
          citationSources={n?.meta?.sources}
        />
        {n?.meta?.personalUnderstanding ? (
          <Card>
            <Label>我的理解</Label>
            <Markdown body={n.meta.personalUnderstanding} />
          </Card>
        ) : null}
        {[n?.meta?.sourceFile, ...(n?.meta?.attachments || [])]
          .filter(Boolean)
          .map((a: any) => (
            <Button
              key={a.id}
              title={"打开 " + a.name}
              secondary
              onPress={async () => {
                try {
                  await shareAttachment(
                    await api.get(
                      `/api/notes/${id}/attachments?asset=${encodeURIComponent(a.id)}`,
                    ),
                  );
                } catch (e) {
                  Alert.alert("无法打开", (e as Error).message);
                }
              }}
            />
          ))}
        {n?.kind === "source" ? (
          <>
            <Button
              title="手动整理知识"
              onPress={() => openForm("extract", id)}
            />
            <Button
              title="AI 拆解"
              disabled={
                working ||
                (!!n?.meta?.sourceFile &&
                  n?.meta?.sourceFile?.format !== "docx")
              }
              onPress={() =>
                Alert.alert(
                  "AI 拆解",
                  "本次操作将按已有外发权限和预算调用模型。",
                  [
                    { text: "取消", style: "cancel" },
                    {
                      text: "继续",
                      onPress: () => void action(`/api/notes/${id}/process`),
                    },
                  ],
                )
              }
            />
            <Button
              title="联网检验并找反例"
              secondary
              disabled={working}
              onPress={() =>
                Alert.alert(
                  "联网检验",
                  "本次将使用模型、搜索和网页读取，可能产生费用。",
                  [
                    { text: "取消", style: "cancel" },
                    {
                      text: "继续",
                      onPress: () =>
                        void action(`/api/notes/${id}/process`, {
                          research: true,
                        }),
                    },
                  ],
                )
              }
            />
            {n.children?.map((child: any) => (
              <Row
                key={child.id}
                title={child.title}
                onPress={() => openNote(child.id)}
              />
            ))}
            <Button
              title="资料结构"
              secondary
              onPress={() =>
                router.push({ pathname: "/structure", params: { id } } as any)
              }
            />
            <Button
              title="分析资料结构"
              secondary
              disabled={working}
              onPress={() => void action(`/api/notes/${id}/structure`)}
            />
          </>
        ) : null}
        {n?.kind === "knowledge" ? (
          <>
            <Button
              title="学习目标与阶段"
              onPress={() => openForm("promote", id)}
            />
            <Button
              title="开始练习"
              disabled={working}
              onPress={async () => {
                const s = await action("/api/study/start", { noteId: id });
                if (s)
                  router.push({
                    pathname: "/session/[id]",
                    params: { id: s.id },
                  } as any);
              }}
            />
            <Button
              title="确认我的理解"
              secondary
              onPress={() => openForm("confirm", id)}
            />
            <Button
              title="合并其他知识"
              secondary
              onPress={() =>
                router.push({ pathname: "/merge", params: { id } } as any)
              }
            />
            <Button
              title="查找本地关联"
              secondary
              disabled={working}
              onPress={() =>
                void action(`/api/notes/${id}/relate`, { useAI: false })
              }
            />
          </>
        ) : null}
        <Button
          title="预览来源链接同步"
          secondary
          disabled={working}
          onPress={async () => {
            try {
              const p = await api.get(`/api/notes/${id}/links-preview`);
              Alert.alert(
                "链接同步预览",
                p.conflict
                  ? "发现冲突，请先检查原文。"
                  : p.changed
                    ? "将按已确认关系更新受管链接段。"
                    : "链接已经同步。",
                [
                  { text: "关闭", style: "cancel" },
                  ...(p.changed && !p.conflict
                    ? [
                        {
                          text: "同步",
                          onPress: () =>
                            void action(`/api/notes/${id}/links-sync`, {
                              expectedHash: p.expectedHash,
                            }),
                        },
                      ]
                    : []),
                ],
              );
            } catch (e) {
              Alert.alert("未完成", (e as Error).message);
            }
          }}
        />
        <Button
          title="移到回收站"
          secondary
          disabled={working}
          onPress={() =>
            Alert.alert("移到回收站", n?.title, [
              { text: "取消", style: "cancel" },
              {
                text: "移入",
                style: "destructive",
                onPress: async () => {
                  try {
                    await api.remove("/api/notes/" + id, {
                      expectedHash: n.hash,
                    });
                    router.back();
                  } catch (e) {
                    Alert.alert("操作未完成", (e as Error).message);
                  }
                },
              },
            ])
          }
        />
      </Body>
    </Status>
  );
}
