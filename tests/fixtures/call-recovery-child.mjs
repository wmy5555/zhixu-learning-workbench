import { Store } from '../../src/store.mjs';
import { createAI } from '../../src/ai.mjs';
import { createCallLedger } from '../../src/call-ledger.mjs';

const [directory, mode, endpoint] = process.argv.slice(2);
const store = new Store({ dataDir: `${directory}/data`, vaultDir: `${directory}/vault` });
const config = { timezone: 'Asia/Singapore', ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-model', dailyCallLimit: 10, monthlyBudget: 0, inputPrice: 1, outputPrice: 2 } };
const ledger = createCallLedger({ store });
setInterval(() => {}, 1000);
if (mode === 'reserved') {
  const call = ledger.reserve({ capability: 'model', model: 'synthetic-model' }, config);
  process.send({ phase: 'reserved', id: call.id });
} else {
  if (mode === 'received' || mode === 'accounting') {
    const put = store.put.bind(store);
    store.put = (namespace, key, data) => {
      if (namespace === 'calls' && data.phase === 'accounted') {
        if (mode === 'accounting') { put(namespace, key, data); process.kill(process.pid, 'SIGKILL'); }
        throw new Error('synthetic accounting write failure');
      }
      return put(namespace, key, data);
    };
  }
  const ai = createAI({ getSettings: () => config, getSecret: () => 'synthetic-test-only', getUsage: () => ({}), recordCall: () => {}, callLedger: ledger,
    fetchImpl: (_url, options) => fetch(endpoint, options) });
  try {
    const result = await ai.withCallContext({ key: 'child-task', jobId: 'synthetic-job' }, () => ai.generate({ prompt: 'Synthetic content', privacy: 'cloud' }));
    process.send({ phase: 'accounted', id: result.callId });
  } catch (error) {
    process.send({ phase: ledger.listPending()[0]?.phase, id: error.callId, code: error.code });
  }
}
