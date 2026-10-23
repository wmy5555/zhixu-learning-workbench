// A successful save only consumes the input that was actually submitted.
// Pending originals and edits made while the request was queued stay on device.
export function afterTextSave(submitted, current) {
  const changed = submitted.title !== current.title || submitted.body !== current.body ||
    JSON.stringify(submitted.metadata) !== JSON.stringify(current.metadata);
  return { changed, draft: changed ? current : { ...current, title: '', body: '' } };
}
