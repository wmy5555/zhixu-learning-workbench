import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useResource, useWorkbench } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Label,
  Row,
  Status,
  openNote,
  openSection,
} from "../components/workbench-ui";
export default function Today() {
  const r = useResource("/api/today"),
    { api, working, practiceId } = useWorkbench();
  const d = r.data;
  return (
    <Status resource={r}>
      <Body>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Label large>{practiceId ? "练习 · 今日" : "今日"}</Label>
          <Button
            title="设置"
            secondary
            onPress={() => openSection("settings")}
          />
        </View>
        <Card>
          <Label>{d?.date}</Label>
          <Label large>{d?.minutes || 0} 分钟</Label>
          <Label muted>今日预算 {d?.budget || 0} 分钟</Label>
          <Button
            title={working ? "正在处理" : "更新今日安排"}
            disabled={working}
            onPress={() => void api.post("/api/today/generate")}
          />
        </Card>
        {d?.items?.length ? (
          d.items.map((p: any) => (
            <Card key={p.id}>
              <Row
                title={p.title}
                detail={`${p.minutes} 分钟 · ${p.reason}`}
                onPress={() => openNote(p.noteId)}
              />
              {p.state === "pending" ? (
                <Button
                  title="开始学习"
                  disabled={working}
                  onPress={async () => {
                    try {
                      const s = await api.post("/api/study/start", {
                        noteId: p.noteId,
                        planId: p.id,
                        topicId: p.topicId,
                        mistakeId: p.mistakeId,
                      });
                      router.push({
                        pathname: "/session/[id]",
                        params: { id: s.id },
                      } as any);
                    } catch (e) {
                      alert((e as Error).message);
                    }
                  }}
                />
              ) : (
                <Label muted>
                  {(
                    {
                      done: "已完成",
                      skip: "今日跳过",
                      defer: "已延期",
                      pause: "已暂停",
                    } as any
                  )[p.state] || p.state}
                </Label>
              )}
              {p.state === "pending" ? (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {[
                    ["skip", "跳过"],
                    ["defer", "明天"],
                    ["pause", "暂停"],
                  ].map(([action, label]) => (
                    <Button
                      key={action}
                      title={label}
                      secondary
                      disabled={working}
                      onPress={() =>
                        void api
                          .post(
                            `/api/today/${encodeURIComponent(p.id)}/action`,
                            { action },
                          )
                          .catch((e) => alert(e.message))
                      }
                    />
                  ))}
                </View>
              ) : null}
            </Card>
          ))
        ) : (
          <Card>
            <Label>今天没有待学习内容。</Label>
            <Button
              title="去知识库选择"
              onPress={() => router.navigate("/(tabs)/library" as any)}
            />
          </Card>
        )}
        <Row
          title={`未安排知识 · ${d?.unavailable?.length || 0}`}
          onPress={() => openSection("unavailable")}
        />
        <Row title="专注计时" onPress={() => router.push("/focus" as any)} />
        <Row title="检索与发现" onPress={() => router.push("/search" as any)} />
        <Row title="新手引导" onPress={() => openSection("onboarding")} />
        <Row
          title="任务"
          detail={working ? "任务处理中" : undefined}
          onPress={() => openSection("jobs")}
        />
      </Body>
    </Status>
  );
}
