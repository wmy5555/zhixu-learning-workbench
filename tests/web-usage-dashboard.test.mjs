import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageReport } from '../src/usage.mjs';
import { usageAmount,usageCost,usageSummary,usageTrend,usageModels,usageTokens,usageRecent,usageCSV } from '../public/web/usage-dashboard.mjs';

const at=new Date('2026-10-24T03:00:00Z');
const entry=(overrides={})=>({createdAt:'2026-10-23T18:00:00Z',capability:'model',model:'示例模型',inputTokens:100,outputTokens:20,cachedInputTokens:40,cost:.002,ok:true,...overrides});
const report=calls=>buildUsageReport(calls,{at,timezone:'Asia/Shanghai'});

test('unknown and tiny costs remain distinct from free calls in summary and chart',()=>{
  assert.equal(usageAmount(.0000002),'< 0.000001');assert.equal(usageAmount(null),'未知');assert.equal(usageAmount(0),'0');
  const r=report([entry(),entry({cost:null,inputTokens:null,outputTokens:null})]);
  assert.equal(usageCost(r.totals),'0.002 + 未知');
  assert.match(usageSummary(r),/0.002 \+ 未知/);assert.match(usageSummary(r),/1 次用量不完整/);
  const chart=usageTrend(r,'knownCost');assert.match(chart,/is-partial/);assert.match(chart,/含未知记录/);assert.match(chart,/0.002 \+ 未知/);assert.doesNotMatch(chart,/NaN|Infinity/);
  assert.match(usageTrend(report([entry({cost:null})]),'knownCost'),/2026-10-24 · 未知/);
});

test('trend supports one day, zero values and empty ranges without invented activity',()=>{
  const r=buildUsageReport([entry({inputTokens:0,outputTokens:0,cost:0})],{at,timezone:'Asia/Shanghai',period:'today'});
  assert.match(usageTrend(r),/--usage-days:1/);assert.match(usageTrend(r),/height:0%/);
  assert.match(usageTrend(report([])),/还没有调用/);assert.doesNotMatch(usageTrend(report([])),/usage-bar-track/);
  assert.match(usageModels(report([])),/有调用后/);
});

test('cache is a subset of input and token totals are not rebuilt from display slices',()=>{
  const r=report([entry()]);const html=usageTokens(r);
  assert.match(html,/>120<\/strong>/);assert.match(html,/>40<\/dd>/);assert.match(html,/缓存命中已包含在输入中/);
  const calls=Array.from({length:105},()=>entry());const all=report(calls);
  assert.equal(all.recentCalls.length,100);assert.match(usageSummary(all),/>105<\/strong>/);assert.match(usageModels(all),/105 次/);
});

test('model distribution is sorted by chosen metric without changing report and escapes names',()=>{
  const r=report([entry({model:'<img onerror=x>',inputTokens:1000}),entry({model:'B'}),entry({model:'B'}),entry({capability:'fetch',model:'',cost:0})]);
  const before=JSON.stringify(r);const byCalls=usageModels(r),byTokens=usageModels(r,'totalTokens');
  assert.ok(byCalls.indexOf('>B</span>')<byCalls.indexOf('&lt;img'));assert.ok(byTokens.indexOf('&lt;img')<byTokens.indexOf('>B</span>'));
  assert.match(byCalls,/网页读取/);assert.doesNotMatch(byCalls,/<img/);assert.equal(JSON.stringify(r),before);
});

test('recent records use one table header, local timezone and bounded pagination',()=>{
  const r=report(Array.from({length:21},(_,i)=>entry({model:'模型'+i})));
  const first=usageRecent(r),last=usageRecent(r,999);
  assert.equal((first.match(/<thead>/g)||[]).length,1);assert.equal((first.match(/<time /g)||[]).length,10);
  assert.match(first,/10\/24 02:00/);assert.match(first,/1 \/ 3 · 共 21 条/);
  assert.equal((last.match(/<time /g)||[]).length,1);assert.match(last,/3 \/ 3/);
  assert.match(usageRecent(report([])),/没有调用明细/);
});

test('CSV retains raw cost precision and neutralizes spreadsheet formula cells',()=>{
  const r=report([entry({model:'=SUM(1,2)',cost:.0000002}),entry({model:'x"y',cost:null})]);
  const csv=usageCSV(r);assert.match(csv,/'=SUM/);assert.match(csv,/x""y/);assert.match(csv,/2e-7/);assert.match(csv,/未知/);
});
