import React, { useState } from "react";
import { useResource } from "../services/app-state";
import {
  Body,
  Button,
  Label,
  Row,
  Status,
  useWorkbenchNavigation,
} from "../components/workbench-ui";
export default function Study() {
  const { router, openSection } = useWorkbenchNavigation();
  const [offset, setOffset] = useState(0);
  const r = useResource("/api/study?limit=30&offset=" + offset);
  return (
    <Status resource={r}>
      <Body>
        <Label large>学习</Label>
        <Row title="主题学习" onPress={() => openSection("topics")} />
        <Row title="错题修正" onPress={() => openSection("mistakes")} />
        <Row
          title="知识使用建议"
          onPress={() => openSection("recommendations")}
        />
        <Row title="关联审阅" onPress={() => openSection("relations")} />
        <Label>学习记录</Label>
        {r.data?.sessions?.map((s: any) => (
          <Row
            key={s.id}
            title={s.question}
            detail={
              s.status === "completed"
                ? "已结束"
                : s.status === "awaiting_feedback"
                  ? "等待反馈"
                  : "继续练习"
            }
            onPress={() =>
              router.push({
                pathname: "/session/[id]",
                params: { id: s.id },
              } as any)
            }
          />
        ))}
        {!r.data?.sessions?.length ? (
          <Label muted>从今日安排或知识详情开始一次练习。</Label>
        ) : null}
        <Button
          title="上一页"
          secondary
          disabled={offset === 0}
          onPress={() => setOffset((n) => Math.max(0, n - 30))}
        />
        <Button
          title="下一页"
          secondary
          disabled={offset + 30 >= (r.data?.total || 0)}
          onPress={() => setOffset((n) => n + 30)}
        />
      </Body>
    </Status>
  );
}
