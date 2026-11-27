// A receipt authorizes only the backup the user previewed in this mounted picker.
export function createRestoreSelection(api, picker) {
  const { practiceId, version } = api.getContext();
  let active = null;
  function sameSpace() {
    const scope = api.getContext();
    return scope.practiceId === practiceId && scope.version === version;
  }
  function begin() {
    const file = picker.files[0];
    active = null;
    if (!file || !picker.isConnected || !sameSpace()) return null;
    const current = () => active === entry && picker.files[0] === file && picker.isConnected && sameSpace();
    const entry = {
      file, current,
      confirmation(backup, token) {
        if (!token || !current()) return null;
        const request = { backup, preview: false, token };
        return () => current() ? request : null;
      },
    };
    active = entry;
    return entry;
  }
  return { begin, sameSpace, clear() { active = null; } };
}
