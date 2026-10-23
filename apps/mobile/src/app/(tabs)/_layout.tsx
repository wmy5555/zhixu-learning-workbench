import { NativeTabs } from "expo-router/native-tabs";
export default function Tabs() {
  return (
    <NativeTabs sidebarAdaptable>
      {[
        ["index", "今日", "sun.max", "today"],
        ["capture", "收集", "plus.circle", "add_circle"],
        ["library", "知识库", "books.vertical", "library_books"],
        ["study", "学习", "brain.head.profile", "school"],
        ["output", "应用", "square.and.pencil", "edit_note"],
      ].map(([name, label, symbol, material]) => (
        <NativeTabs.Trigger key={name} name={name}>
          <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={symbol as any} md={material as any} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
