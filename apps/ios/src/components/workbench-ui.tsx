import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { Host, Button as SystemButton, Switch } from "@expo/ui";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAppearance } from "../services/appearance";
import { accentPalette } from "../reference/accent.mjs";
export function usePalette() {
  const dark = useColorScheme() === "dark",
    preference = useAppearance(),
    palette = accentPalette(preference.accent, dark);
  return {
    background: dark ? "#111111" : "#f7f5f1",
    surface: dark ? "#1d1d1b" : "#ffffff",
    text: dark ? "#eeeae2" : "#24241f",
    muted: dark ? "#aaa69e" : "#747168",
    line: dark ? "#383833" : "#e5e1d9",
    accent: palette.accent,
    ink: palette.ink,
    danger: dark ? "#ff9b94" : "#b8342f",
  };
}
export function Body({
  children,
  form = false,
}: {
  children: React.ReactNode;
  form?: boolean;
}) {
  const c = usePalette();
  const Container = form ? KeyboardAwareScrollView : ScrollView;
  return (
    <Container
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 48 }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </Container>
  );
}
export function Label({
  children,
  muted = false,
  large = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
  large?: boolean;
}) {
  const c = usePalette();
  return (
    <Text
      selectable
      style={{
        color: muted ? c.muted : c.text,
        fontSize: large ? 27 : 16,
        lineHeight: large ? 35 : 25,
        fontWeight: large ? "600" : "400",
      }}
    >
      {children}
    </Text>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  const c = usePalette();
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: 18,
        borderCurve: "continuous",
        padding: 18,
        gap: 12,
      }}
    >
      {children}
    </View>
  );
}
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const c = usePalette();
  return (
    <Host matchContents seedColor={c.accent}>
      <SystemButton
        label={title}
        disabled={disabled}
        onPress={onPress}
        variant={secondary ? "outlined" : "filled"}
      />
    </Host>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Host matchContents>
      <Switch
        label={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      />
    </Host>
  );
}
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  secure = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  secure?: boolean;
  numeric?: boolean;
}) {
  const c = usePalette();
  return (
    <View style={{ gap: 7 }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        secureTextEntry={secure}
        keyboardType={numeric ? "decimal-pad" : "default"}
        autoCapitalize={secure ? "none" : "sentences"}
        autoCorrect={!secure}
        textAlignVertical="top"
        style={{
          fontSize: 17,
          lineHeight: 25,
          minHeight: multiline ? 160 : 48,
          padding: 13,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.line,
          color: c.text,
          backgroundColor: c.surface,
        }}
      />
    </View>
  );
}
export function Row({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 15,
        paddingHorizontal: 17,
        minHeight: 52,
        borderRadius: 12,
        backgroundColor: pressed ? c.line : c.surface,
        gap: 4,
      })}
    >
      <Text
        numberOfLines={3}
        style={{
          fontSize: 17,
          lineHeight: 24,
          color: c.text,
          fontWeight: "500",
        }}
      >
        {title}
      </Text>
      {detail ? (
        <Text
          numberOfLines={2}
          style={{ fontSize: 14, lineHeight: 21, color: c.muted }}
        >
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}
export function Choices({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  const c = usePalette();
  return (
    <View style={{ gap: 8 }}>
      {label ? <Label>{label}</Label> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map(([key, text]) => (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected: key === value }}
            onPress={() => onChange(key)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: key === value ? c.accent : c.surface,
              borderWidth: 1,
              borderColor: key === value ? c.accent : c.line,
            }}
          >
            <Text
              style={{ fontSize: 15, color: key === value ? c.ink : c.text }}
            >
              {text}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function Status({
  resource,
  children,
}: {
  resource: any;
  children: React.ReactNode;
}) {
  if (resource.data === undefined)
    return (
      <Body>
        {resource.error ? (
          <>
            <Label>{resource.error}</Label>
            <Button title="重试" onPress={() => void resource.refresh()} />
          </>
        ) : (
          <ActivityIndicator accessibilityLabel="正在读取" />
        )}
      </Body>
    );
  return (
    <>
      {resource.error ? (
        <View style={{ padding: 12 }}>
          <Label>{resource.error}</Label>
          <Button
            title="重新读取"
            secondary
            onPress={() => void resource.refresh()}
          />
        </View>
      ) : null}
      {children}
    </>
  );
}
export const openNote = (id: string) =>
  router.push({ pathname: "/note/[id]", params: { id } } as any);
export const openSection = (name: string) =>
  router.push({ pathname: "/section/[name]", params: { name } } as any);
export const openForm = (kind: string, id = "") =>
  router.push({ pathname: "/form", params: { kind, id } } as any);
