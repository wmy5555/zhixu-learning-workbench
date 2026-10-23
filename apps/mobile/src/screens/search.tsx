import React, { useRef, useState } from "react";
import { useWorkbench } from "../services/app-state";
import {
  Body,
  Button,
  Card,
  Choices,
  Field,
  Label,
  Row,
  Toggle,
  useWorkbenchNavigation,
} from "../components/workbench-ui";
export default function Search() {
  const { openNote, openSection } = useWorkbenchNavigation();
  const { api, working } = useWorkbench(),
    [q, setQ] = useState(""),
    [mode, setMode] = useState("keyword"),
    [cloud, setCloud] = useState(false),
    [results, setResults] = useState<any[]>([]),
    [cursor, setCursor] = useState(""),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false);
  const version = useRef(0);
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [showFilters, setShowFilters] = useState(false);
  async function search(more = false) {
    const current = ++version.current;
    setError("");
    try {
      const response = await api.get(
        "/api/search?" +
          new URLSearchParams({
            q,
            mode,
            privacy: cloud ? "cloud" : "local",
            limit: "30",
            ...Object.fromEntries(
              Object.entries(filters).filter(([, v]) => v.trim()),
            ),
            ...(more && cursor ? { cursor } : {}),
          }),
      );
      if (current !== version.current) return;
      setResults((old) =>
        more ? [...old, ...response.results] : response.results,
      );
      setCursor(response.nextCursor || "");
      setSearched(true);
      if (response.diagnostics?.limitations?.length)
        setError(response.diagnostics.limitations.join("；"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Body form>
      <Label large>检索与发现</Label>
      <Field
        label="关键词或问题"
        value={q}
        onChange={(v) => {
          setQ(v);
          setCursor("");
          version.current++;
        }}
      />
      <Choices
        value={mode}
        onChange={(v) => {
          setMode(v);
          if (v === "keyword") setCloud(false);
          setCursor("");
          version.current++;
        }}
        options={[
          ["keyword", "关键词"],
          ["semantic", "语义"],
          ["hybrid", "综合"],
        ]}
      />
      <Toggle
        label="允许本次调用向量服务"
        value={cloud}
        disabled={mode === "keyword"}
        onChange={setCloud}
      />
      <Button
        title="筛选"
        secondary
        onPress={() => setShowFilters((v) => !v)}
      />
      {showFilters ? (
        <>
          <Choices
            label="类型"
            value={filters.kind || ""}
            options={[
              ["", "全部"],
              ["source", "原始资料"],
              ["knowledge", "知识"],
              ["topic", "主题"],
            ]}
            onChange={(value) => {
              setFilters((f) => ({ ...f, kind: value }));
              setCursor("");
              version.current++;
            }}
          />
          <Choices
            label="阶段"
            value={filters.stage || ""}
            options={[
              ["", "全部"],
              ["reference", "查阅"],
              ["candidate", "待选学"],
              ["learning", "学习中"],
              ["integrated", "个人知识"],
              ["core", "核心知识"],
            ]}
            onChange={(value) => {
              setFilters((f) => ({ ...f, stage: value }));
              setCursor("");
              version.current++;
            }}
          />
          {Object.entries({
            topic: "主题",
            from: "开始日期（YYYY-MM-DD）",
            to: "结束日期（YYYY-MM-DD）",
          }).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={filters[key] || ""}
              onChange={(v) => {
                setFilters((f) => ({ ...f, [key]: v }));
                setCursor("");
                version.current++;
              }}
            />
          ))}
        </>
      ) : null}
      <Button
        title="检索"
        disabled={working || !q.trim()}
        onPress={() => void search()}
      />
      {error ? <Label>{error}</Label> : null}
      {searched && !results.length ? (
        <Label muted>没有匹配的当前材料。</Label>
      ) : null}
      {results.map((n: any) => (
        <Row
          key={n.id}
          title={n.title}
          detail={n.snippet || n.body}
          onPress={() => openNote(n.id)}
        />
      ))}
      {cursor ? (
        <Button
          title="更多结果"
          secondary
          disabled={working}
          onPress={() => void search(true)}
        />
      ) : null}
      <Card>
        <Row title="知识关联与发现" onPress={() => openSection("relations")} />
      </Card>
    </Body>
  );
}
