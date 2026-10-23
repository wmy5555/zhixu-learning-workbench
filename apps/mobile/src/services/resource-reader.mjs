// One screen keeps only its current result. Hidden revisions are not fetched;
// a later visible update reads the latest signature through the normal gateway.
/** @param {(path: string) => Promise<any>} read */
export function createResourceReader(read) {
  /** @type {{key: string, signature: string, data: any, error: string}} */
  let result = { key: "", signature: "", data: undefined, error: "" };
  let generation = 0;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const publish = (next) => {
    result = next;
    listeners.forEach((listener) => listener());
  };
  return {
    snapshot: () => result,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    cancel: () => { generation++; },
    update({ key, path, signature, enabled }) {
      const request = ++generation;
      if (!enabled) return Promise.resolve();
      // A warm return with unchanged input already has the current result.
      // Visibility alone must not add another complete Vault scan.
      if (result.key === key && result.signature === signature && !result.error)
        return Promise.resolve();
      return Promise.resolve()
        .then(() => request === generation ? read(path) : undefined)
        .then((data) => {
          if (request === generation) publish({ key, signature, data, error: "" });
        }, (error) => {
          if (request === generation) publish({
            key, signature,
            data: result.key === key ? result.data : undefined,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
  };
}
