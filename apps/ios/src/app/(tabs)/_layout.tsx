import { NativeTabs } from "expo-router/native-tabs";
export default function Tabs() {
  return (
    <NativeTabs sidebarAdaptable>
      {[
        ["index", "今日", "sun.max"],
        ["capture", "收集", "plus.circle"],
        ["library", "知识库", "books.vertical"],
        ["study", "学习", "brain.head.profile"],
        ["output", "应用", "square.and.pencil"],
      ].map(([name, label, symbol]) => (
        <NativeTabs.Trigger key={name} name={name}>
          <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={symbol as any} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
