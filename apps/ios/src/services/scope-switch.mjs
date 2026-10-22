export async function changeScope({ current, busy, flush, commit }, next) {
  if (busy()) throw Error("请等待当前任务结束后切换知识库");
  const previous = current();
  await flush();
  if (busy() || current() !== previous)
    throw Error("知识空间或任务状态已变化，请重新切换");
  commit(next);
}
