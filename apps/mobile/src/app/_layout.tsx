import React from "react";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { WorkbenchProvider, useWorkbench } from "@/services/app-state";
import { Body, Label, usePalette } from "@/components/workbench-ui";
function Routes() {
  const { ready, startupError, practiceId } = useWorkbench(),
    c = usePalette();
  if (!ready)
    return (
      <Body>
        <Label>{startupError || "正在打开资料库…"}</Label>
      </Body>
    );
  return (
    <>
    <StatusBar style={c.colorScheme === "dark" ? "light" : "dark"} />
    <Stack
      key={practiceId}
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: c.background },
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.text,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="note/[id]" options={{ title: "阅读" }} />
      <Stack.Screen name="session/[id]" options={{ title: "学习" }} />
      <Stack.Screen name="section/[name]" options={{ title: "知序" }} />
      <Stack.Screen name="search" options={{ title: "检索" }} />
      <Stack.Screen name="focus" options={{ title: "专注" }} />
      <Stack.Screen name="batch" options={{ title: "批量导入" }} />
      <Stack.Screen name="structure" options={{ title: "资料结构" }} />
      <Stack.Screen name="merge" options={{ title: "合并知识" }} />
      <Stack.Screen name="appearance" options={{ title: "外观" }} />
      <Stack.Screen
        name="form"
        options={{
          title: "编辑",
          presentation: "modal",
          gestureEnabled: false,
        }}
      />
    </Stack>
    </>
  );
}
export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <WorkbenchProvider>
          <Routes />
        </WorkbenchProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
