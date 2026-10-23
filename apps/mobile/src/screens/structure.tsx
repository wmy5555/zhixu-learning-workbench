import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useNavigation, usePreventRemove } from "expo-router/react-navigation";
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
  Toggle,
  useWorkbenchNavigation,
} from "../components/workbench-ui";
import { relationTypes } from "../core/knowledge-structure.mjs";
import runtime from "../platform/runtime.native.js";
const dimensionNames: any = {
  factual: "事实",
  conceptual: "概念",
  procedural: "程序",
  metacognitive: "元认知",
  unknown: "待定",
};
const roleNames: any = {
  definition: "定义",
  claim: "主张",
  evidence: "证据",
  reason: "理由",
  step: "步骤",
  event: "事件",
  example: "例子",
  personal: "个人理解",
  unknown: "待定",
};
const relationNames: any = {
  support: "支持",
  oppose: "反对",
  explain: "解释",
  prerequisite: "前置",
  example: "举例",
  counterexample: "反例",
  limit: "限制",
  application: "应用",
  sequence: "先后",
  "is-a": "属于",
  cause: "导致",
  condition: "条件",
};
function StructureEditor({ resource }: { resource: any }) {
  const { openNote } = useWorkbenchNavigation();
  const { id } = useLocalSearchParams<{ id: string }>(),
    r = resource,
    { api, working } = useWorkbench(),
    navigation = useNavigation();
  const [draft, setDraft] = useState<any>(() =>
      r.data?.structure?.version === 2
        ? structuredClone(r.data.structure)
        : null,
    ),
    [revision, setRevision] = useState(() => r.data?.structure?.revision || ""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [panel, setPanel] = useState("units");

  usePreventRemove(dirty, ({ data }: any) =>
    Alert.alert("结构修改尚未保存", "保留当前编辑，或放弃后离开。", [
      { text: "继续编辑", style: "cancel" },
      {
        text: "放弃",
        style: "destructive",
        onPress: () => {
          setDirty(false);
          navigation.dispatch(data.action);
        },
      },
    ]),
  );
  const change = (group: string, index: number, key: string, value: any) => {
    setDraft((d: any) => ({
      ...d,
      [group]: d[group].map((v: any, i: number) =>
        i === index ? { ...v, [key]: value } : v,
      ),
    }));
    setDirty(true);
  };
  const remove = (group: string, index: number) => {
    setDraft((d: any) => ({
      ...d,
      [group]: d[group].filter((_: any, i: number) => i !== index),
    }));
    setDirty(true);
  };
  const add = (group: string, value: any) => {
    setDraft((d: any) => ({ ...d, [group]: [...d[group], value] }));
    setDirty(true);
  };
  const nodes: [string, string][] = (r.data?.children || []).map((n: any) => [
    n.id,
    n.title,
  ]);
  async function save(candidate?: any) {
    try {
      const saved = await api.put(`/api/notes/${id}/structure`, {
        structure: candidate || draft,
        revision,
      });
      setDirty(false);
      setDraft(structuredClone(saved.structure));
      setRevision(saved.structure.revision);
      await r.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const refs = (group: string, index: number, value: any) => (
    <Field
      label="原文依据（原样摘录）"
      value={value.sourceRefs?.[0]?.quote || ""}
      onChange={(quote) =>
        change(
          group,
          index,
          "sourceRefs",
          quote ? [{ sourceId: id, quote }] : [],
        )
      }
      multiline
    />
  );
  return (
    <Status resource={r}>
      <Body form>
        <Label large>资料结构</Label>
        {error ? <Label>{error}</Label> : null}
        <Label muted>{r.data?.structure?.message}</Label>
        {r.data?.structure?.gaps?.map((g: string, i: number) => (
          <Label key={i}>{g}</Label>
        ))}
        {!draft ? (
          <>
            <Button
              title={r.data?.structure?.version === 2 ? "查看结构" : "分析结构"}
              disabled={working}
              onPress={() => {
                if (r.data?.structure?.version === 2) {
                  setDraft(structuredClone(r.data.structure));
                  setRevision(r.data.structure.revision);
                } else
                  void api
                    .post(`/api/notes/${id}/structure`)
                    .catch((e: Error) => setError(e.message));
              }}
            />
            {nodes.map(([n, title]) => (
              <Row key={n} title={title} onPress={() => openNote(n)} />
            ))}
          </>
        ) : (
          <>
            <Choices
              value={panel}
              onChange={setPanel}
              options={[
                ["units", "内容单元"],
                ["topics", "主题目录"],
                ["edges", "逻辑关系"],
              ]}
            />
            {panel === "units"
              ? draft.units.map((u: any, i: number) => (
                  <Card key={u.id}>
                    <Row
                      title={
                        nodes.find((n) => n[0] === u.id)?.[1] || u.shortTitle
                      }
                      onPress={() => openNote(u.id)}
                    />
                    <Field
                      label="结构中的短标题"
                      value={u.shortTitle}
                      onChange={(v) => change("units", i, "shortTitle", v)}
                    />
                    {[
                      ["dimensions", dimensionNames],
                      ["roles", roleNames],
                    ].map(([key, names]: any) => (
                      <View key={key} style={{ gap: 8 }}>
                        {Object.entries(names).map(([value, title]) => (
                          <Toggle
                            key={value}
                            label={String(title)}
                            value={u[key]?.includes(value) || false}
                            onChange={(on) =>
                              change(
                                "units",
                                i,
                                key,
                                on
                                  ? [...u[key], value]
                                  : u[key].filter((v: string) => v !== value),
                              )
                            }
                          />
                        ))}
                      </View>
                    ))}
                    <Field
                      label="事件时间"
                      value={u.eventTime || ""}
                      onChange={(v) => change("units", i, "eventTime", v)}
                    />
                    {refs("units", i, u)}
                  </Card>
                ))
              : null}
            {panel === "topics" ? (
              <>
                {draft.topics.map((topic: any, i: number) => (
                  <Card key={topic.id}>
                    <Field
                      label="主题标题"
                      value={topic.title}
                      onChange={(v) => change("topics", i, "title", v)}
                    />
                    <Choices
                      label="上级主题"
                      value={topic.parent || ""}
                      onChange={(v) => change("topics", i, "parent", v || null)}
                      options={[
                        ["", "顶层"],
                        ...draft.topics
                          .filter((t: any) => t.id !== topic.id)
                          .map((t: any) => [t.id, t.title]),
                      ]}
                    />
                    {nodes.map(([n, title]) => (
                      <Toggle
                        key={n}
                        label={title}
                        value={topic.members.includes(n)}
                        onChange={(on) =>
                          change(
                            "topics",
                            i,
                            "members",
                            on
                              ? [...topic.members, n]
                              : topic.members.filter((v: string) => v !== n),
                          )
                        }
                      />
                    ))}
                    {refs("topics", i, topic)}
                    <Button
                      title="删除目录分组"
                      secondary
                      onPress={() => remove("topics", i)}
                    />
                  </Card>
                ))}
                <Button
                  title="新建目录分组"
                  onPress={() =>
                    add("topics", {
                      id: runtime.uuid(),
                      title: "新主题",
                      parent: null,
                      origin: "user",
                      sourceRefs: [],
                      members: [],
                    })
                  }
                />
              </>
            ) : null}
            {panel === "edges" ? (
              <>
                {draft.edges.map((edge: any, i: number) => (
                  <Card key={edge.id}>
                    <Choices
                      label="从"
                      value={edge.from}
                      onChange={(v) => change("edges", i, "from", v)}
                      options={nodes}
                    />
                    <Choices
                      label="到"
                      value={edge.to}
                      onChange={(v) => change("edges", i, "to", v)}
                      options={nodes}
                    />
                    <Choices
                      label="关系"
                      value={edge.type}
                      onChange={(v) => change("edges", i, "type", v)}
                      options={relationTypes.map((t: string) => [
                        t,
                        relationNames[t],
                      ])}
                    />
                    <Field
                      label="关系词"
                      value={edge.label}
                      onChange={(v) => change("edges", i, "label", v)}
                    />
                    <Field
                      label="成立条件"
                      value={edge.condition || ""}
                      onChange={(v) => change("edges", i, "condition", v)}
                    />
                    <Field
                      label="例外"
                      value={edge.exceptions || ""}
                      onChange={(v) => change("edges", i, "exceptions", v)}
                    />
                    <Field
                      label="解释"
                      value={edge.explanation || ""}
                      onChange={(v) => change("edges", i, "explanation", v)}
                      multiline
                    />
                    {refs("edges", i, edge)}
                    <Button
                      title="移除关系"
                      secondary
                      onPress={() => remove("edges", i)}
                    />
                  </Card>
                ))}
                <Button
                  title="新增关系"
                  disabled={nodes.length < 2}
                  onPress={() =>
                    add("edges", {
                      id: runtime.uuid(),
                      from: nodes[0][0],
                      to: nodes[1][0],
                      type: "support",
                      label: "支持",
                      direction: "from-to",
                      status: "user",
                      sourceRefs: [],
                      condition: "",
                      exceptions: "",
                      explanation: "",
                    })
                  }
                />
              </>
            ) : null}
            <Button
              title="保存结构修订"
              disabled={
                working || !dirty || r.data?.structure?.state === "stale"
              }
              onPress={() => void save()}
            />
            {r.data?.structure?.pendingCandidate ? (
              <Button
                title="采用待核对的新候选"
                disabled={working}
                secondary
                onPress={() =>
                  Alert.alert(
                    "采用新结构候选",
                    "保留此前人工版本，并用此候选更新当前结构。",
                    [
                      { text: "取消", style: "cancel" },
                      {
                        text: "采用",
                        onPress: () =>
                          void save(r.data.structure.pendingCandidate),
                      },
                    ],
                  )
                }
              />
            ) : null}
          </>
        )}
      </Body>
    </Status>
  );
}

export default function Structure() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    resource = useResource("/api/notes/" + id);
  return (
    <Status resource={resource}>
      {resource.data ? <StructureEditor key={id} resource={resource} /> : null}
    </Status>
  );
}
