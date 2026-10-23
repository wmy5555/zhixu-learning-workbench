import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Tabs } from "expo-router/js-tabs";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useRouter, useSegments } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Icon, useAndroidPalette, useMotionPreference } from "./android-design";
import { useWorkbench } from "../services/app-state";

const pages = [
  { name: "index", label: "今日", icon: "sun" },
  { name: "capture", label: "收集", icon: "plus" },
  { name: "library", label: "知识库", icon: "book" },
  { name: "study", label: "学习", icon: "learn" },
  { name: "output", label: "应用", icon: "pen" },
];

function NavigationBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const c = useAndroidPalette(), insets = useSafeAreaInsets(), reduced = useMotionPreference();
  const keyboardVisible = useKeyboardState(s => s.isVisible);
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (!width) return;
    // Tabs themselves are instantaneous peers. Only the selected mark moves.
    x.set(withTiming((width / pages.length) * state.index, {
      duration: reduced ? 0 : 150, easing: Easing.bezier(0.77, 0, 0.175, 1), reduceMotion: ReduceMotion.System,
    }));
  }, [state.index, width, reduced, x]);
  const marker = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  if (keyboardVisible) return null;
  return <View style={{ backgroundColor: c.background, paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(10, insets.bottom) }}>
    <View style={{ backgroundColor: c.surface, borderRadius: 17, paddingHorizontal: 6, paddingVertical: 7 }}>
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: "row", position: "relative" }}>
        {width ? <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, width: width / pages.length, alignItems: "center" }, marker]}>
          <View style={{ width: 16, height: 2, borderRadius: 2, backgroundColor: c.accent }} />
        </Animated.View> : null}
        {state.routes.map((route, index) => {
          const page = pages.find(p => p.name === route.name);
          if (!page) return null;
          const selected = state.index === index;
          return <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={page.label} accessibilityState={{ selected }}
            onPress={() => {
              const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!selected && !event.defaultPrevented) navigateToTab(route.key);
            }} onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
            style={({ pressed }) => ({ flex: 1, minHeight: 52, paddingTop: 7, paddingBottom: 3, alignItems: "center", justifyContent: "center", gap: 4, opacity: pressed ? 0.65 : 1 })}>
            <Icon name={page.icon} size={21} color={selected ? c.accent : c.subtle} />
            <Text style={{ color: selected ? c.accent : c.subtle, fontSize: 10, lineHeight: 15 }}>{page.label}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  </View>;
}

type DrawerItem = { title: string; icon: string; section?: string; route?: string };
const groups: { title: string; items: DrawerItem[] }[] = [
  { title: "学习与探索", items: [
    { title: "主题学习", icon: "layers", section: "topics" },
    { title: "错题修正", icon: "refresh", section: "mistakes" },
    { title: "知识使用建议", icon: "spark", section: "recommendations" },
    { title: "关联审阅", icon: "link", section: "relations" },
    { title: "检索与发现", icon: "search", route: "/search" },
  ] },
  { title: "我的工具", items: [
    { title: "专注计时", icon: "clock", route: "/focus" },
    { title: "输出草稿", icon: "pen", section: "drafts" },
    { title: "处理动态", icon: "spark", section: "jobs" },
    { title: "未安排知识", icon: "book", section: "unavailable" },
  ] },
  { title: "知识空间", items: [
    { title: "备份与恢复", icon: "archive", section: "backup" },
    { title: "回收站", icon: "trash", section: "recycle" },
    { title: "外观", icon: "moon", route: "/appearance" },
    { title: "设置", icon: "settings", section: "settings" },
    { title: "新手引导", icon: "leaf", section: "onboarding" },
  ] },
];

export default function MobileTabs() {
  const c = useAndroidPalette(), reduced = useMotionPreference(), insets = useSafeAreaInsets();
  const { width } = useWindowDimensions(), router = useRouter(), segments = useSegments();
  const { practiceId } = useWorkbench();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const brand = useRef<React.ComponentRef<typeof View>>(null), closing = useRef(false), afterClose = useRef<(() => void) | null>(null);
  const progress = useSharedValue(0);
  const drawerWidth = Math.min(336, width - 48);
  const activeName = String(segments[segments.length - 1] || "index");
  const pageName = pages.find(p => p.name === activeName)?.label || "今日";
  const drawerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.get() - 1) * drawerWidth }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() * 0.45 }));
  const finishClose = useCallback(() => {
    setDrawerVisible(false); closing.current = false;
    const action = afterClose.current; afterClose.current = null;
    if (action) action(); else brand.current?.focus();
  }, []);
  function closeDrawer(action?: () => void) {
    if (closing.current) return;
    closing.current = true; afterClose.current = action || null;
    if (reduced) { progress.set(0); finishClose(); return; }
    progress.set(withTiming(0, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1), reduceMotion: ReduceMotion.System }, finished => {
      if (finished) scheduleOnRN(finishClose);
    }));
  }
  function openDrawer() {
    closing.current = false; afterClose.current = null; progress.set(0); setDrawerVisible(true);
  }
  function choose(item: DrawerItem) {
    closeDrawer(() => item.route ? router.push(item.route as any) : router.push({ pathname: "/section/[name]", params: { name: item.section! } } as any));
  }
  useEffect(() => {
    if (reduced && drawerVisible && !closing.current) progress.set(1);
  }, [reduced, drawerVisible, progress]);
  return <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
    <View style={{ minHeight: 54, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Pressable ref={brand} accessibilityRole="button" accessibilityLabel="知序，打开侧栏" accessibilityState={{ expanded: drawerVisible }}
        onPress={openDrawer} hitSlop={4} style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.65 : 1 })}>
        <Icon name="leaf" size={21} color={c.accent} /><Text style={{ color: c.text, fontFamily: "serif", fontSize: 22, lineHeight: 32 }}>知序</Text>
        <Icon name="down" size={12} color={c.subtle} />
      </Pressable>
      <Text style={{ color: c.subtle, fontSize: 12 }}>{practiceId ? "练习 · " : ""}{pageName}</Text>
    </View>
    <Tabs backBehavior="history" screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: c.background }, lazy: true }} tabBar={props => <NavigationBar {...props} />}>
      {pages.map(page => <Tabs.Screen key={page.name} name={page.name} options={{ title: page.label }} />)}
    </Tabs>
    <Modal visible={drawerVisible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent
      onRequestClose={() => closeDrawer()} onShow={() => {
        progress.set(reduced ? 1 : withSpring(1, { duration: 300, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System }));
        AccessibilityInfo.announceForAccessibility("知序，更多功能");
      }}>
      <View style={{ flex: 1 }}>
        <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: 0, backgroundColor: "#000" }, scrimStyle]} />
        <Pressable accessibilityLabel="收起侧栏" accessibilityRole="button" onPress={() => closeDrawer()} style={{ position: "absolute", inset: 0 }} />
        <Animated.View accessibilityViewIsModal style={[{ width: drawerWidth, flex: 1, backgroundColor: c.background,
          paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 14), borderRightWidth: 1, borderRightColor: c.line }, drawerStyle]}>
          <View style={{ paddingHorizontal: 24, minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", gap: 9, alignItems: "center" }}><Icon name="leaf" size={23} color={c.accent} /><Text style={{ color: c.text, fontFamily: "serif", fontSize: 26 }}>知序</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭侧栏" onPress={() => closeDrawer()} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}><Icon name="left" size={19} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 12 }}>
            {groups.map(group => <View key={group.title} style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 19, paddingBottom: 12 }}>
              <Text style={{ color: c.subtle, fontSize: 10, lineHeight: 16, letterSpacing: 1, marginBottom: 7 }}>{group.title}</Text>
              {group.items.map(item => <Pressable key={item.title} accessibilityRole="button" onPress={() => choose(item)}
                style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}>
                <Icon name={item.icon} size={19} color={c.muted} /><Text style={{ color: c.text, fontSize: 14, lineHeight: 23, flexShrink: 1 }}>{item.title}</Text>
              </Pressable>)}
            </View>)}
          </ScrollView>
          <View style={{ marginHorizontal: 24, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 16, flexDirection: "row", gap: 11, alignItems: "center" }}>
            <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily: "serif", color: c.text }}>知</Text></View>
            <Text style={{ color: c.muted, fontSize: 12 }}>{practiceId ? "新手练习空间" : "我的知识空间"}</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  </SafeAreaView>;
}
