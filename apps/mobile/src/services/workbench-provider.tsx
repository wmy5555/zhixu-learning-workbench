import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, Platform } from "react-native";
import { useIsFocused } from "expo-router";
import { createGateway } from "./gateway.mjs";
import runtime from "../platform/runtime.native.js";
import { setAppearance } from "./appearance";
import { changeScope } from "./scope-switch.mjs";
import { createResourceReader } from "./resource-reader.mjs";
type Api = {
  get: (path: string) => Promise<any>;
  post: (path: string, body?: any) => Promise<any>;
  put: (path: string, body: any) => Promise<any>;
  remove: (path: string, body?: any) => Promise<any>;
};
type Snapshot = {
  revision: number;
  practiceId: string;
  working: boolean;
  startupError: string;
  ready: boolean;
};
class WorkbenchClient {
  private gateway: any;
  private initialization?: Promise<void>;
  private pending = 0;
  private pumping = false;
  private active = true;
  private listeners = new Set<() => void>();
  private drafts = new Set<() => Promise<any>>();
  private state: Snapshot = {
    revision: 0,
    practiceId: "",
    working: false,
    startupError: "",
    ready: false,
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;
  private emit(change: Partial<Snapshot>) {
    if (Object.entries(change).every(([key, value]) =>
      Object.is(this.state[key as keyof Snapshot], value))) return;
    this.state = { ...this.state, ...change };
    this.listeners.forEach((fn) => fn());
  }
  api: Api = {
    get: (path) => this.request(path, "GET"),
    post: (path, body) => this.request(path, "POST", body),
    put: (path, body) => this.request(path, "PUT", body),
    remove: (path, body) => this.request(path, "DELETE", body),
  };
  start() {
    if (this.initialization) return this.initialization;
    this.initialization = Promise.resolve()
      .then(async () => {
        this.gateway = createGateway({ root: runtime.root });
        setAppearance(
          await this.gateway.request("/api/draft-work?id=appearance"),
        );
        this.emit({ ready: true });
        // One app lifetime subscription; not one timer/listener per screen or render.
        AppState.addEventListener("change", (value) => {
          this.active = value === "active";
          if (this.active) {
            this.gateway.resume();
            void this.pump();
          } else {
            void this.gateway.pause().catch((e: Error) => this.emit({ startupError: e.message }));
            void this.flushDrafts().catch((e) =>
              this.emit({ startupError: e.message }),
            );
          }
        });
      })
      .catch((e) => this.emit({ startupError: e.message }));
    return this.initialization;
  }
  registerDraft = (save: () => Promise<any>) => {
    this.drafts.add(save);
    return () => {
      this.drafts.delete(save);
    };
  };
  private flushDrafts = async () => {
    for (const save of this.drafts) await save();
  };
  setPracticeId = (id: string) =>
    changeScope(
      {
        current: () => this.state.practiceId,
        busy: () => this.pending > 0 || this.pumping,
        flush: this.flushDrafts,
        commit: (next: string) =>
          this.emit({ practiceId: next, revision: this.state.revision + 1 }),
      },
      id,
    );
  private async request(path: string, method: string, body: any = {}) {
    if (!this.gateway) throw Error("资料库尚未打开");
    const scope = this.state.practiceId;
    this.pending++;
    this.emit({ working: true });
    try {
      const value = await this.gateway.request(path, {
        method,
        body,
        practiceId: scope,
      });
      if (scope !== this.state.practiceId)
        throw Error("知识空间已经改变，请重新读取");
      if (method !== "GET" && !path.startsWith("/api/draft-work")) {
        this.emit({ revision: this.state.revision + 1 });
        setTimeout(() => void this.pump(), 0);
      }
      return value;
    } finally {
      this.pending--;
      this.emit({ working: this.pending > 0 || this.pumping });
    }
  }
  private async pump() {
    if (this.pumping || !this.active || !this.gateway) return;
    this.pumping = true;
    this.emit({ working: true });
    try {
      let continueOnly = false;
      while (this.active) {
        const result = await this.gateway.pump({ continueOnly });
        this.emit({ revision: this.state.revision + 1 });
        if (!result?.hasMore) break;
        continueOnly = true;
        // Give renders, cancellation and queued reads a turn between jobs.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (e) {
      this.emit({ startupError: (e as Error).message });
    } finally {
      this.pumping = false;
      this.emit({ working: this.pending > 0 });
    }
  }
}
// A single JS app lifetime owns the native store, including React development remounts.
const client = new WorkbenchClient();
type State = Snapshot & {
  api: Api;
  setPracticeId: (id: string) => Promise<void>;
};
const Context = createContext<State | null>(null);
export function WorkbenchProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.snapshot);
  useEffect(() => {
    void client.start();
  }, []);
  return (
    <Context.Provider
      value={{
        ...snapshot,
        api: client.api,
        setPracticeId: client.setPracticeId,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkbench() {
  const value = useContext(Context);
  if (!value) throw Error("WorkbenchProvider missing");
  return value;
}
export function useDraftFlush(save: () => Promise<any>) {
  useEffect(() => client.registerDraft(save), [save]);
}
function useStandardResource(path: string) {
  const { api, revision, practiceId, ready } = useWorkbench();
  const [nonce, setNonce] = useState(0);
  const key = practiceId + ":" + path,
    signature = key + ":" + revision + ":" + nonce;
  const [result, setResult] = useState<{
    key: string;
    signature: string;
    data: any;
    error: string;
  }>({ key: "", signature: "", data: undefined, error: "" });
  useEffect(() => {
    let current = true;
    if (ready) {
      api
        .get(path)
        .then((data) => {
          if (current) setResult({ key, signature, data, error: "" });
        })
        .catch((e) => {
          if (current)
            setResult((previous) => ({
              key,
              signature,
              data: previous.key === key ? previous.data : undefined,
              error: e.message,
            }));
        });
    }
    return () => {
      current = false;
    };
  }, [api, path, key, signature, ready]);
  return {
    data: result.key === key ? result.data : undefined,
    error: result.key === key ? result.error : "",
    loading: ready && result.signature !== signature,
    refresh: () => setNonce((n) => n + 1),
  };
}

function useAndroidResource(path: string) {
  const { api, revision, practiceId, ready } = useWorkbench();
  const focused = useIsFocused();
  const [nonce, setNonce] = useState(0);
  const [reader] = useState(() => createResourceReader(api.get));
  const key = practiceId + ":" + path,
    signature = key + ":" + revision + ":" + nonce;
  const result = useSyncExternalStore(reader.subscribe, reader.snapshot);
  useEffect(() => {
    void reader.update({ key, path, signature, enabled: ready && focused });
    return reader.cancel;
  }, [reader, key, path, signature, ready, focused]);
  return {
    data: result.key === key ? result.data : undefined,
    error: result.key === key ? result.error : "",
    loading: ready && focused && result.signature !== signature,
    refresh: () => setNonce((n) => n + 1),
  };
}

// The platform is fixed for an app lifetime; iOS retains its original read flow.
export const useResource = Platform.OS === "android" ? useAndroidResource : useStandardResource;
