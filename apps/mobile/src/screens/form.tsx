import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useNavigation, usePreventRemove } from "expo-router/react-navigation";
import { useWorkbench, useDraftFlush } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Choices,
  Field,
  Label,
  Toggle,
} from "../components/workbench-ui";
import { Markdown } from "../components/native-markdown";
import { pickFile } from "../services/files";
import runtime from "../platform/runtime.native.js";
import { MarkdownEditor } from "../components/markdown-editor";
const depths: [string, string][] = [
  ["aware", "知道存在"],
  ["find", "知道去哪找"],
  ["explain", "能够解释"],
  ["apply", "迁移应用"],
];
export default function Form() {
  const { kind, id = "" } = useLocalSearchParams<{
      kind: string;
      id: string;
    }>(),
    { api, working } = useWorkbench(),
    navigation = useNavigation();
  const [form, setForm] = useState<any>({}),
    [base, setBase] = useState<any>({}),
    [choices, setChoices] = useState<any[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [dirty, setDirty] = useState(false),
    [leaving, setLeaving] = useState(false);
  const initialized = useRef(false);
  const [saving, setSaving] = useState(false);
  const change = (key: string, value: any) => {
    setForm((old: any) => ({ ...old, [key]: value }));
    setDirty(true);
  };
  usePreventRemove((dirty || saving) && !leaving, ({ data }: any) => {
    if (saving) {
      Alert.alert("正在保存", "请等待保存回执。");
      return;
    }
    Alert.alert("保留当前输入？", "当前更改尚未保存。", [
      { text: "继续编辑", style: "cancel" },
      {
        text: "放弃修改",
        style: "destructive",
        onPress: () => {
          setDirty(false);
          void api
            .remove("/api/draft-work", { id: "form-" + kind + "-" + id })
            .finally(() => navigation.dispatch(data.action));
        },
      },
    ]);
  });
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      try {
        let original: any = {},
          initial: any = {};
        if (["edit", "extract", "promote", "confirm"].includes(kind)) {
          original = await api.get("/api/notes/" + id);
          initial = {
            title: kind === "extract" ? "" : original.title,
            body: ["confirm", "extract"].includes(kind) ? "" : original.body,
            topic: original.meta?.topic || "",
            stage: original.meta?.stage || "learning",
            depth: original.meta?.depth || "explain",
            claimType: "fact",
            reason: "",
          };
        }
        if (kind === "study-confirm") initial = { body: "" };
        if (kind === "call-confirm") initial = { cost: "", reason: "" };
        if (kind === "settings") {
          original = await api.get("/api/settings");
          initial = {
            dailyMinutes: String(original.dailyMinutes),
            timezone: original.timezone,
            scheduleTime: original.scheduleTime,
            focusTopics: original.focusTopics.join("、"),
            discoveryDays: String(original.discoveryDays),
          };
        }
        if (kind === "provider") {
          original = await api.get("/api/settings");
          const group = id === "model" ? "ai" : id;
          initial = {
            ...original[group],
            apiKey: "",
            enabled: original[group]?.enabled || false,
          };
        }
        if (kind === "usage") {
          original = await api.get("/api/settings");
          initial = {
            dailyCallLimit: String(original.ai.dailyCallLimit),
            sourceCallLimit: String(original.ai.sourceCallLimit),
            monthlyBudget: String(original.ai.monthlyBudget),
            inputPrice: String(original.ai.inputPrice ?? ""),
            outputPrice: String(original.ai.outputPrice ?? ""),
            cachedInputPrice: String(original.ai.cachedInputPrice ?? ""),
          };
        }
        if (["topic", "topic-copy", "topic-split"].includes(kind)) {
          original = id ? await api.get("/api/notes/" + id) : {};
          initial = {
            title:
              kind === "topic-copy"
                ? original.title + "（副本）"
                : kind === "topic-split"
                  ? original.title + "（拆分）"
                  : original.title || "",
            body: original.body || "",
            noteIds: kind === "topic-split" ? [] : original.meta?.noteIds || [],
            prerequisites: original.meta?.prerequisites || [],
            minutes: String(original.meta?.minutes || 20),
          };
          const ns = await api.get("/api/notes?kind=knowledge");
          setChoices(ns.notes);
        }
        if (kind === "prompt") {
          const all = await api.get("/api/prompts");
          original = all.prompts.find((x: any) => x.key === id);
          initial = { body: original.template };
        }
        if (kind === "draft") {
          const all = await api.get("/api/drafts");
          original = all.drafts.find((x: any) => x.id === id);
          if (!original) throw Error("草稿不存在");
          initial = { body: original.body, usedIds: original.usedIds || [] };
          setChoices(original.citations || []);
        }
        if (kind === "restore-confirm") initial = { body: "" };
        if (kind !== "provider") {
          const saved = await api.get(
            "/api/draft-work?id=" +
              encodeURIComponent("form-" + kind + "-" + id),
          );
          if (saved.form) {
            initial = saved.form;
            if (
              saved.baseHash &&
              original.hash &&
              saved.baseHash !== original.hash
            ) {
              setError("已恢复草稿；原文版本已变化，请核对后合并。");
              original = { ...original, hash: saved.baseHash };
            }
            setDirty(true);
          }
        }
        setBase(original);
        setForm(initial);
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [api, kind, id]);
  useEffect(() => {
    if (!ready || !dirty || leaving || kind === "provider") return;
    const timer = setTimeout(() => {
      void api
        .put("/api/draft-work", {
          id: "form-" + kind + "-" + id,
          value: { form, baseHash: base.hash || "" },
        })
        .catch((e) => setError(e.message));
    }, 700);
    return () => clearTimeout(timer);
  }, [api, base.hash, form, ready, dirty, leaving, kind, id]);
  const flushDraft = useCallback(
    () =>
      ready && dirty && !leaving && kind !== "provider"
        ? api.put("/api/draft-work", {
            id: "form-" + kind + "-" + id,
            value: { form, baseHash: base.hash || "" },
          })
        : Promise.resolve(),
    [api, ready, dirty, leaving, kind, id, form, base.hash],
  );
  useDraftFlush(flushDraft);
  async function submit() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (kind === "call-confirm")
        await api.post("/api/call-recovery/" + id, {
          action: "confirm",
          cost: form.cost === "" ? null : Number(form.cost),
          reason: form.reason,
        });
      if (kind === "edit")
        await api.put("/api/notes/" + id, {
          title: form.title,
          body: form.body,
          expectedHash: base.hash,
          meta: { topic: form.topic },
          attachmentUploadIds: form.attachmentUploadIds || [],
        });
      if (kind === "extract") await api.post(`/api/notes/${id}/extract`, form);
      if (kind === "promote")
        await api.post(`/api/notes/${id}/promote`, {
          stage: form.stage,
          depth: form.depth,
          reason: form.reason,
        });
      if (kind === "confirm")
        await api.post(`/api/notes/${id}/confirm`, {
          body: form.body,
          expectedHash: base.hash,
        });
      if (kind === "study-confirm")
        await api.post(`/api/study/${id}/confirm`, { body: form.body });
      if (kind === "settings")
        await api.put("/api/settings", {
          dailyMinutes: Number(form.dailyMinutes),
          timezone: form.timezone,
          scheduleTime: form.scheduleTime,
          focusTopics: String(form.focusTopics)
            .split(/[、,，]/)
            .filter(Boolean),
          discoveryDays: Number(form.discoveryDays),
        });
      if (kind === "provider") {
        const config: any = { enabled: form.enabled };
        if (id !== "fetch") {
          config.baseUrl = form.baseUrl;
          if (id !== "search") config.model = form.model;
          if (form.apiKey) config.apiKey = form.apiKey;
        }
        if (!config.enabled)
          await api.put("/api/settings", {
            [id === "model" ? "ai" : id]: config,
          });
        else {
          const test = await api.post("/api/settings/test", {
            capability: id,
            config,
          });
          await api.post("/api/settings/save-tested", {
            capability: id,
            config,
            receipt: test.receipt,
          });
        }
      }
      if (kind === "usage")
        await api.put("/api/usage/settings", {
          ai: Object.fromEntries(
            Object.entries(form).map(([key, value]) => [
              key,
              value === "" ? null : Number(value),
            ]),
          ),
          pricingFor: Object.fromEntries(
            ["ai", "embedding", "search"].map((key) => [
              key,
              { baseUrl: base[key].baseUrl, model: base[key].model || "" },
            ]),
          ),
        });
      if (["topic", "topic-copy", "topic-split"].includes(kind)) {
        if (id && kind === "topic")
          await api.put("/api/topics/" + id, {
            title: form.title,
            body: form.body,
            expectedHash: base.hash,
            meta: {
              noteIds: form.noteIds,
              prerequisites: form.prerequisites,
              minutes: Number(form.minutes),
            },
          });
        else
          await api.post("/api/topics", {
            ...form,
            minutes: Number(form.minutes),
          });
      }
      if (kind === "prompt")
        await api.put("/api/prompts", { prompts: { [id]: form.body } });
      if (kind === "draft")
        await api.put("/api/drafts/" + id, {
          body: form.body,
          usedIds: form.usedIds,
        });
      if (kind !== "provider")
        await api.remove("/api/draft-work", { id: "form-" + kind + "-" + id });
      setDirty(false);
      setLeaving(true);
      setTimeout(() => router.back(), 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const field = (
    key: string,
    label: string,
    multiline = false,
    numeric = false,
  ) => (
    <Field
      key={key}
      label={label}
      value={String(form[key] ?? "")}
      onChange={(v) => change(key, v)}
      multiline={multiline}
      numeric={numeric}
    />
  );
  const toggleId = (key: string, value: string) =>
    change(
      key,
      (form[key] || []).includes(value)
        ? form[key].filter((v: string) => v !== value)
        : [...(form[key] || []), value],
    );
  const titles: any = {
    edit: "编辑原文",
    extract: "整理知识",
    confirm: "我的理解",
    "study-confirm": "我的理解",
    promote: "学习目标与阶段",
    settings: "学习节奏",
    provider: "服务配置",
    usage: "预算与价格",
    topic: "主题学习",
    prompt: base.title || "提示词",
    draft: "输出草稿",
  };
  return (
    <Body form>
      <Label large>{titles[kind] || "编辑"}</Label>
      {error ? (
        <Card>
          <Label>{error}</Label>
          {error.includes("变化") ? (
            <Label muted>
              当前输入已保留。请退出前复制草稿，重新读取后人工合并。
            </Label>
          ) : null}
        </Card>
      ) : null}
      {!ready ? (
        <Label>正在读取…</Label>
      ) : (
        <>
          {["edit", "extract", "topic", "topic-copy", "topic-split"].includes(
            kind,
          )
            ? field("title", "标题")
            : null}
          {[
            "edit",
            "extract",
            "confirm",
            "study-confirm",
            "topic",
            "topic-copy",
            "topic-split",
            "prompt",
            "draft",
          ].includes(kind) ? (
            <>
              <Choices
                value={preview ? "preview" : "source"}
                options={[
                  ["source", "Markdown"],
                  ["preview", "阅读预览"],
                ]}
                onChange={(v) => setPreview(v === "preview")}
              />
              {preview ? (
                <Markdown body={form.body || ""} />
              ) : (
                <MarkdownEditor
                  value={form.body || ""}
                  onChange={(v) => change("body", v)}
                />
              )}
            </>
          ) : null}
          {kind === "edit" && base.kind === "source" ? (
            <Button
              title="插入本地图片"
              secondary
              disabled={working}
              onPress={async () => {
                try {
                  const file = await pickFile();
                  if (!file) return;
                  if (!/\.(png|jpe?g|gif|webp)$/i.test(file.name))
                    throw Error("请选择 PNG、JPEG、GIF 或 WebP 图片");
                  const upload = await api.post(
                    "/api/uploads?name=" +
                      encodeURIComponent(file.name) +
                      "&uploadId=" +
                      runtime.uuid(),
                    { mime: file.mimeType, base64: await file.file.base64() },
                  );
                  setForm((f: any) => ({
                    ...f,
                    attachmentUploadIds: [
                      ...(f.attachmentUploadIds || []),
                      upload.id,
                    ],
                    body:
                      f.body +
                      "\n\n![插图](.zhixu-attachments/" +
                      upload.attachment.id +
                      ")\n",
                  }));
                  setDirty(true);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          ) : null}
          {["edit", "extract"].includes(kind) ? field("topic", "主题") : null}
          {kind === "extract" ? (
            <Choices
              label="内容性质"
              value={form.claimType}
              onChange={(v) => change("claimType", v)}
              options={[
                ["fact", "需核验事实"],
                ["opinion", "个人观点"],
              ]}
            />
          ) : null}
          {["extract", "promote"].includes(kind) ? (
            <>
              <Choices
                label="学习目标"
                value={form.depth}
                onChange={(v) => change("depth", v)}
                options={depths}
              />
              {field("reason", "选择理由", true)}
            </>
          ) : null}
          {kind === "promote" ? (
            <Choices
              label="阶段"
              value={form.stage}
              onChange={(v) => change("stage", v)}
              options={[
                ["reference", "查阅"],
                ["candidate", "待选学"],
                ["learning", "加入学习"],
                ["integrated", "个人知识"],
                ["core", "核心知识"],
                ["retired", "不再使用"],
              ]}
            />
          ) : null}
          {kind === "settings" ? (
            <>
              {field("dailyMinutes", "每日分钟", false, true)}
              {field("timezone", "时区")}
              {field("scheduleTime", "安排时间（HH:mm）")}
              {field("focusTopics", "优先主题（顿号分隔）")}
              {field("discoveryDays", "发现间隔天数", false, true)}
            </>
          ) : null}
          {kind === "provider" && ["model", "embedding"].includes(id) ? (
            <Button
              title="读取模型目录"
              secondary
              disabled={working}
              onPress={async () => {
                try {
                  const result = await api.post("/api/settings/models", {
                    capability: id,
                    config: {
                      baseUrl: form.baseUrl,
                      model: form.model,
                      enabled: true,
                      ...(form.apiKey ? { apiKey: form.apiKey } : {}),
                    },
                  });
                  setChoices(result.models || []);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          ) : null}
          {kind === "provider" && choices.length ? (
            <Choices
              value={form.model || ""}
              onChange={(v) => change("model", v)}
              options={choices.map((m: any) =>
                typeof m === "string" ? [m, m] : [m.id, m.id],
              )}
            />
          ) : null}
          {kind === "provider" ? (
            <>
              <Toggle
                label="启用"
                value={!!form.enabled}
                onChange={(v) => change("enabled", v)}
              />
              {id !== "fetch" ? (
                <>
                  {field("baseUrl", "HTTPS 服务地址")}
                  {id !== "search" ? field("model", "模型") : null}
                  <Field
                    label="API Key（留空保留）"
                    value={form.apiKey || ""}
                    onChange={(v) => change("apiKey", v)}
                    secure
                  />
                </>
              ) : null}
              <Label muted>启用时先测试连接，成功后保存；测试可能计费。</Label>
            </>
          ) : null}
          {kind === "call-confirm" ? (
            <>
              {field("cost", "已核对金额（未知留空）", false, true)}
              {field("reason", "核对依据", true)}
            </>
          ) : null}
          {kind === "usage"
            ? Object.entries({
                dailyCallLimit: "每日请求上限",
                sourceCallLimit: "每份资料请求上限",
                monthlyBudget: "月预算",
                inputPrice: "输入价格 / 百万 Token",
                outputPrice: "输出价格 / 百万 Token",
                cachedInputPrice: "缓存输入价格 / 百万 Token",
              }).map(([k, l]) => field(k, l, false, true))
            : null}
          {["topic", "topic-copy", "topic-split"].includes(kind) ? (
            <>
              {field("minutes", "学习包分钟", false, true)}
              <Label>成员顺序</Label>
              {(form.noteIds || []).map((noteId: string, index: number) => (
                <Card key={noteId}>
                  <Label>
                    {index + 1}.{" "}
                    {choices.find((n) => n.id === noteId)?.title || noteId}
                  </Label>
                  <Button
                    title="上移"
                    secondary
                    disabled={index === 0}
                    onPress={() => {
                      const ids = [...form.noteIds];
                      [ids[index - 1], ids[index]] = [
                        ids[index],
                        ids[index - 1],
                      ];
                      change("noteIds", ids);
                    }}
                  />
                </Card>
              ))}
              <Label>选择成员</Label>
              {choices.map((n) => (
                <Toggle
                  key={n.id}
                  label={n.title}
                  value={form.noteIds?.includes(n.id) || false}
                  onChange={() => toggleId("noteIds", n.id)}
                />
              ))}
              <Label>前置知识</Label>
              {choices.map((n) => (
                <Toggle
                  key={n.id}
                  label={n.title}
                  value={form.prerequisites?.includes(n.id) || false}
                  onChange={() => toggleId("prerequisites", n.id)}
                />
              ))}
            </>
          ) : null}
          {kind === "draft" ? (
            <>
              <Label>实际采用的引用</Label>
              {choices.map((n) => (
                <Toggle
                  key={n.id}
                  label={n.title}
                  value={form.usedIds?.includes(n.id) || false}
                  onChange={() => toggleId("usedIds", n.id)}
                />
              ))}
            </>
          ) : null}
          {kind === "prompt" ? (
            <Button
              title="恢复默认文本"
              secondary
              onPress={() => change("body", base.defaultTemplate)}
            />
          ) : null}
          <Button
            title={kind === "provider" && form.enabled ? "测试并保存" : "保存"}
            disabled={working || saving}
            onPress={() => void submit()}
          />
        </>
      )}
    </Body>
  );
}
