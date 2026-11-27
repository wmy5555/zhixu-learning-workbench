// One intention includes its library and all four identifiers persisted by startStudy.
export function createStudyStarter(getContext, send) {
  const unconfirmed = new Map();
  const pending = new Map();
  let failureNumber = 0;
  return function start(input, perform = submit => submit()) {
    const { practiceId, version } = getContext();
    const { noteId, planId, topicId, mistakeId } = input;
    const key = JSON.stringify([practiceId || '', version, noteId, planId || null, topicId || null, mistakeId || null]);
    if (pending.has(key)) return pending.get(key);
    const knownFailures = failureNumber;
    const requestId = unconfirmed.get(key)?.requestId || crypto.randomUUID();

    async function submit() {
      let session;
      try { session = await send({ ...input, requestId }); }
      catch (error) {
        unconfirmed.set(key, { requestId, failureNumber: ++failureNumber });
        throw error;
      }
      // A new start can retire receipts already lost when the user chose it.
      // Concurrent writes whose receipts were lost later must still be retriable.
      for (const [oldKey, failure] of unconfirmed) {
        if (failure.failureNumber <= knownFailures) unconfirmed.delete(oldKey);
      }
      return session;
    }

    const request = perform(submit).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
