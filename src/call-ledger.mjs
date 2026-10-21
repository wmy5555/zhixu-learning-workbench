import { randomUUID } from 'node:crypto';
import { tokenCount } from './token-usage.mjs';
import { knownPurpose } from './call-purpose.mjs';

const unresolved = new Set(['reserved', 'dispatch', 'received', 'unknown']);
const costValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 409 }); };

// Private local records only. No request body, URL, headers or credentials are stored.
// All transitions commit synchronously before returning to the external adapter.
export function createCallLedger({ store, getStore = () => store, at = () => new Date() } = {}) {
  const active = new Set();
  function transaction(fn) {
    const current = getStore();
    current.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(current); current.db.exec('COMMIT'); return value; }
    catch (error) { current.db.exec('ROLLBACK'); throw error; }
  }
  const timestamp = () => at().toISOString();
  const read = (current, id) => {
    const row = current.get('callLedger', id);
    if (!row) fail('CALL_NOT_FOUND', '调用记录不存在。');
    return row;
  };
  function pending(current) { return current.records('callLedger').filter(row => unresolved.has(row.phase) || row.phase === 'resolved_unknown' && costValue(row.confirmation?.cost) === null); }
  function listPending() {
    return pending(getStore()).map(({ id, phase, capability, model, createdAt, updatedAt, jobId, turnId, error }) =>
      ({ id, phase, capability, model, createdAt, updatedAt, jobId, turnId, error, active: active.has(id), hasResult: phase === 'received' }));
  }
  function reserve({ capability, model = null, sourceId, key, contextKey, singleRequest = false, jobId, turnId, purpose, reservedCost = null }, config) {
    const metadata = knownPurpose(purpose) ? { purpose } : {};
    const row = transaction(current => {
      if (pending(current).some(item => !active.has(item.id))) fail('CALL_RECOVERY_REQUIRED', '有结果未知或记账未完成的调用。请先在用量与费用中处理，系统不会自动重发。');
      if (contextKey && current.records('callLedger').some(item => item.contextKey === contextKey && item.phase === 'resolved_unknown')) fail('CALL_RECOVERY_REQUIRED', '原操作没有可恢复的响应。人工核对费用不会授权该操作重新发送。');
      if (singleRequest && contextKey && current.records('callLedger').some(item => item.contextKey === contextKey && item.phase !== 'cancelled')) fail('CALL_RECOVERY_REQUIRED', '此轮操作已有调用，请恢复已有结果；修改输入或模型配置不会重新发送。');
      if (key && current.records('callLedger').some(item => item.key === key && item.phase !== 'cancelled')) fail('CALL_RECOVERY_REQUIRED', '同一操作已有调用记录，请恢复已有结果，不能重新发送。');
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone || 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' });
      const dayOf = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? formatter.format(date) : null; };
      const now = timestamp(), today = dayOf(now), calls = current.records('calls');
      if (calls.some(call => !dayOf(call.createdAt))) fail('BUDGET_UNKNOWN', '调用记录日期无效，无法核对预算。');
      const todayCalls = calls.filter(call => dayOf(call.createdAt) === today);
      const monthly = calls.filter(call => dayOf(call.createdAt).startsWith(today.slice(0, 7)));
      const dailyLimit = costValue(config.ai?.dailyCallLimit), monthlyBudget = costValue(config.ai?.monthlyBudget);
      if (dailyLimit !== null && todayCalls.length >= dailyLimit) fail('BUDGET_EXCEEDED', '今日外部调用次数已达到上限。');
      if (monthlyBudget > 0) {
        if (monthly.some(call => costValue(call.cost) === null)) fail('BUDGET_UNKNOWN', '本月仍有未知费用，无法在预算保护下继续调用。');
        const known = monthly.reduce((total, call) => total + call.cost, 0);
        if (known >= monthlyBudget || costValue(reservedCost) !== null && known + reservedCost > monthlyBudget) fail('BUDGET_EXCEEDED', '本月外部服务预算已用尽或剩余额度不足。');
      }
      const row = { id: randomUUID(), phase: 'reserved', capability, model, sourceId, key, contextKey, jobId, turnId, ...metadata, ...(singleRequest ? { singleRequest: true } : {}), reservedCost: costValue(reservedCost), createdAt: now, updatedAt: now };
      current.put('callLedger', row.id, row);
      current.put('calls', row.id, { id: row.id, capability, model, sourceId, ...metadata, createdAt: now, phase: 'reserved', ok: null, cost: costValue(reservedCost) });
      return row;
    });
    active.add(row.id);
    return row;
  }
  function dispatch(id) {
    return transaction(current => {
      const row = read(current, id);
      if (row.phase !== 'reserved') fail('CALL_STATE', '该调用不能再次发送。');
      if (pending(current).some(item => item.id !== id && (item.phase === 'unknown' || !active.has(item.id)))) fail('CALL_RECOVERY_REQUIRED', '另一调用结果未知或记账未完成，请先处理。');
      current.put('calls', id, { ...current.get('calls', id), phase: 'dispatch' });
      return current.put('callLedger', id, { ...row, phase: 'dispatch', updatedAt: timestamp() });
    });
  }
  function received(id, response, entry) {
    return transaction(current => {
      const row = read(current, id);
      if (row.phase !== 'dispatch') fail('CALL_STATE', '该调用不能保存新的响应。');
      current.put('callResults', id, { id, response, entry, receivedAt: timestamp() });
      current.put('calls', id, { ...current.get('calls', id), phase: 'received' });
      return current.put('callLedger', id, { ...row, phase: 'received', updatedAt: timestamp() });
    });
  }
  function account(current, row, entry, phase) {
    current.put('calls', row.id, { ...entry, id: row.id, capability: row.capability, model: row.model, sourceId: row.sourceId, ...(knownPurpose(row.purpose) ? { purpose: row.purpose } : {}),
      inputTokens: tokenCount(entry.inputTokens), outputTokens: tokenCount(entry.outputTokens), cost: costValue(entry.cost), createdAt: row.createdAt, phase });
    return current.put('callLedger', row.id, { ...row, phase, updatedAt: timestamp() });
  }
  function recover(id) {
    if (active.has(id)) fail('CALL_ACTIVE', '调用仍在执行，请等待完成后处理。');
    return transaction(current => {
      const row = read(current, id);
      if (row.phase === 'accounted' || row.phase === 'cancelled') return row;
      if (row.phase === 'reserved') {
        current.remove('calls', id);
        return current.put('callLedger', id, { ...row, phase: 'cancelled', updatedAt: timestamp() });
      }
      if (row.phase !== 'received') fail('CALL_RESULT_UNKNOWN', '尚未取得完整响应，请先核对供应商账单，再明确确认费用；系统不会重新发送。');
      const result = current.get('callResults', id);
      if (!result) fail('CALL_RESULT_MISSING', '已收响应缺失，不能当作免费或重新发送。');
      return account(current, row, result.entry, 'accounted');
    });
  }
  function accounted(id) {
    return transaction(current => {
      const row = read(current, id), result = current.get('callResults', id);
      if (row.phase !== 'received' || !result) fail('CALL_STATE', '请先保存完整响应再记账。');
      return account(current, row, result.entry, 'accounted');
    });
  }
  function unknown(id, entry) {
    return transaction(current => {
      const row = read(current, id);
      if (row.phase !== 'dispatch') fail('CALL_STATE', '调用状态不允许标记未知结果。');
      account(current, row, { ...entry, cost: row.capability === 'fetch' ? 0 : null, ok: false }, 'unknown');
      return current.put('callLedger', id, { ...row, phase: 'unknown', error: entry.error, updatedAt: timestamp() });
    });
  }
  function cancel(id) {
    return transaction(current => {
      const row = read(current, id);
      if (row.phase !== 'reserved') fail('CALL_STATE', '请求可能已经发送，不能释放预留。');
      current.remove('calls', id);
      return current.put('callLedger', id, { ...row, phase: 'cancelled', updatedAt: timestamp() });
    });
  }
  function confirm(id, { cost, reason } = {}) {
    if (active.has(id)) fail('CALL_ACTIVE', '调用仍在执行，请等待完成后处理。');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000 || cost !== null && costValue(cost) === null) fail('INVALID_INPUT', '请明确填写已核对金额（未知为 null）与原因。');
    return transaction(current => {
      const row = read(current, id);
      if (!['dispatch', 'unknown', 'resolved_unknown'].includes(row.phase)) fail('CALL_STATE', '只有未取得响应的调用可以人工核对费用。');
      const saved = account(current, row, { ...current.get('calls', id), cost, ok: false }, 'resolved_unknown');
      return current.put('callLedger', id, { ...saved, confirmation: { cost, reason: reason.trim(), at: timestamp() } });
    });
  }
  function getResult(id) {
    read(getStore(), id);
    return getStore().get('callResults', id);
  }
  function evidence(jobId) {
    const current = getStore();
    // The adapter may be shared by an isolated practice library. Its owner
    // remains authoritative; callers need no response bodies or billing data.
    return current.records('callLedger').filter(row => row.jobId === jobId).map(({ id, phase, capability, turnId }) =>
      ({ id, phase, capability, turnId, ok: current.get('callResults', id)?.entry?.ok === true }));
  }
  function replay(key, { contextKey, singleRequest = false } = {}) {
    // A grading round has one external request. Its existing response wins even
    // when a retry's prompt/provider fingerprint changed after receipt.
    const matches = getStore().records('callLedger').filter(item => item.phase !== 'cancelled' &&
      (singleRequest && contextKey ? item.contextKey === contextKey : item.key === key));
    // A forked backup may contain a different attempt ID for the same operation.
    // Neither insertion order nor an accounted sibling resolves local uncertainty.
    if (matches.some(item => item.phase !== 'accounted')) fail('CALL_RECOVERY_REQUIRED', '该操作已有调用，需先恢复记账或核对未知结果；不会自动重发。');
    if (matches.length > 1) fail('CALL_RECOVERY_REQUIRED', '此操作有多个调用记录，无法确认应采用哪个响应。请核对已有结果，不能自动选择或再次发送。');
    const row = matches[0];
    if (!row) return null;
    const result = getResult(row.id);
    if (!result) fail('CALL_RESULT_MISSING', '已有调用的响应缺失，不能重新发送。');
    return { ...result, callId: row.id };
  }
  return { reserve, dispatch, received, accounted, unknown, cancel, finish: id => active.delete(id), listPending, recover, confirm, getResult, evidence, replay };
}
