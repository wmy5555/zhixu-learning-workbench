import React, { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { formatSelection } from "../services/markdown-edit.mjs";
import { usePalette } from "./workbench-ui";
export function MarkdownEditor({
  value,
  onChange,
  label = "正文",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const c = usePalette(),
    selection = useRef({ start: 0, end: 0 }),
    input = useRef<React.ComponentRef<typeof TextInput>>(null),
    [cursor, setCursor] = useState<
      { start: number; end: number } | undefined
    >();
  function format(kind: string) {
    const result = formatSelection(value, selection.current, kind);
    onChange(result.body);
    selection.current = result.selection;
    setCursor(result.selection);
    input.current?.focus();
  }
  return (
    <View style={{ gap: 8 }}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {[
          ["bold", "加粗"],
          ["heading", "标题"],
          ["list", "列表"],
          ["quote", "引用"],
          ["code", "代码"],
          ["link", "链接"],
          ["table", "表格"],
        ].map(([kind, title]) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            onPress={() => format(kind)}
            style={{
              minHeight: 44,
              paddingHorizontal: 14,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: c.accent, fontSize: 15 }}>{title}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <TextInput
        ref={input}
        accessibilityLabel={label}
        multiline
        value={value}
        onChangeText={onChange}
        selection={cursor}
        onSelectionChange={(event) => {
          selection.current = event.nativeEvent.selection;
          if (cursor) setCursor(undefined);
        }}
        textAlignVertical="top"
        style={{
          minHeight: 240,
          padding: 15,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 14,
          color: c.text,
          backgroundColor: c.surface,
          fontSize: 17,
          lineHeight: 27,
        }}
      />
    </View>
  );
}
