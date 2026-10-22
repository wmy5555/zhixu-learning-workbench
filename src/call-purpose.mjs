// Business purposes come from explicit operation entry points, never prompt text.
export const callPurposes = Object.freeze({
  process: '资料拆解', structure: '单资料逻辑图', relate: '跨资料关联',
  discover: '跨资料发现', grade: '教学反馈', title: '标题生成',
  index: '检索索引', topics: '学习包建议', answer: '问答',
  outline: '提纲生成', draft: '草稿生成', retrieval: '资料检索',
  connection_test: '连接测试',
});
export const knownPurpose = value => typeof value === 'string' && Object.hasOwn(callPurposes, value) ? value : undefined;

// Read-only enrichment: old billing records and their costs are never rewritten.
export function callPurpose(call, { ledger, job, request } = {}) {
  const explicit = knownPurpose(call.purpose) || knownPurpose(ledger?.purpose);
  if (explicit) return explicit;
  if (ledger?.jobId && job?.id === ledger.jobId && ['process', 'structure', 'relate', 'discover', 'grade', 'title', 'index', 'topics'].includes(job.type)) return job.type;
  if (request?.id && ledger?.jobId === `ask:${request.id}` && ['answer', 'outline', 'draft'].includes(request.input?.mode)) return request.input.mode;
  return 'unrecorded';
}
