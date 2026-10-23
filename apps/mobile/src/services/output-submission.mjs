// Snapshot the submitted input before saving yields to further typing. Both
// successful and failed old requests leave the newer form state untouched.
export async function submitOutput({ input, save, ask, currentRequestId, onResult, onError }) {
  const submitted = {
    question: input.question,
    mode: input.mode,
    scope: [...input.scope],
    privacy: input.privacy,
    requestId: input.requestId,
  };
  try {
    await save();
    const result = await ask(submitted);
    if (currentRequestId() === submitted.requestId) onResult(result);
  } catch (error) {
    if (currentRequestId() === submitted.requestId)
      onError(error instanceof Error ? error.message : String(error));
  }
}
