import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.argv[2]||'playwright');
const meta=JSON.parse(fs.readFileSync('.tmp/parity-preview.json','utf8'));assert.equal(meta.synthetic,true);
const out=path.resolve('.tmp/parity-evidence'),browser=await chromium.launch({executablePath:process.argv[3],headless:true});
const context=await browser.newContext({viewport:{width:1365,height:900},reducedMotion:'reduce'}),page=await context.newPage(),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
await context.route('**/*',r=>r.request().url().startsWith(meta.candidate)?r.continue():r.abort());
const api=(route,method='get',body)=>page.evaluate(async({route,method,body})=>{const {api}=await import('/web/api.mjs');return api[method](route,body);},{route,method,body});
async function open(route){await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));await page.goto(meta.candidate+'/#'+route);await page.waitForFunction(r=>document.querySelector('#main')?.dataset.route===r,route);}
const waitToast=()=>page.locator('#toast:not([hidden])').waitFor();
const check=name=>{checks.push(name);console.log('PASS '+name);fs.writeFileSync(path.join(out,'workflow-progress.json'),JSON.stringify({checks,errors,at:new Date().toISOString()},null,2));};
async function action(a){await page.locator(`[data-action="${a}"]`).first().click();}
async function readerAction(id,a){await open(`read/${id}`);await action('reader-actions');await action(a);}
async function saveDialog(){await page.locator('dialog[open] form button[type="submit"]').last().click();await page.locator('dialog[open]').waitFor({state:'hidden'});}
try{
  if(!process.argv.includes('--tail')){
  if(!process.argv.includes('--remaining')){
  await open('relations');
  await page.locator('[data-action="relation-action"][data-value="accept"]').first().click();
  await page.locator('[data-action="relation-action"][data-value="remove"]').first().waitFor();
  let relations=await api('/api/relations');assert.ok(relations.relations.some(r=>r.state==='accepted'));
  await page.screenshot({path:path.join(out,'relations-accepted.png'),fullPage:true});
  await page.locator('[data-action="relation-action"][data-value="remove"]').first().click();
  await page.locator('[data-action="relation-action"][data-value="remove"]').waitFor({state:'hidden'});
  check('relation accepted and removed with stored type/use/boundary');
  await open('topics');await page.locator(`[data-action="open-topic"][data-id="${meta.fixture.topicId}"]`).click();
  await action('topic-edit');
  await page.locator('[data-action="member-down"][data-index="0"]').click();
  await page.locator('dialog [name="prerequisites"]').fill(meta.fixture.knowledgeIds[3]);
  await saveDialog();
  let topic=(await api('/api/topics')).topics.find(t=>t.id===meta.fixture.topicId);
  assert.equal(topic.noteIds[0],meta.fixture.knowledgeIds[1]);assert.deepEqual(topic.prerequisites,[meta.fixture.knowledgeIds[3]]);
  await page.locator(`[data-action="open-topic"][data-id="${meta.fixture.topicId}"]`).click();await action('topic-toggle');
  await page.locator('[data-action="topic-toggle"][data-value="resume"]').waitFor();
  await action('topic-toggle');await page.locator('[data-action="topic-toggle"][data-value="pause"]').waitFor();
  await action('topic-copy');await page.locator('dialog [name="title"]').fill('合成拆分包');
  await page.locator('[data-action="member-remove"]').last().click();await saveDialog();
  const topics=(await api('/api/topics')).topics;assert.equal(topics.find(t=>t.title==='合成拆分包').noteIds.length,2);assert.equal(topics.find(t=>t.id===meta.fixture.topicId).noteIds.length,3);
  check('topic member order, prerequisites, split copy, pause and resume persist');
  await readerAction(meta.fixture.sourceId,'metadata');
  await page.locator('dialog [name="locator"]').fill('第 9 章 · 合成定位');
  await page.locator('dialog [name="researchIntervalDays"]').fill('60');
  await page.locator('dialog summary').filter({hasText:'逐条编辑'}).click();
  await page.locator('dialog [name="origin.0.author"]').fill('合成出处修订');
  await saveDialog();
  let source=await api('/api/notes/'+meta.fixture.sourceId);
  assert.equal(source.meta.locator,'第 9 章 · 合成定位');assert.equal(source.meta.origins[0].author,'合成出处修订');
  await readerAction(meta.fixture.sourceId,'versions');
  await page.locator('dialog summary').first().click();
  assert.match(await page.locator('dialog').innerText(),/完整|出处/);
  await page.screenshot({path:path.join(out,'versions-full-body.png'),fullPage:true});
  await page.locator('[data-modal-close]').click();
  check('metadata and individual provenance edits save; full historical bodies visible');
  await readerAction(meta.fixture.knowledgeIds[2],'merge');
  await page.locator('dialog [name="mergeId"]').selectOption(meta.fixture.knowledgeIds[3]);
  await page.locator('dialog form [type="submit"]').click();await action('confirm-merge');
  await page.locator('[data-confirm]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  const retired=await api('/api/notes/'+meta.fixture.knowledgeIds[3]);assert.equal(retired.meta.supersededBy,meta.fixture.knowledgeIds[2]);
  check('two-step knowledge merge preserves the other note as superseded');
  }else{
    await open('library');
    let retired=await api('/api/notes/'+meta.fixture.knowledgeIds[3]);
    if(!retired.meta.supersededBy){
      const keep=await api('/api/notes/'+meta.fixture.knowledgeIds[2]);
      assert.ok(!keep.body.includes('合并保留的观点'),'partial merge must be inspected, not repeated');
      await readerAction(meta.fixture.knowledgeIds[2],'merge');
      await page.locator('dialog [name="mergeId"]').selectOption(meta.fixture.knowledgeIds[3]);
      await page.locator('dialog form [type="submit"]').click();await action('confirm-merge');
      await page.locator('[data-confirm]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
      retired=await api('/api/notes/'+meta.fixture.knowledgeIds[3]);
    }
    assert.equal(retired.meta.supersededBy,meta.fixture.knowledgeIds[2]);
    check('prior merge completion verified before continuing after interrupted test');
  }
  await readerAction(meta.fixture.knowledgeIds[2],'links');
  assert.match(await page.locator('dialog').innerText(),/expectedHash|当前/);await page.locator('[data-modal-close]').click();
  await open('settings');await action('deleted-notes');await action('deleted-history');
  await action('version-restore');await page.locator('[data-confirm]').click();
  await page.locator('dialog[aria-label="核对已移除知识的版本"]').waitFor({state:'hidden'});
  assert.equal((await api('/api/notes/synthetic-deleted')).body,'这份合成资料用于测试历史恢复。');
  for(const dialog of await page.locator('dialog').all())await dialog.locator('[data-modal-close]').click();
  check('Obsidian preview available; deleted knowledge restores through version history');
  await open('capture');
  await page.locator('#text-file').setInputFiles([{name:'批量甲.txt',mimeType:'text/plain',buffer:Buffer.from('合成批量导入甲')},{name:'批量乙.md',mimeType:'text/markdown',buffer:Buffer.from('# 合成批量导入乙')}]);
  await page.locator('[data-run]').click();await page.getByText('已保存 2 / 2 份。',{exact:false}).waitFor();
  await page.locator('[data-modal-close]').click();
  const notes=(await api('/api/notes')).notes;assert.ok(notes.some(n=>n.title==='批量甲'));assert.ok(notes.some(n=>n.title==='批量乙'));
  check('batch TXT/Markdown imports persist together without triggering AI');
  }
  await open('library');await page.getByText('更多类别、学习状态与原文分组',{exact:true}).click();
  await page.locator('[name="sourceGroups"]').check();assert.ok(await page.locator('.parity-source-group').count());
  await page.locator('[name="libraryKind"]').selectOption('report');assert.match(await page.locator('#parity-library').innerText(),/合成 AI 整理报告/);
  check('source grouping, child navigation and report filter are usable');
  await open('search');await page.getByText('检索方式与筛选范围',{exact:true}).click();
  assert.equal(await page.locator('[name="mode"] option[value="semantic"]').evaluate(option=>option.disabled),true);
  await page.locator('[name="cloud"]').check();await page.locator('[name="mode"]').selectOption('semantic');
  await page.locator('[name="cloud"]').uncheck();assert.equal(await page.locator('[name="mode"]').inputValue(),'keyword');
  await page.locator('[name="q"]').fill('记录观点');
  await page.locator('#parity-search [type="submit"]').click();await page.getByText('本次检索诊断',{exact:true}).waitFor();
  check('search filters and semantic consent dependency preserve local mode');
  await open('output');await page.locator('#output-form [name="question"]').fill('记录观点与出处');
  await page.locator('#output-form [type="submit"]').click();await page.locator('#output-result .output-document').waitFor();
  await page.locator('#output-result [data-action="open-draft"]').click();
  await page.getByRole('dialog',{name:'继续打磨这份表达'}).waitFor();
  const used=page.locator('dialog [name="usedId"]');assert.ok(await used.count());await used.first().check();
  const selected=await used.first().inputValue();await saveDialog();
  const draft=(await api('/api/drafts')).drafts.find(d=>d.question==='记录观点与出处');assert.deepEqual(draft.usedIds,[selected]);
  await page.locator(`[data-action="open-draft"][data-id="${draft.id}"]`).click();await action('capture-draft');await page.locator('[data-confirm]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  check('local output citations, actual-used selection and capture-back save through real APIs');
  await open('manage');
  await page.locator('#mcp-form [name="enabled"]').check();await page.locator('#mcp-form [name="allowProposals"]').check();await page.locator('#mcp-form [name="enabled"]').uncheck();
  assert.equal(await page.locator('#mcp-form [name="allowProposals"]').isChecked(),false);assert.equal(await page.locator('#mcp-form [name="allowProposals"]').isDisabled(),true);
  await page.locator('#mcp-form [type="submit"]').click();await waitToast();
  await page.locator('#advanced-rhythm [name="timezone"]').fill('invalid/timezone');
  await page.locator('#advanced-rhythm [type="submit"]').click();await page.locator('#toast.error').waitFor();
  assert.equal(await page.locator('#advanced-rhythm [name="timezone"]').inputValue(),'invalid/timezone');
  await page.locator('#advanced-rhythm [name="timezone"]').fill('UTC');await page.locator('#advanced-rhythm [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('.page-loading')&&document.querySelector('[name="timezone"]')?.value==='UTC');
  await open('manage/prompts');await page.locator('#main details').first().locator('summary').click();
  const prompt=page.locator('#main [data-prompt]').first();const original=await prompt.locator('textarea').inputValue();
  await prompt.locator('textarea').fill(original+'\n合成提示词附注。');await prompt.locator('[type="submit"]').click();await waitToast();
  await page.reload();await page.waitForFunction(()=>!document.querySelector('.page-loading'));await page.locator('#main details').first().locator('summary').click();
  assert.ok((await page.locator('#main [data-prompt]').first().locator('textarea').inputValue()).endsWith('合成提示词附注。'));
  check('management dependencies, failed save retention and prompt customization persist');
  await open('manage/restore');const backup=await api('/api/backup');
  await page.locator('#restore-form input').setInputFiles({name:'synthetic-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.locator('#restore-form [type="submit"]').click();await action('restore-confirm');
  await page.locator('[data-confirm]').click();await page.getByText('恢复完成。外部能力保持关闭。',{exact:true}).waitFor();
  const settings=await api('/api/settings');assert.equal(settings.ai.enabled,false);assert.equal(settings.mcp.enabled,false);
  check('full backup file preview and token-bound confirmed recovery complete in synthetic library');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'workflow-results.json'),JSON.stringify({checks,errors,syntheticRoot:meta.root,at:new Date().toISOString()},null,2));
}catch(error){
  await page.screenshot({path:path.join(out,'workflow-failure.png'),fullPage:true});
  console.error(JSON.stringify(await page.evaluate(()=>({hash:location.hash,route:document.querySelector('#main')?.dataset.route,dialogs:[...document.querySelectorAll('dialog')].map(d=>d.innerText),toast:document.querySelector('#toast')?.innerText,busy:document.querySelectorAll('[aria-busy="true"]').length}))));
  throw error;
}finally{await browser.close();}
