import { NativeTabs } from "expo-router/native-tabs";
import { usePalette } from "./workbench-ui";

// Keep the existing native iOS navigation while Android uses the selected design.
export default function MobileTabs() {
  const c = usePalette();
  return <NativeTabs sidebarAdaptable tintColor={c.accent} backgroundColor={c.surface}
    iconColor={{ default: c.muted, selected: c.accent }}
    labelStyle={{ default: { color: c.muted }, selected: { color: c.accent } }}
    labelVisibilityMode="labeled" indicatorColor={c.accent + "18"}>
    {[["index", "今日", "sun.max", "zhixu_tab_today"], ["capture", "收集", "plus.circle", "zhixu_tab_capture"],
      ["library", "知识库", "books.vertical", "zhixu_tab_library"], ["study", "学习", "brain.head.profile", "zhixu_tab_study"],
      ["output", "应用", "square.and.pencil", "zhixu_tab_output"]].map(([name, label, symbol, drawable]) => (
      <NativeTabs.Trigger key={name} name={name}><NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={symbol as any} drawable={drawable} /></NativeTabs.Trigger>
    ))}
  </NativeTabs>;
}
