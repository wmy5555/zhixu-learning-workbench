import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';

test('HTTP usage passes purpose through to accounting filters without filtering the shared budget', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zhixu-purpose-http-'));
  const app = createApp({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const session = await fetch(`${base}/api/session`);
  const headers = { Cookie: session.headers.get('set-cookie').split(';', 1)[0] };
  await session.json();
  for (const [id, purpose] of [['synthetic-structure', 'structure'], ['synthetic-process', 'process'], ['synthetic-history', undefined]]) {
    app.service.store.put('calls', id, { id, purpose, capability: 'model', model: 'synthetic', cost: .25, createdAt: new Date().toISOString(), ok: true });
  }
  const query = async purpose => {
    const response = await fetch(`${base}/api/usage?${new URLSearchParams({ purpose, capability: 'model', model: 'synthetic', period: 'month' })}`, { headers });
    return { status: response.status, body: await response.json() };
  };
  for (const purpose of ['structure', 'process', 'unrecorded']) {
    const { status, body } = await query(purpose);
    assert.equal(status, 200);
    assert.equal(body.filters.purpose, purpose);
    assert.equal(body.totals.calls, 1);
    assert.equal(body.totals.knownCost, .25);
    assert.equal(body.recentCalls[0].purpose, purpose);
    assert.equal(body.budget.callsToday, 3);
  }
  const invalid = await query('invented');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'INVALID_USAGE_FILTER');
});
