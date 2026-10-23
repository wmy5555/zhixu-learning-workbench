import { Image } from "expo-image";
import type { ImageStyle, StyleProp } from "react-native";

// Original prototype line drawings, plus matching hand-drawn utility symbols.
// Keep require arguments literal so Metro includes every SVG in standalone APKs.
const sources: Record<string, number> = {
  leaf: require("../../assets/ui-icons/leaf.svg"),
  sun: require("../../assets/ui-icons/sun.svg"),
  plus: require("../../assets/ui-icons/plus.svg"),
  book: require("../../assets/ui-icons/book.svg"),
  learn: require("../../assets/ui-icons/learn.svg"),
  pen: require("../../assets/ui-icons/pen.svg"),
  search: require("../../assets/ui-icons/search.svg"),
  right: require("../../assets/ui-icons/right.svg"),
  left: require("../../assets/ui-icons/left.svg"),
  arrow: require("../../assets/ui-icons/arrow.svg"),
  up: require("../../assets/ui-icons/up.svg"),
  down: require("../../assets/ui-icons/down.svg"),
  close: require("../../assets/ui-icons/close.svg"),
  settings: require("../../assets/ui-icons/settings.svg"),
  clock: require("../../assets/ui-icons/clock.svg"),
  spark: require("../../assets/ui-icons/spark.svg"),
  layers: require("../../assets/ui-icons/layers.svg"),
  attach: require("../../assets/ui-icons/attach.svg"),
  check: require("../../assets/ui-icons/check.svg"),
  file: require("../../assets/ui-icons/file.svg"),
  bookmark: require("../../assets/ui-icons/bookmark.svg"),
  refresh: require("../../assets/ui-icons/refresh.svg"),
  signal: require("../../assets/ui-icons/signal.svg"),
  wifi: require("../../assets/ui-icons/wifi.svg"),
  battery: require("../../assets/ui-icons/battery.svg"),
  more: require("../../assets/ui-icons/more.svg"),
  moon: require("../../assets/ui-icons/moon.svg"),
  quote: require("../../assets/ui-icons/quote.svg"),
  menu: require("../../assets/ui-icons/menu.svg"),
  archive: require("../../assets/ui-icons/archive.svg"),
  trash: require("../../assets/ui-icons/trash.svg"),
  link: require("../../assets/ui-icons/link.svg"),
  history: require("../../assets/ui-icons/history.svg"),
};

const aliases: Record<string, string> = {
  "today": "sun",
  "home": "leaf",
  "add": "plus",
  "create": "plus",
  "book-open": "book",
  "library": "book",
  "reader": "book",
  "brain": "learn",
  "study": "learn",
  "school": "learn",
  "edit": "pen",
  "pencil": "pen",
  "capture": "pen",
  "chevron-right": "right",
  "chevron-left": "left",
  "chevron-down": "down",
  "chevron-up": "up",
  "arrow-right": "arrow",
  "arrow-up-right": "up",
  "arrow-forward": "arrow",
  "arrow-back": "left",
  "back": "left",
  "x": "close",
  "dismiss": "close",
  "app": "settings",
  "tune": "settings",
  "sliders": "settings",
  "focus": "clock",
  "timer": "clock",
  "time": "clock",
  "sparkles": "spark",
  "ai": "spark",
  "structure": "layers",
  "copy": "layers",
  "paperclip": "attach",
  "attachment": "attach",
  "done": "check",
  "document": "file",
  "file-text": "file",
  "note": "file",
  "rotate-cw": "refresh",
  "reload": "refresh",
  "restore": "history",
  "undo": "history",
  "more-horizontal": "more",
  "ellipsis": "more",
  "dark": "moon",
  "list": "menu",
  "trash-2": "trash",
  "delete": "trash",
  "link-2": "link",
  "external": "up",
  "external-link": "up",
};

export type IconProps = {
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
};

/** Decorative icon; the surrounding control owns its accessible label. */
export function Icon({ name, size = 22, color = "#b1aea5", style }: IconProps) {
  const requested = name.trim().toLowerCase();
  const key = Object.hasOwn(aliases, requested) ? aliases[requested] : requested;
  const source = Object.hasOwn(sources, key) ? sources[key] : sources.file;
  return (
    <Image
      source={source}
      style={[{ width: size, height: size, flexShrink: 0 }, style]}
      contentFit="contain"
      tintColor={color}
      transition={0}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
