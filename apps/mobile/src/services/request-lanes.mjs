// Only synchronous local state operations may bypass a pending outbound scope.
// Adding an AI/settings/restore operation here breaks the native scope guarantee.
export function isImmediateLocalRequest(
  path,
  { method = "GET", body = {} } = {},
) {
  if (typeof path !== "string") return false;
  if (/^\/api\/draft-work(?:\?|$)/.test(path))
    return ["GET", "PUT", "DELETE"].includes(method);
  if (/^\/api\/jobs(?:\?|$)/.test(path)) return method === "GET";
  return (
    /^\/api\/jobs\/[a-zA-Z0-9_-]+\/action$/.test(path) &&
    method === "POST" &&
    body.action === "cancel"
  );
}

export function createRequestLane() {
  let tail = Promise.resolve();
  return {
    run(task, immediate = false) {
      if (immediate) return Promise.resolve().then(task);
      const next = tail.then(task);
      tail = next.catch(() => {});
      return next;
    },
    drain: () => tail,
  };
}
