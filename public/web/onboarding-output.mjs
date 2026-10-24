// Resolve the next manual output action without filling forms or granting AI permission.
export function outputGuide({root,route,proof,step,visible}){
 const pick=(scope,selector)=>[...(scope?.querySelectorAll(selector)||[])].find(visible)||null;
 const result=(phase,target,instruction)=>({phase,target,instruction});
 const dialog=[...root.querySelectorAll('dialog[open]')].at(-1),draftId=proof?.roles?.draft;
 if(route!=='output')return result('reading',null,'请先核对当前引用的正文与来源，再返回输出页继续；阅读时叶子暂时收起。');
 if(step.id==='output-draft'){
  if(dialog)return result('dialog',null,step.instruction);
  const form=root.querySelector('#output-form');
  if(!form)return result('missing',null,step.instruction);
  const submit=form.querySelector('button[type="submit"]');
  if(form.getAttribute('aria-busy')==='true')return result('waiting',submit,'正在生成本次草稿，请等待结果；无需重复提交。');
  if(['done','demonstrated'].includes(proof?.progress?.[step.id]?.status))return result('completed',[...root.querySelectorAll('[data-action="open-draft"]')].find(n=>n.dataset.id===draftId&&visible(n))||submit,'本次 AI 草稿已保存。点击“继续”，下一步会带你打开引用，核对知识与底层原文。');
  const question=pick(form,'[name="question"]');
  if(!question?.value.trim())return result('question',question,`先在“这一次，想完成什么？”写下输出目标。可参考：${step.sample?.question||'根据刚才学习的知识，写一段带出处的分享草稿。'} 写好后，再选择“写一份草稿”。`);
  const mode=pick(form,'[name="mode"][value="draft"]');
  if(!mode?.checked)return result('mode',mode?.closest('label'),'目标已填写。请在下方选择“写一份草稿”，这一项与“回答问题”“组织提纲”分别记录。');
  if(!form.querySelector('[name="scope"]:checked'))return result('scope',pick(form,'[name="scope"]')?.closest('label'),'请在“取材范围”至少选择知识或原始资料，让本次草稿有可追溯的依据。');
  const cloud=pick(form,'[name="cloud"]');
  if(!cloud?.checked)return result('permission',cloud?.closest('label'),'确认愿意后，亲自勾选“允许本次将所需资料发送给已配置的 AI 服务”。这次生成可能计费；仅本地整理不能完成本步。');
  return result('submit',submit,'目标、草稿模式与本次授权已准备好。点击“从我的资料开始”，等待 AI 草稿保存后再继续。');
 }
 const draft=dialog?.dataset.draftId===draftId?dialog:null;
 if(dialog&&!draft)return result('dialog',null,step.instruction);
 const output=draft?null:[...root.querySelectorAll('#output-result [data-output-draft]')].find(n=>n.dataset.outputDraft===draftId&&visible(n));
 const opener=()=>[...root.querySelectorAll('[data-action="open-draft"]')].find(n=>n.dataset.id===draftId&&visible(n));
 if(step.id==='output-citations'){
  const scope=draft||output;
  if(!scope)return result('open',opener(),'点击本次草稿的“继续编辑”，再打开“查看引用依据”。刷新后也会定位同一份草稿。');
  const disclosure=pick(scope,'details[data-output-citations]'),summary=pick(disclosure,'summary');
  if(!disclosure?.open)return result('disclose',summary,`点击“${draft?'查看引用依据':'引用、摘录与核验'}”展开引用。这里能看到知识摘录、阅读按钮和底层来源。`);
  return result('citation',pick(disclosure,'.evidence-entry .actions [data-route^="read/"]'),'点击“阅读保存的原文”核对引用的知识；再展开“底层来源”查看原始资料。核对后返回输出页继续。');
 }
 if(!draft)return result('open',opener(),step.id==='output-use'?'打开本次草稿，在“实际采用的知识”中选择真正使用的条目，再确认保存。':step.instruction);
 if(step.id==='output-use'){
  if(draft.querySelector('[name="usedId"]:checked'))return result('save',pick(draft,'button[type="submit"]'),'已勾选采用项。请点击“确认保存”记录这次采用；只勾选但未保存不会完成本步。');
  return result('use',pick(draft,'[name="usedId"]')?.closest('label'),'勾选你在这份表达中真正使用的知识。整行都是选择区域，确认后点击底部“确认保存”。');
 }
 return result('edit',pick(draft,'textarea'),step.instruction);
}
