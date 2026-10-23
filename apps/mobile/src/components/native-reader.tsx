import React, { useMemo, useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { renderMarkdown } from "../reference/markdown-reader.mjs";
import { Button, usePalette } from "./workbench-ui";
export function Markdown({
  body,
  conversation = false,
  citationSources,
}: {
  body: string;
  conversation?: boolean;
  citationSources?: any[];
}) {
  const c = usePalette(),
    [expansion, setExpansion] = useState({ body, limit: 60 });
  const limit = expansion.body === body ? expansion.limit : 60;
  const tree = useMemo(
    () => (renderMarkdown as any)(body, { conversation, citationSources }),
    [body, conversation, citationSources],
  );
  function inline(node: any, key: string): React.ReactNode {
    if (typeof node !== "object") return String(node ?? "");
    if (node.tag === "br") return "\n";
    const link = node.tag === "a";
    return (
      <Text
        key={key}
        accessibilityRole={link ? "link" : undefined}
        onPress={
          link ? () => void Linking.openURL(node.options.href) : undefined
        }
        style={{
          color: link ? c.accent : undefined,
          fontWeight: node.tag === "strong" ? "700" : undefined,
          fontFamily: node.tag === "code" ? (Platform.OS === "android" ? "monospace" : "Menlo") : undefined,
          fontSize: node.tag === "code" ? 14 : undefined,
        }}
      >
        {node.children.map((n: any, i: number) => inline(n, key + "-" + i))}
      </Text>
    );
  }
  function block(node: any, key: string): React.ReactNode {
    if (typeof node !== "object")
      return (
        <Text
          key={key}
          selectable
          style={{ color: c.text, fontSize: 17, lineHeight: 29 }}
        >
          {String(node)}
        </Text>
      );
    if (node.tag === "pre")
      return (
        <ScrollView
          key={key}
          horizontal
          contentContainerStyle={{
            padding: 15,
            backgroundColor: c.surface,
            borderRadius: 12,
          }}
        >
          <Text
            selectable
            style={{
              fontFamily: Platform.OS === "android" ? "monospace" : "Menlo",
              fontSize: 14,
              lineHeight: 23,
              color: c.text,
            }}
          >
            {node.children.map((n: any, i: number) => inline(n, key + i))}
          </Text>
        </ScrollView>
      );
    if (node.tag === "hr")
      return <View key={key} style={{ height: 1, backgroundColor: c.line }} />;
    if (node.tag === "table")
      return (
        <View key={key} style={{ borderWidth: 1, borderColor: c.line }}>
          {node.children.map((n: any, i: number) => block(n, key + i))}
        </View>
      );
    if (node.tag === "thead" || node.tag === "tbody")
      return (
        <View key={key}>
          {node.children.map((n: any, i: number) => block(n, key + i))}
        </View>
      );
    if (node.tag === "tr")
      return (
        <View key={key} style={{ flexDirection: "row" }}>
          {node.children.map((n: any, i: number) => (
            <View
              key={i}
              style={{
                width: 180,
                padding: 12,
                borderRightWidth: 1,
                borderBottomWidth: 1,
                borderColor: c.line,
              }}
            >
              <Text
                selectable
                style={{
                  color: c.text,
                  fontSize: 16,
                  lineHeight: 25,
                  fontWeight: n.tag === "th" ? "600" : "400",
                }}
              >
                {n.children.map((v: any, j: number) => inline(v, key + i + j))}
              </Text>
            </View>
          ))}
        </View>
      );
    if (node.tag === "ul" || node.tag === "ol")
      return (
        <View key={key} style={{ gap: 8 }}>
          {node.children.map((n: any, i: number) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              <Text style={{ color: c.muted, fontSize: 17, lineHeight: 29 }}>
                {node.tag === "ol"
                  ? `${(Number(node.options.start) || 1) + i}.`
                  : "•"}
              </Text>
              <View style={{ flex: 1, gap: 8 }}>
                {n.children.map((v: any, j: number) => block(v, key + i + j))}
              </View>
            </View>
          ))}
        </View>
      );
    if (node.tag === "blockquote")
      return (
        <View
          key={key}
          style={{
            paddingLeft: 16,
            borderLeftWidth: 3,
            borderColor: c.line,
            gap: 10,
          }}
        >
          {node.children.map((n: any, i: number) => block(n, key + i))}
        </View>
      );
    if (node.tag === "div") {
      const content = node.children.map((n: any, i: number) =>
        block(n, key + i),
      );
      return node.options.class === "markdown-table-scroll" ? (
        <ScrollView key={key} horizontal>
          {content}
        </ScrollView>
      ) : (
        <View key={key} style={{ gap: 16 }}>
          {content}
        </View>
      );
    }
    const heading = /^h[1-6]$/.test(node.tag);
    return (
      <Text
        key={key}
        selectable
        style={{
          color: c.text,
          fontSize: heading ? Math.max(18, 29 - Number(node.tag[1]) * 2) : 17,
          lineHeight: heading ? 33 : 29,
          fontWeight: heading ? "600" : "400",
        }}
      >
        {node.children.map((n: any, i: number) => inline(n, key + i))}
      </Text>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      {tree.children
        .slice(0, limit)
        .map((node: any, i: number) => block(node, String(i)))}
      {tree.children.length > limit ? (
        <Button
          title="继续阅读"
          secondary
          onPress={() => setExpansion({ body, limit: limit + 60 })}
        />
      ) : null}
    </View>
  );
}
