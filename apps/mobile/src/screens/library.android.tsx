import React, { useMemo, useState } from "react";
import { BackHandler, FlatList, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useFocusEffect } from "expo-router";
import { useResource } from "../services/app-state";
import { Status, useWorkbenchNavigation } from "../components/workbench-ui";
import { Action, Caption, EmptyState, Icon, PageHeading, SectionHeading, useAndroidPalette } from "../components/android-design";
import { NoteContent } from "./note";

const kinds: [string, string][] = [["", "全部"], ["source", "原始资料"], ["knowledge", "知识"], ["topic", "主题"], ["mistake", "错题"]];
const kindName = (kind: string) => kinds.find(([key]) => key === kind)?.[1] || "资料";
function excerpt(note: any) {
  return String(note.meta?.excerpt || note.body || "").slice(0, 180).replace(/\s+/g, " ").trim();
}

export default function Library() {
  const { router, openNote } = useWorkbenchNavigation();
  const [q, setQ] = useState(""), [kind, setKind] = useState("");
  const [selected, setSelected] = useState("");
  const wide = useWindowDimensions().width >= 840;
  const c = useAndroidPalette();
  const r = useResource("/api/notes");
  useFocusEffect(React.useCallback(() => {
    if (!selected) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { setSelected(""); return true; });
    return () => listener.remove();
  }, [selected]));
  const notes = useMemo(() => (r.data?.notes || []).filter((n: any) =>
    (!kind || n.kind === kind) && (!q || (n.title + " " + (n.body || "")).toLowerCase().includes(q.toLowerCase()))),
  [r.data, kind, q]);
  const featured = !q && !kind ? notes[0] : null;
  const items = featured ? notes.slice(1) : notes;
  const read = (id: string) => wide ? setSelected(id) : openNote(id);
  const collect = () => router.push("/(tabs)/capture" as any);
  return <Status resource={r}>
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.background }}>
      <View style={wide ? { width: 360, borderRightWidth: 1, borderRightColor: c.line } : { flex: 1, display: selected ? "none" : "flex" }}>
        <FlatList
          style={{ backgroundColor: c.background }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          data={items} keyExtractor={(n: any) => n.id}
          refreshing={r.loading} onRefresh={() => void r.refresh()}
          ListHeaderComponent={<View style={{ gap: 18 }}>
            <PageHeading title="想法，在这里相遇。" eyebrow="LIBRARY / A PLACE FOR IDEAS"
              action={<Action title="收集" icon="plus" kind="text" onPress={collect} />} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.raised, borderRadius: 10, paddingHorizontal: 13 }}>
              <Icon name="search" color={c.muted} size={19} />
              <TextInput accessibilityLabel="查找资料" placeholder="找回一个想法…" placeholderTextColor={c.subtle}
                value={q} onChangeText={setQ} returnKeyType="search"
                style={{ flex: 1, minHeight: 48, paddingVertical: 10, fontSize: 15, color: c.text }} />
              {q ? <Pressable accessibilityRole="button" accessibilityLabel="清空查找" onPress={() => setQ("")}
                style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}><Icon name="close" size={17} color={c.muted} /></Pressable> : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 24 }} style={{ borderBottomColor: c.line, borderBottomWidth: 1 }}>
              {kinds.map(([key, label]) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ selected: kind === key }}
                onPress={() => setKind(key)} style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", borderBottomWidth: 2,
                  borderBottomColor: kind === key ? c.accent : "transparent", opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ fontSize: 14, color: kind === key ? c.accent : c.muted }}>{label}</Text>
              </Pressable>)}
            </ScrollView>
            {featured ? <>
              <Pressable accessibilityRole="button" accessibilityLabel={`阅读 ${featured.title}`} onPress={() => read(featured.id)}
                style={({ pressed }) => ({ backgroundColor: c.surface, borderRadius: 16, padding: 22, gap: 16, opacity: pressed ? 0.75 : 1 })}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Caption>{kindName(featured.kind)}</Caption><Icon name="book" size={18} color={c.accent} /></View>
                <Text numberOfLines={3} style={{ color: c.text, fontFamily: "serif", fontSize: 27, lineHeight: 38 }}>{featured.title}</Text>
                {excerpt(featured) ? <Text numberOfLines={3} style={{ color: c.muted, fontSize: 14, lineHeight: 24 }}>{excerpt(featured)}</Text> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 }}><Text style={{ color: c.accent, fontSize: 14 }}>打开阅读</Text><Icon name="arrow" size={17} color={c.accent} /></View>
              </Pressable>
              {items.length ? <SectionHeading title="其他资料" /> : null}
            </> : notes.length ? <Caption>{notes.length.toLocaleString()} 份资料</Caption> : null}
          </View>}
          ListEmptyComponent={featured ? undefined : <View style={{ paddingVertical: 28 }}><EmptyState
            title={q || kind ? "暂时没有找到" : "给思考，留个地方。"}
            detail={q || kind ? "换个词，或看看其他分类。" : "第一份资料，会成为下次思考的起点。"}
            action={q || kind ? <Action title="查看全部" kind="text" onPress={() => { setQ(""); setKind(""); }} /> : <Action title="收集第一份资料" onPress={collect} />} />
          </View>}
          renderItem={({ item: n }: any) => <Pressable accessibilityRole="button" accessibilityState={{ selected: selected === n.id }}
            onPress={() => read(n.id)} style={({ pressed }) => ({ paddingVertical: 18, paddingHorizontal: 2, borderBottomWidth: 1,
              borderBottomColor: c.line, gap: 8, backgroundColor: pressed || selected === n.id ? c.tint : "transparent" })}>
            <Caption>{[kindName(n.kind), n.meta?.topic].filter(Boolean).join(" · ")}</Caption>
            <Text numberOfLines={2} style={{ color: c.text, fontFamily: "serif", fontSize: 20, lineHeight: 29 }}>{n.title}</Text>
            {excerpt(n) ? <Text numberOfLines={2} style={{ color: c.muted, fontSize: 14, lineHeight: 23 }}>{excerpt(n)}</Text> : null}
          </Pressable>}
        />
      </View>
      {selected ? <View style={{ flex: 1 }}>
        {!wide ? <Action title="返回列表" kind="text" icon="left" onPress={() => setSelected("")} /> : null}
        <NoteContent key={selected} id={selected} />
      </View> : wide ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <EmptyState title="翻开自己的思考。" detail="选择一份资料开始阅读。" />
      </View> : null}
    </View>
  </Status>;
}
