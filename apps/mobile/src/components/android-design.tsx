import React, { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, Text, View, useColorScheme, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useAppearance } from "../services/appearance";
import { accentPalette } from "../reference/accent.mjs";
import { Icon as AssetIcon } from "./android-icon";

// Warm surfaces from the selected CDS prototype; motion follows Emil's native
// recipes. This module is Android UI only, with no storage or network behavior.
const MotionPreference = createContext(false);
export function AndroidDesignProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduced(value); });
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { mounted = false; listener.remove(); };
  }, []);
  return <MotionPreference.Provider value={reduced}>{children}</MotionPreference.Provider>;
}
export const useMotionPreference = () => useContext(MotionPreference);

export function useAndroidPalette() {
  const preference = useAppearance(), system = useColorScheme();
  const dark = preference.mode === "system" ? system === "dark" : preference.mode === "dark";
  // Retain explicitly selected colors; translate the first edition's default clay.
  const seed = preference.accent.toLowerCase() === "#a25d40" ? "#c6613f" : preference.accent;
  const accent = accentPalette(seed, dark), button = accentPalette(seed, false);
  return {
    colorScheme: (dark ? "dark" : "light") as "dark" | "light",
    background: dark ? "#1a1a18" : "#f6f5f0",
    surface: dark ? "#242421" : "#eeede7",
    raised: dark ? "#2b2b27" : "#fcfcf9",
    text: dark ? "#e8e5df" : "#302f2b",
    muted: dark ? "#b1aea5" : "#68665e",
    subtle: dark ? "#96938a" : "#77736b",
    line: dark ? "#353530" : "#e1dfd6",
    accent: accent.accent,
    ink: accent.ink,
    brand: button.accent,
    brandInk: button.ink,
    tint: accent.accent + "16",
    danger: dark ? "#ffaaa0" : "#ab362b",
  };
}
export function Icon({ color, ...props }: React.ComponentProps<typeof AssetIcon>) {
  const c = useAndroidPalette();
  return <AssetIcon color={color || c.muted} {...props} />;
}
export function PageHeading({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: React.ReactNode }) {
  const c = useAndroidPalette();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 5 }}>
    <View style={{ flex: 1, gap: 8 }}>
      {eyebrow ? <Text style={{ color: c.subtle, fontSize: 10, letterSpacing: 1.25, lineHeight: 16 }}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" selectable style={{ color: c.text, fontFamily: "serif", fontSize: 27, lineHeight: 39 }}>{title}</Text>
    </View>{action}
  </View>;
}
export function Action({ title, onPress, disabled = false, kind = "primary", icon }: {
  title: string; onPress: () => void; disabled?: boolean; kind?: "primary" | "secondary" | "text"; icon?: string;
}) {
  const c = useAndroidPalette(), reduced = useMotionPreference();
  const foreground = kind === "primary" ? c.brandInk : kind === "text" ? c.accent : c.text;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} pressRetentionOffset={18} style={{ minHeight: 48, justifyContent: "center" }}>
    {({ pressed }) => <Animated.View style={{
      minHeight: 48, paddingHorizontal: kind === "text" ? 2 : 17, paddingVertical: 11,
      borderRadius: 10, backgroundColor: kind === "primary" ? c.brand : kind === "secondary" ? c.surface : "transparent",
      opacity: disabled ? 0.38 : 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      transform: [{ scale: pressed && !reduced ? 0.98 : 1 }], transitionProperty: "transform",
      transitionDuration: reduced ? 0 : 120, transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
    }}><Text style={{ color: foreground, fontSize: 14, lineHeight: 21, fontWeight: "500", flexShrink: 1, textAlign: "center" }}>{title}</Text>{icon ? <Icon name={icon} size={17} color={foreground} /> : null}</Animated.View>}
  </Pressable>;
}
export function Panel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useAndroidPalette();
  return <View style={[{ backgroundColor: c.surface, borderRadius: 15, padding: 20, gap: 14 }, style]}>{children}</View>;
}
export function Caption({ children }: { children: React.ReactNode }) {
  const c = useAndroidPalette();
  return <Text selectable style={{ color: c.subtle, fontSize: 11, lineHeight: 18 }}>{children}</Text>;
}
export function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  const c = useAndroidPalette();
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
    <Text accessibilityRole="header" style={{ color: c.text, fontFamily: "serif", fontSize: 20, lineHeight: 28, flexShrink: 1 }}>{title}</Text>{action}
  </View>;
}
export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  const c = useAndroidPalette();
  return <View style={{ alignItems: "center", paddingVertical: 26, paddingHorizontal: 12, gap: 13 }}>
    <Icon name="leaf" size={29} color={c.accent} />
    <Text style={{ color: c.text, fontFamily: "serif", fontSize: 21, lineHeight: 31, textAlign: "center" }}>{title}</Text>
    {detail ? <Text style={{ color: c.muted, fontSize: 13, lineHeight: 22, textAlign: "center" }}>{detail}</Text> : null}
    {action}
  </View>;
}
