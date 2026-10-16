// Synthetic only. Run: node scripts/search-benchmark.mjs [1000,10000] [output.json]
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createService } from '../src/service.mjs';
import { spawnSync } from 'node:child_process';

const base = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(base, { recursive: true });
const sizes = (process.argv[2] || '1000,10000').split(',').map(Number);
if (sizes.some(n => !Number.isInteger(n) || n < 10 || n > 100000)) throw new Error('Invalid synthetic size');
const queries = ['熵', '检索', '拉格朗日中值定理', 'RX7900-XTX', '长文尾部朱雀', '不存在词zvqx'];
const report = { runtime: process.version, measuredAt: new Date().toISOString(), synthetic: true, samples: [] };
for (const size of sizes) {
  const root = fs.mkdtempSync(path.join(base, 'search-bench-')), vaultDir = path.join(root, 'vault'), dataDir = path.join(root, 'data');
  fs.mkdirSync(vaultDir);
  for (let i = 0; i < size; i++) {
    const special = i === 0 ? '\n熵与检索。拉格朗日中值定理。型号 RX7900-XTX。' : '';
    const body = i === 1 ? '长文段落，只用于本地合成容量验证。\n'.repeat(22000) + '\n长文尾部朱雀命中位置。' : `普通材料 ${i}，编号 sample${i}。` + special;
    fs.writeFileSync(path.join(vaultDir, `${i}.md`), `---\nid: sample_${i}\nkind: knowledge\ntitle: 合成材料 ${i}\nstage: candidate\nupdatedAt: '2026-10-01T00:00:00.000Z'\n---\n${body}`);
  }
  let service;
  try {
    const startup = performance.now();
    service = createService({ dataDir, vaultDir });
    const startupMs = performance.now() - startup;
    const runs = [];
    for (let round = 0; round < (process.argv[4] === 'cold-only' ? 0 : 4); round++) for (const query of queries) {
      const start = performance.now(), result = await service.search(query, { mode: 'keyword', limit: 12 });
      const elapsedMs = performance.now() - start;
      const expected = query === '长文尾部朱雀' ? 'sample_1' : query === '不存在词zvqx' ? null : 'sample_0';
      runs.push({ query, cache: round === 0 ? 'first-query' : 'warm', elapsedMs, reportedMs: result.diagnostics.elapsedMs,
        recall: expected ? result.results.some(n => n.id === expected) : result.results.length === 0,
        context: expected ? result.results.find(n => n.id === expected)?.snippet.includes(query) : true,
        diagnostics: result.diagnostics });
    }
    const pagingStarted = performance.now(), seen = new Set(); let cursor, pageCount = 0, duplicate = false, pagingSupported = false;
    if (process.argv[4] !== 'cold-only') do {
      const page = await service.search('普通材料',{limit:50,cursor});
      pagingSupported = Number.isInteger(page.total);
      for (const n of page.results) { if (seen.has(n.id)) duplicate=true; seen.add(n.id); }
      pageCount++;cursor=page.nextCursor;
    } while (cursor);
    // Every title contains 材料, including the long-body note: the retained
    // character-overlap rule therefore matches all size documents.
    const paging = { supported:pagingSupported, pageCount,count:seen.size,expected:size,duplicate,passed:pagingSupported && seen.size===size && !duplicate,elapsedMs:performance.now()-pagingStarted };
    if (pagingSupported && !paging.passed) process.exitCode=1;
    await service.close(); service=null;
    const child = spawnSync(process.execPath,['--input-type=module','-e',
      "import {createService} from './src/service.mjs'; import {performance} from 'node:perf_hooks'; const started=performance.now(),s=createService(JSON.parse(process.argv[1])),ready=performance.now(),r=await s.search('长文尾部朱雀');console.log(JSON.stringify({startupMs:ready-started,queryMs:performance.now()-ready,totalMs:performance.now()-started,recall:r.results.some(n=>n.id==='sample_1'),context:r.results.some(n=>n.snippet.includes('长文尾部朱雀'))}));await s.close();",
      JSON.stringify({dataDir,vaultDir})],{cwd:projectDir(),encoding:'utf8',windowsHide:true});
    if(child.status!==0)throw new Error(child.stderr);
    const coldProcess=JSON.parse(child.stdout);
    report.samples.push({ size, longBodyChars: '长文段落，只用于本地合成容量验证。\n'.length*22000+12, startupMs, coldProcess, paging, runs });
    console.log(JSON.stringify({ size, startupMs, coldProcess, paging, medianWarmMs: median(runs.filter(r => r.cache === 'warm').map(r => r.elapsedMs)), recall: runs.every(r => r.recall), contexts: runs.every(r => r.context) }));
  } finally {
    await service?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function median(values) { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.floor(sorted.length / 2)]; }
function projectDir(){return path.resolve(import.meta.dirname,'..');}
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
