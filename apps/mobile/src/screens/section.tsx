import React, { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Alert, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useResource, useWorkbench } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Choices,
  Field,
  Label,
  Row,
  Status,
  openForm,
  openNote,
  openSection,
} from "../components/workbench-ui";
import { Markdown } from "../components/native-markdown";
import { pickFile, shareJSON, shareText } from "../services/files";
import {
  getCurriculum,
  readingExample,
} from "../reference/onboarding-curriculum.mjs";
import { nativeInstruction } from "../services/onboarding-native.mjs";
import {
  materials,
  materialSample,
  getMaterial,
} from "../reference/onboarding-materials.mjs";
const titles: any = {
  settings: "设置",
  providers: "外部服务",
  jobs: "任务",
  topics: "主题学习",
  mistakes: "错题修正",
  recommendations: "知识使用建议",
  relations: "关联审阅",
  drafts: "输出草稿",
  prompts: "提示词",
  usage: "用量与费用",
  backup: "备份与恢复",
  recycle: "回收站",
  history: "历史版本",
  evidence: "来源与依据",
  onboarding: "新手引导",
  unavailable: "未安排知识",
  desktop: "电脑协作",
  diagnostics: "诊断",
  proposals: "修改提案",
  calls: "调用恢复",
  appearance: "外观",
};
export default function Section() {
  const { name, id = "" } = useLocalSearchParams<{
      name: string;
      id: string;
    }>(),
    { api, working, practiceId, setPracticeId } = useWorkbench();
  const [error, setError] = useState(""),
    [limit, setLimit] = useState(30),
    [filter, setFilter] = useState(""),
    [restoring, setRestoring] = useState<any>(null),
    [stepIndex, setStepIndex] = useState(-1),
    [custom, setCustom] = useState(false),
    [customTitle, setCustomTitle] = useState(""),
    [customBody, setCustomBody] = useState("");
  const paths: any = {
    settings: "/api/settings",
    providers: "/api/settings",
    jobs: "/api/jobs",
    topics: "/api/topics",
    mistakes: "/api/mistakes",
    recommendations: "/api/recommendations",
    relations: "/api/relations",
    drafts: "/api/drafts",
    prompts: "/api/prompts",
    usage: "/api/usage",
    recycle: "/api/recycle-bin",
    history: "/api/history/" + id,
    evidence: `/api/notes/${id}/evidence`,
    onboarding: "/api/onboarding/state",
    unavailable: "/api/today",
    diagnostics: "/api/diagnostics",
    proposals: "/api/proposals",
    calls: "/api/call-recovery",
  };
  const r = useResource(paths[name] || "/api/settings"),
    d = r.data;
  const act = async (path: string, body: any = {}) => {
    setError("");
    try {
      return await api.post(path, body);
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };
  const yes = (title: string, message: string, fn: () => void) =>
    Alert.alert(title, message, [
      { text: "取消", style: "cancel" },
      { text: "继续", onPress: fn },
    ]);
  const row = (title: string, fn: () => void, detail?: string) => (
    <Row key={title} title={title} detail={detail} onPress={fn} />
  );
  const collection = (items: any[], render: (item: any) => React.ReactNode) => (
    <>
      {items.slice(0, limit).map(render)}
      {items.length > limit ? (
        <Button
          title="显示更多"
          secondary
          onPress={() => setLimit((n) => n + 30)}
        />
      ) : null}
      {!items.length ? <Label muted>这里还没有内容。</Label> : null}
    </>
  );
  function navigateStep(step: any) {
    const entity = d?.roles?.[step.noteRole];
    if (entity && ["library", "capture"].includes(step.view)) {
      openNote(entity);
      return;
    }
    if (step.tab) {
      const section: any = {
        data: "backup",
        appearance: "appearance",
        conflicts: "diagnostics",
      };
      openSection(section[step.tab] || step.tab);
      return;
    }
    const routes: any = {
      discover: "/search",
      topics: "/section/topics",
      today: "/(tabs)",
      capture: "/(tabs)/capture",
      library: "/(tabs)/library",
      study: "/(tabs)/study",
      output: "/(tabs)/output",
      system: "/section/settings",
    };
    router.push(routes[step.view] || ("/(tabs)" as any));
  }
  const curriculum =
    name === "onboarding" ? getCurriculum(d?.materialId) : null;
  const steps =
    filter === "extension"
      ? curriculum?.flatSteps.filter((s: any) => s.priority !== "core")
      : curriculum?.coreSteps;
  const currentIndex =
    stepIndex < 0
      ? Math.max(
          0,
          steps?.findIndex((s: any) => s.id === d?.currentStepId) ?? 0,
        )
      : Math.min(stepIndex, (steps?.length || 1) - 1);
  const step = steps?.[currentIndex];
  return (
    <Status resource={r}>
      <Body>
        <Label large>{titles[name] || name}</Label>
        {error ? (
          <Card>
            <Label>{error}</Label>
          </Card>
        ) : null}
        {name === "settings" ? (
          <>
            {row("学习节奏", () => openForm("settings"))}
            {row("外观", () => router.push("/appearance" as any))}
            {row("外部服务", () => openSection("providers"))}
            {row("用量与费用", () => openSection("usage"))}
            {row("提示词", () => openSection("prompts"))}
            {row("任务", () => openSection("jobs"))}
            {row("备份与恢复", () => openSection("backup"))}
            {row("回收站", () => openSection("recycle"))}
            {row("修改提案", () => openSection("proposals"))}
            {row("电脑协作", () => openSection("desktop"))}
            {row("新手引导", () => openSection("onboarding"))}
            {row("诊断", () => openSection("diagnostics"))}
            {d?.pausedIds?.length ? (
              <Card>
                <Label>暂停的知识</Label>
                {d.pausedIds.map((n: string) =>
                  row(n, () =>
                    yes(
                      "恢复学习",
                      "让此知识重新参与安排。",
                      () =>
                        void api
                          .put("/api/settings", {
                            pausedIds: d.pausedIds.filter(
                              (x: string) => x !== n,
                            ),
                          })
                          .catch((e) => setError(e.message)),
                    ),
                  ),
                )}
              </Card>
            ) : null}
          </>
        ) : null}
        {name === "providers" ? (
          <>
            {[
              ["model", "模型"],
              ["embedding", "语义向量"],
              ["search", "搜索"],
              ["fetch", "网页读取"],
            ].map(([k, label]) =>
              row(
                label,
                () => openForm("provider", k),
                d?.[k === "model" ? "ai" : k]?.enabled ? "已启用" : "未启用",
              ),
            )}
            <Label muted>
              外发按每次操作授权和预算检查。更换服务后重新测试。
            </Label>
          </>
        ) : null}
        {name === "jobs" ? (
          <>
            <Choices
              value={filter}
              onChange={setFilter}
              options={[
                ["", "全部"],
                ["waiting", "待处理"],
                ["failed", "失败"],
                ["done", "完成"],
              ]}
            />
            {collection(
              (d?.jobs || []).filter((j: any) => !filter || j.state === filter),
              (j: any) => (
                <Card key={j.id}>
                  <Label>
                    {(
                      {
                        process: "资料拆解",
                        grade: "教学反馈",
                        title: "生成标题",
                        structure: "资料结构",
                        index: "检索索引",
                        relate: "知识关联",
                        discover: "发现",
                        topics: "学习包",
                      } as any
                    )[j.type] || j.type}
                  </Label>
                  <Label muted>
                    {(
                      {
                        queued: "排队中",
                        running: "处理中",
                        waiting: "等待继续",
                        failed: "失败",
                        done: "完成",
                        cancelled: "已取消",
                      } as any
                    )[j.state] || j.state}{" "}
                    · {j.progress || 0}%
                  </Label>
                  {j.error ? <Label>{j.error}</Label> : null}
                  {j.payload?.noteId
                    ? row("打开资料", () => openNote(j.payload.noteId))
                    : null}
                  <View style={{ gap: 8 }}>
                    {!["running", "done"].includes(j.state) ? (
                      <Button
                        title="重试"
                        disabled={working}
                        onPress={() =>
                          yes(
                            "重试任务",
                            "检查调用恢复记录；此操作可能继续外部调用。",
                            () =>
                              void act(`/api/jobs/${j.id}/action`, {
                                action: "retry",
                              }),
                          )
                        }
                      />
                    ) : null}
                    {["queued", "running", "waiting"].includes(j.state) ? (
                      <Button
                        title="取消"
                        secondary
                        onPress={() =>
                          void act(`/api/jobs/${j.id}/action`, {
                            action: "cancel",
                          })
                        }
                      />
                    ) : null}
                  </View>
                </Card>
              ),
            )}
          </>
        ) : null}
        {name === "topics" ? (
          <>
            <Button title="新建主题" onPress={() => openForm("topic")} />
            <Button
              title="AI 建议主题"
              disabled={working}
              secondary
              onPress={() =>
                yes(
                  "生成主题建议",
                  "将按已有权限使用模型。",
                  () => void act("/api/topics/suggest"),
                )
              }
            />
            {collection(d?.topics || [], (t: any) => (
              <Card key={t.id}>
                {row(
                  t.title,
                  () => openNote(t.id),
                  `${t.progress?.completedCount || 0} / ${t.progress?.total || 0}`,
                )}
                <Button
                  title="复制为新主题"
                  secondary
                  onPress={() => openForm("topic-copy", t.id)}
                />
                <Button
                  title="拆分所选成员"
                  secondary
                  onPress={() => openForm("topic-split", t.id)}
                />
                <Button
                  title="编辑成员与顺序"
                  secondary
                  onPress={() => openForm("topic", t.id)}
                />
                {t.progress?.nextNoteId ? (
                  <Button
                    title="学习下一项"
                    disabled={working}
                    onPress={async () => {
                      const s = await act("/api/study/start", {
                        noteId: t.progress.nextNoteId,
                        topicId: t.id,
                      });
                      if (s)
                        router.push({
                          pathname: "/session/[id]",
                          params: { id: s.id },
                        } as any);
                    }}
                  />
                ) : null}
                <Button
                  title={t.paused ? "恢复主题" : "暂停主题"}
                  secondary
                  disabled={working}
                  onPress={() =>
                    void act(`/api/topics/${t.id}/action`, {
                      action: t.paused ? "resume" : "pause",
                    })
                  }
                />
              </Card>
            ))}
          </>
        ) : null}
        {name === "mistakes"
          ? collection(d?.mistakes || [], (m: any) => (
              <Card key={m.id}>
                {row(m.title, () => openNote(m.id))}
                <Markdown body={m.body} />
                <Button
                  title="针对练习"
                  disabled={working || m.meta?.correctionState !== "open"}
                  onPress={async () => {
                    const s = await act("/api/study/start", {
                      mistakeId: m.id,
                    });
                    if (s)
                      router.push({
                        pathname: "/session/[id]",
                        params: { id: s.id },
                      } as any);
                  }}
                />
                {[
                  ["dispute", "质疑"],
                  ["resolve", "已解决"],
                  ["reopen", "重新处理"],
                  ["revoke", "撤销"],
                ].map(([action, label]) => (
                  <Button
                    key={action}
                    title={label}
                    secondary
                    disabled={working}
                    onPress={() =>
                      yes(
                        label,
                        "保留原始回答与 AI 反馈，并记录你的决定。",
                        () =>
                          void act(`/api/mistakes/${m.id}/action`, {
                            action,
                            reason: "用户在手机端明确确认",
                          }),
                      )
                    }
                  />
                ))}
              </Card>
            ))
          : null}
        {name === "recommendations"
          ? collection(d?.suggestions || [], (s: any) => (
              <Card key={s.id}>
                {row(s.title, () => openNote(s.noteId))}
                <Label>{s.reason}</Label>
                {s.signals?.map((v: string, i: number) => (
                  <Label key={i} muted>
                    {v}
                  </Label>
                ))}
                <Button
                  title="查看并采用"
                  disabled={working}
                  onPress={async () => {
                    if (s.type === "research") {
                      openNote(s.sourceId);
                      return;
                    }
                    if (s.type === "merge") {
                      router.push({
                        pathname: "/merge",
                        params: { id: s.relatedId },
                      } as any);
                      return;
                    }
                    await act(`/api/recommendations/${s.id}/action`, {
                      action: "accept",
                    });
                  }}
                />
                <Button
                  title="暂不采用"
                  secondary
                  disabled={working}
                  onPress={() =>
                    void act(`/api/recommendations/${s.id}/action`, {
                      action: "dismiss",
                    })
                  }
                />
              </Card>
            ))
          : null}
        {name === "relations" ? (
          <>
            <Button
              title="AI 辅助发现"
              secondary
              disabled={working}
              onPress={() =>
                yes(
                  "AI 辅助发现",
                  "将按已有权限调用模型，可能计费。",
                  () => void act("/api/discover", { useAI: true }),
                )
              }
            />
            <Button
              title="本地发现"
              disabled={working}
              onPress={() => void act("/api/discover", { useAI: false })}
            />
            {collection(d?.relations || [], (v: any) => (
              <Card key={v.id}>
                {row(v.title || v.reason || "知识关联", () =>
                  openNote(v.fromId),
                )}
                <Label>
                  {v.type} · {v.reason}
                </Label>
                {[
                  ["accept", "接受"],
                  ["reject", "拒绝"],
                  ["remove", "移除关系"],
                ].map(([action, label]) => (
                  <Button
                    key={action}
                    title={label}
                    disabled={working}
                    onPress={() =>
                      void act(`/api/relations/${v.id}/action`, { action })
                    }
                  />
                ))}
              </Card>
            ))}
          </>
        ) : null}
        {name === "drafts"
          ? collection(d?.drafts || [], (v: any) => (
              <Card key={v.id}>
                {row(v.question || v.mode || "输出草稿", () =>
                  openForm("draft", v.id),
                )}
                <Markdown body={String(v.body).slice(0, 500)} />
                <Button
                  title="选入原始资料"
                  secondary
                  disabled={working}
                  onPress={() =>
                    yes(
                      "选入原始资料",
                      "仅保存你选定的草稿，不代表个人理解或知识晋级。",
                      () =>
                        void act(`/api/drafts/${v.id}/capture`, {
                          title: v.question,
                          body: v.body,
                        }),
                    )
                  }
                />
              </Card>
            ))
          : null}
        {name === "prompts"
          ? collection(d?.prompts || [], (p: any) =>
              row(p.title, () => openForm("prompt", p.key), p.description),
            )
          : null}
        {name === "usage" ? (
          <>
            <Card>
              <Label>
                {d?.from} — {d?.to}
              </Label>
              <Label large>{d?.totals?.totalTokens ?? "未知"} Token</Label>
              <Label>请求 {d?.totals?.calls || 0} 次</Label>
              <Label>已知费用 {d?.totals?.knownCost ?? "未知"}</Label>
              <Label muted>
                费用未知请求 {d?.totals?.unknownCostCalls || 0} 次
              </Label>
            </Card>
            <Button title="预算与价格" onPress={() => openForm("usage")} />
            {row("未决调用恢复", () => openSection("calls"))}
            {collection(d?.daily || [], (v: any) => (
              <Card key={v.date}>
                <Label>{v.date}</Label>
                <Label muted>
                  {v.calls} 次 · {v.totalTokens} Token
                </Label>
              </Card>
            ))}
          </>
        ) : null}
        {name === "calls"
          ? collection(d?.pending || [], (v: any) => (
              <Card key={v.id}>
                <Label>{v.purpose || v.capability}</Label>
                <Label>{v.phase || v.state}</Label>
                <Label muted>
                  先核对服务商记录，不自动重发可能已计费的请求。
                </Label>
                <Button
                  title="核对未知费用"
                  secondary
                  disabled={working}
                  onPress={() => openForm("call-confirm", v.id)}
                />
                <Button
                  title="补记本地结果"
                  disabled={working}
                  onPress={() =>
                    void act("/api/call-recovery/" + v.id, {
                      action: "recover",
                    })
                  }
                />
              </Card>
            ))
          : null}
        {name === "backup" ? (
          <>
            <Button
              title="导出完整备份"
              disabled={working}
              onPress={async () => {
                try {
                  await shareJSON(await api.get("/api/backup"));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
            <Button
              title="选择备份并预览"
              secondary
              disabled={working}
              onPress={async () => {
                try {
                  const f = await pickFile({ maxBytes: 100_000_000 });
                  if (!f) return;
                  const backup = JSON.parse(await f.file.text());
                  const preview = await api.post("/api/restore", {
                    backup,
                    preview: true,
                  });
                  setRestoring({ backup, preview });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
            {restoring ? (
              <Card>
                <Label>恢复预览已通过</Label>
                <Label>{restoring.preview.taskNotice}</Label>
                <Label muted>
                  确认后替换当前知识库内容。现有库会按恢复规则保留回退材料；排队任务等待人工确认。
                </Label>
                <Button
                  title="确认恢复"
                  disabled={working}
                  onPress={() =>
                    yes(
                      "恢复当前知识库",
                      "请先导出当前备份。操作后重新核对资料与任务。",
                      async () => {
                        const v = await act("/api/restore", {
                          backup: restoring.backup,
                          preview: false,
                          token: restoring.preview.token,
                        });
                        if (v) setRestoring(null);
                      },
                    )
                  }
                />
              </Card>
            ) : null}
          </>
        ) : null}
        {name === "recycle"
          ? collection(d?.items || [], (v: any) => (
              <Card key={v.id}>
                <Label>{v.title}</Label>
                <Label muted>{v.deletedAt}</Label>
                <Button
                  title="恢复"
                  disabled={working}
                  onPress={() =>
                    void act(`/api/recycle-bin/${v.id}/restore`, {
                      versionId: v.versionId,
                    })
                  }
                />
              </Card>
            ))
          : null}
        {name === "history"
          ? collection(d?.versions || [], (v: any) => (
              <Card key={v.versionId}>
                <Label>{v.createdAt}</Label>
                <Label muted>{v.reason}</Label>
                <Markdown body={v.raw} />
                <Button
                  title="恢复此版本"
                  disabled={working}
                  onPress={async () => {
                    try {
                      const current = await api.get("/api/notes/" + id);
                      yes(
                        "恢复历史版本",
                        "当前版本保留在历史中。",
                        () =>
                          void act(`/api/history/${id}/restore`, {
                            versionId: v.versionId,
                            expectedHash: current.hash,
                          }),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              </Card>
            ))
          : null}
        {name === "evidence" ? (
          <>
            {d?.limitations?.map((v: string, i: number) => (
              <Label key={i}>{v}</Label>
            ))}
            {collection(d?.evidence || [], (v: any) => (
              <Card key={v.sourceId || v.url}>
                <Label>{v.title}</Label>
                <Markdown body={v.excerpt || ""} />
                <Label muted>{v.rationale || v.locator}</Label>
                {v.sourceId ? (
                  <Button
                    title="打开原始资料"
                    secondary
                    onPress={() => openNote(v.sourceId)}
                  />
                ) : null}
              </Card>
            ))}
          </>
        ) : null}
        {name === "unavailable"
          ? collection(d?.unavailable || [], (v: any) =>
              row(v.title, () => openNote(v.noteId), v.reason),
            )
          : null}
        {name === "proposals"
          ? collection(d?.proposals || [], (v: any) => (
              <Card key={v.id}>
                <Label>{v.reason}</Label>
                <Markdown body={v.body} />
                {[
                  ["accept", "接受修改"],
                  ["reject", "拒绝"],
                ].map(([action, label]) => (
                  <Button
                    key={action}
                    title={label}
                    disabled={working || v.state !== "pending"}
                    onPress={() =>
                      void act(`/api/proposals/${v.id}/action`, { action })
                    }
                  />
                ))}
              </Card>
            ))
          : null}
        {name === "desktop" ? (
          <>
            <Label>
              电脑的 MCP、ChatGPT 管道与 Obsidian
              目录由桌面知序提供。手机保留独立本地资料库。
            </Label>
            <Label>
              通过完整备份文件传递资料；先预览再恢复。凭据不随备份传递，任务不会因恢复自动重发。
            </Label>
            <Button title="备份与恢复" onPress={() => openSection("backup")} />
          </>
        ) : null}
        {name === "diagnostics" ? (
          <>
            <Label>资料库保存在本 App 的私有目录。</Label>
            <Button
              title="重建本地检索"
              disabled={working}
              onPress={() => void act("/api/index/local")}
            />
            <Button
              title="补建向量索引"
              disabled={working}
              secondary
              onPress={() =>
                yes(
                  "补建向量",
                  "将按权限和预算调用向量服务。",
                  () => void act("/api/index/update"),
                )
              }
            />
            <Button
              title="重建全部向量"
              disabled={working}
              secondary
              onPress={() =>
                yes(
                  "重建向量",
                  "可能重复产生向量调用费用。",
                  () => void act("/api/index/rebuild"),
                )
              }
            />
            {row("查看任务", () => openSection("jobs"))}
          </>
        ) : null}
        {name === "onboarding" ? (
          <>
            {!d?.practiceId ? (
              <>
                <Label>选择独立练习材料</Label>
                <Button
                  title="使用自己的材料"
                  secondary
                  onPress={() => setCustom((v) => !v)}
                />
                {custom ? (
                  <Card>
                    <Field
                      label="材料标题"
                      value={customTitle}
                      onChange={setCustomTitle}
                    />
                    <Field
                      label="原文与出处"
                      value={customBody}
                      onChange={setCustomBody}
                      multiline
                    />
                    <Button
                      title="创建独立练习"
                      disabled={
                        working || !customTitle.trim() || !customBody.trim()
                      }
                      onPress={async () => {
                        const v = await act("/api/onboarding/start", {
                          materialId: "custom",
                          customMaterial: {
                            title: customTitle,
                            body: customBody,
                          },
                        });
                        if (v) await setPracticeId(v.practiceId);
                      }}
                    />
                  </Card>
                ) : null}
                {materials.map((m: any) =>
                  row(m.label, async () => {
                    const v = await act("/api/onboarding/start", {
                      materialId: m.id,
                    });
                    if (v) {
                      try {
                        await setPracticeId(v.practiceId);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }
                  }),
                )}
              </>
            ) : (
              <>
                <Button
                  title={practiceId ? "回正式库" : "进入练习库"}
                  disabled={working}
                  onPress={async () => {
                    try {
                      if (practiceId) {
                        await api.post("/api/onboarding/pause", {
                          practiceId: d.practiceId,
                        });
                        await setPracticeId("");
                      } else {
                        await api.post("/api/onboarding/resume", {
                          practiceId: d.practiceId,
                        });
                        await setPracticeId(d.practiceId);
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
                <Choices
                  value={filter}
                  onChange={(v) => {
                    setFilter(v);
                    setStepIndex(0);
                  }}
                  options={[
                    ["", "核心体验"],
                    ["extension", "扩展阅读"],
                  ]}
                />
                {step ? (
                  <Card>
                    <Label>
                      {currentIndex + 1} / {steps.length}
                    </Label>
                    <Label large>{step.title}</Label>
                    <Label>{nativeInstruction(step)}</Label>
                    <Label muted>{step.expected}</Label>
                    <Label>
                      {(
                        {
                          done: "已实操",
                          read: "已阅读",
                          pending: "未完成",
                          needs_setup: "待配置",
                        } as any
                      )[d.progress?.[step.id]?.status] ||
                        d.progress?.[step.id]?.status}
                    </Label>
                    <Label muted>
                      {step.view === "system"
                        ? "手机使用设置页；电脑协作能力在电脑完成。"
                        : "手机通过底部导航和页面按钮操作，练习证据由实际操作记录。"}
                    </Label>
                    {step.sample ||
                    (step.id === "capture-save" && d.customSample) ? (
                      <Button
                        title="复制本步材料"
                        secondary
                        onPress={async () => {
                          const sample = step.sample || d.customSample;
                          await Clipboard.setStringAsync(
                            sample.body ||
                              sample.question ||
                              sample.query ||
                              JSON.stringify(sample),
                          );
                        }}
                      />
                    ) : null}
                    <Button
                      title="前往操作"
                      onPress={() => navigateStep(step)}
                    />
                    {step.downloads?.map((download: any) => (
                      <Button
                        key={download.title}
                        title={"保存 " + download.title}
                        secondary
                        onPress={async () => {
                          try {
                            const material = getMaterial(download.material);
                            const text = download.exercise
                              ? material?.transfer ||
                                "写下你希望应用原文回答的问题。"
                              : materialSample(download.material, true)?.body ||
                                readingExample.body;
                            await shareText(text, download.title);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      />
                    ))}
                    {step.kind === "case" ? (
                      <Button
                        title="加载此示例"
                        disabled={working}
                        onPress={() =>
                          void act("/api/onboarding/case", {
                            practiceId: d.practiceId,
                            caseId: step.caseId,
                          })
                        }
                      />
                    ) : null}
                    <Button
                      title={
                        step.kind === "read"
                          ? "已阅读，下一步"
                          : "检查进度，下一步"
                      }
                      disabled={working}
                      onPress={async () => {
                        const v = await act("/api/onboarding/checkpoint", {
                          practiceId: d.practiceId,
                          stepId: step.id,
                          mode: step.kind === "read" ? "read" : "check",
                        });
                        if (v) {
                          const next = Math.min(
                            currentIndex + 1,
                            steps.length - 1,
                          );
                          await act("/api/onboarding/checkpoint", {
                            practiceId: d.practiceId,
                            stepId: steps[next].id,
                          });
                          setStepIndex(next);
                        }
                      }}
                    />
                    <Button
                      title="上一步"
                      secondary
                      disabled={currentIndex === 0}
                      onPress={() => setStepIndex(currentIndex - 1)}
                    />
                  </Card>
                ) : null}
                {d.learningCandidates?.map((n: any) =>
                  row(
                    n.title,
                    () =>
                      void act("/api/onboarding/select-knowledge", {
                        practiceId: d.practiceId,
                        noteId: n.id,
                      }),
                    n.limitations?.join("；"),
                  ),
                )}
                <Button
                  title="练习日期前进一天"
                  secondary
                  disabled={working}
                  onPress={() =>
                    void act("/api/onboarding/advance", {
                      practiceId: d.practiceId,
                      action: "day",
                    })
                  }
                />
                <Button
                  title="跳到下次复习"
                  secondary
                  disabled={working}
                  onPress={() =>
                    void act("/api/onboarding/advance", {
                      practiceId: d.practiceId,
                      action: "next",
                    })
                  }
                />
                <Button
                  title="重置独立练习"
                  secondary
                  disabled={working}
                  onPress={() =>
                    yes(
                      "重置独立练习",
                      "这会清理练习库及进度，正式知识库保留。",
                      async () => {
                        const v = await act("/api/onboarding/reset", {
                          practiceId: d.practiceId,
                        });
                        if (v) {
                          await setPracticeId(v.practiceId);
                          setStepIndex(0);
                        }
                      },
                    )
                  }
                />
              </>
            )}
          </>
        ) : null}
      </Body>
    </Status>
  );
}
