import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";
let value = { mode: "system", accent: "#a25d40" };
const listeners = new Set<() => void>();
export function setAppearance(input: any) {
  value = {
    mode: ["system", "light", "dark"].includes(input?.mode)
      ? input.mode
      : "system",
    accent: /^#[0-9a-f]{6}$/i.test(input?.accent) ? input.accent : "#a25d40",
  };
  Appearance.setColorScheme(
    value.mode === "system" ? "unspecified" : (value.mode as "light" | "dark"),
  );
  listeners.forEach((fn) => fn());
}
export function useAppearance() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => value,
  );
}
