export function formatSelection(body, selection, kind) {
  const start = Math.max(0, Math.min(body.length, selection.start)),
    end = Math.max(start, Math.min(body.length, selection.end));
  const selected = body.slice(start, end);
  const pairs = {
    bold: ["**", "**", "文字"],
    heading: ["\n## ", "\n", "标题"],
    list: ["\n- ", "\n", "项目"],
    quote: ["\n> ", "\n", "引用"],
    code: ["\n```\n", "\n```\n", "代码"],
    link: ["[", "](https://)", "链接文字"],
    table: ["\n", "\n", "| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |"],
  };
  const pair = pairs[kind];
  if (!pair) throw Error("未知格式操作");
  const [before, after, fallback] = pair,
    text = selected || fallback;
  return {
    body: body.slice(0, start) + before + text + after + body.slice(end),
    selection: {
      start: start + before.length,
      end: start + before.length + text.length,
    },
  };
}
