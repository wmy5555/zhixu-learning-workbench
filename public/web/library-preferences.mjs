import { kindOptions, stageOptions } from './classification.mjs';
const KEY = 'zhixu.library-view.v1';
export function normalizeLibraryPreferences(value) {
  const v = value && typeof value === 'object' ? value : {};
  return { q: typeof v.q === 'string' ? v.q : '', kind: kindOptions.some(([value]) => value === v.kind) ? v.kind : '', stage: stageOptions.some(([value]) => value === v.stage) ? v.stage : '', grouped: v.grouped === true, optionsOpen: v.optionsOpen === true, adviceOpen: v.adviceOpen === true };
}
export function createLibraryPreferences(storage = () => globalThis.localStorage) {
  let current = normalizeLibraryPreferences();
  try { current = normalizeLibraryPreferences(JSON.parse(storage()?.getItem(KEY) || 'null')); } catch {}
  return {
    read: () => ({ ...current }),
    update(patch) {
      current = normalizeLibraryPreferences({ ...current, ...patch });
      try { storage()?.setItem(KEY, JSON.stringify(current)); } catch {}
      return { ...current };
    },
  };
}
