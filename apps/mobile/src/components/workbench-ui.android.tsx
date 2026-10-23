import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Host, Switch } from "@expo/ui";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Action, Icon, Panel, useAndroidPalette } from "./android-design";

export const usePalette = useAndroidPalette;
export function Body({ children, form = false }: { children: React.ReactNode; form?: boolean }) {
  const c = usePalette(), insets = useSafeAreaInsets();
  const Container = form ? KeyboardAwareScrollView : ScrollView;
  return <Container style={{ flex: 1, backgroundColor: c.background }}
    contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, gap: 18, paddingBottom: Math.max(28, insets.bottom + 20) }}
    contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    {children}
  </Container>;
}
export function Label({ children, muted = false, large = false }: { children: React.ReactNode; muted?: boolean; large?: boolean }) {
  const c = usePalette();
  return <Text selectable style={{ color: muted ? c.muted : c.text, fontFamily: large ? "serif" : undefined,
    fontSize: large ? 26 : 14, lineHeight: large ? 38 : 23, fontWeight: "400" }}>{children}</Text>;
}
export function Card({ children }: { children: React.ReactNode }) { return <Panel>{children}</Panel>; }
export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Action title={title} onPress={onPress} disabled={disabled} kind={secondary ? "secondary" : "primary"} />;
}
export function Toggle({ label, value, onChange, disabled = false }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const c = usePalette();
  return <View style={{ opacity: disabled ? 0.45 : 1, minHeight: 48 }}>
    <Host matchContents seedColor={c.brand} colorScheme={c.colorScheme}>
      <Switch label={label} value={value} disabled={disabled} onValueChange={onChange} />
    </Host>
  </View>;
}
export function Field({ label, value, onChange, multiline = false, secure = false, numeric = false }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; secure?: boolean; numeric?: boolean;
}) {
  const c = usePalette();
  return <View style={{ gap: 8 }}>
    <Text style={{ color: c.muted, fontSize: 12, lineHeight: 19 }}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline}
      secureTextEntry={secure} keyboardType={numeric ? "decimal-pad" : "default"} autoCapitalize={secure ? "none" : "sentences"}
      autoCorrect={!secure} textAlignVertical={multiline ? "top" : "center"} selectionColor={c.accent}
      style={{ fontSize: 15, lineHeight: 24, minHeight: multiline ? 144 : 48, padding: 13, borderRadius: 10,
        borderWidth: 1, borderColor: c.line, color: c.text, backgroundColor: c.surface }} />
  </View>;
}
export function Row({ title, detail, onPress }: { title: string; detail?: string; onPress: () => void }) {
  const c = usePalette();
  return <Pressable accessibilityRole="button" onPress={onPress} pressRetentionOffset={18}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, minHeight: 52,
      borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? 0.7 : 1 })}>
    <View style={{ flex: 1, gap: 5 }}><Text numberOfLines={3} style={{ fontSize: 15, lineHeight: 23, color: c.text }}>{title}</Text>
      {detail ? <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 19, color: c.muted }}>{detail}</Text> : null}</View>
    <Icon name="right" size={16} color={c.subtle} />
  </Pressable>;
}
export function Choices({ label, value, options, onChange }: { label?: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const c = usePalette();
  return <View style={{ gap: 7 }}>
    {label ? <Text style={{ fontSize: 12, color: c.muted }}>{label}</Text> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>{options.map(([key, text]) => (
      <Pressable key={key} accessibilityRole="radio" accessibilityState={{ selected: key === value }} onPress={() => onChange(key)}
        style={({ pressed }) => ({ paddingHorizontal: 13, paddingVertical: 12, minHeight: 48, borderRadius: 9,
          backgroundColor: key === value ? c.tint : "transparent", opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ fontSize: 13, lineHeight: 20, color: key === value ? c.accent : c.muted }}>{text}</Text>
      </Pressable>
    ))}</View>
  </View>;
}
export function Status({ resource, children }: { resource: any; children: React.ReactNode }) {
  const c = usePalette();
  if (resource.data === undefined) return <Body>{resource.error ? <><Label>{resource.error}</Label><Button title="重试" onPress={() => void resource.refresh()} /></>
    : <View style={{ minHeight: 150, justifyContent: "center" }}><ActivityIndicator color={c.accent} accessibilityLabel="正在读取" /></View>}</Body>;
  return <>{resource.error ? <View style={{ padding: 16, backgroundColor: c.surface }}><Label>{resource.error}</Label><Button title="重新读取" secondary onPress={() => void resource.refresh()} /></View> : null}{children}</>;
}
export function useWorkbenchNavigation() {
  const router = useRouter();
  return { router,
    openNote: (id: string) => router.push({ pathname: "/note/[id]", params: { id } } as any),
    openSection: (name: string) => router.push({ pathname: "/section/[name]", params: { name } } as any),
    openForm: (kind: string, id = "") => router.push({ pathname: "/form", params: { kind, id } } as any),
  };
}
