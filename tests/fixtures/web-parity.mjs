export function seedParity(service) {
  const at=new Date().toISOString();
  service.updateSettings({timezone:'UTC',dailyMinutes:25,ai:{enabled:false},embedding:{enabled:false},search:{enabled:false},fetch:{enabled:false}});
  const source=service.importItems({items:[{title:'合成资料 · 给理解保留出处',body:'# 给理解保留出处\n\n这是一份低敏合成测试资料，不包含真实个人内容。\n\n## 观点与条件\n\n记录观点时同时写下出处、适用条件和反例，可以让后来的人追溯判断。\n\n## 一个练习\n\n请用自己的话解释，并给一个不同的例子。',platform:'合成测试',author:'虚构作者',url:'https://example.com/reference',date:'2026-10-01',locator:'第 2 节',topic:'阅读与表达'}]}).notes[0];
  const secondSource=service.importItems({items:[{title:'合成资料 · 判断与依据',body:'另一份独立的合成材料：记录观点时同时写下出处、适用条件和反例。',platform:'合成测试',author:'虚构作者',topic:'思考方法'}]}).notes[0];
  const knowledge=[];
  for(let i=0;i<4;i++)knowledge.push(service.store.create({id:`synthetic-knowledge-${i}`,kind:'knowledge',title:['先说明结论，再补充成立条件','让证据和判断各自有位置','把问题放回原文中','用一个新的例子检验理解'][i],body:`# 合成学习观点 ${i+1}\n\n记录观点时同时写下出处、适用条件和反例。\n\n这是虚构的练习意见，不是对真实学习效果的测量。`,meta:{stage:'learning',claimType:'opinion',depth:'explain',topic:i%2?'思考方法':'阅读与表达',sources:[{id:i===1?secondSource.id:source.id,role:'input',locator:'第 2 节',rationale:'合成观点的输入来源'}],origins:source.meta.origins}}));
  const topic=service.createTopic({title:'合成主题 · 从阅读走向表达',body:'按顺序练习：记录出处、解释观点、说明边界。',noteIds:knowledge.slice(0,3).map(n=>n.id),minutes:15});
  const session=service.startStudy({noteId:knowledge[0].id,requestId:'synthetic-start'});
  for(let i=0;i<64;i++)service.store.put('sessions',`synthetic-history-${String(i).padStart(2,'0')}`,{...session,id:`synthetic-history-${String(i).padStart(2,'0')}`,status:'completed',createdAt:at,turns:[{id:`turn-${i}`,answer:'合成回答：先说明观点，补充依据与边界。',hintUsed:i%2===0,feedback:{assessment:'correct',omission:'没有发现关键遗漏。',correction:'保留出处与定位。',nextQuestion:'还可以换一个什么例子？',suggestion:'下次再试着独立回忆。'}}],completion:{reason:'合成记录，仅供界面测试。',reviewSettled:false,evidence:{independent:i%2!==0,usedHints:i%2===0,completedAt:at,depth:'explain',turnIds:[`turn-${i}`]}}});
  for(let i=0;i<57;i++)service.store.put('jobs',`synthetic-job-${i}`,{id:`synthetic-job-${i}`,type:'discover',state:i===0?'queued':i%2?'done':'waiting',attempts:0,payload:{useAI:false},createdAt:at,updatedAt:at,error:i%2?'':'合成任务等待人工确认。'});
  for(let i=0;i<24;i++)service.store.put('drafts',`synthetic-draft-${i}`,{id:`synthetic-draft-${i}`,question:`合成草稿 ${i+1}`,body:'# 从理解到表达\n\n保留可追溯的出处，也明确尚不确定的部分。',usedIds:[],citations:[{id:knowledge[0].id,title:knowledge[0].title,excerpt:knowledge[0].body,sourceId:source.id,locator:'第 2 节',role:'input',rationale:'合成引用',fetchedAt:at,url:'https://example.com/reference'}],createdAt:at});
  service.store.put('relations','synthetic-relation',{id:'synthetic-relation',fromId:knowledge[0].id,toId:knowledge[1].id,fromHash:knowledge[0].hash,toHash:knowledge[1].hash,type:'support',state:'suggested',highValue:true,valueScore:9,explanation:'来源定位支持对条件的判断',use:'写作时核对结论',boundary:'不代表所有观点都已经核验',sourceExcerpt:'记录观点时同时写下出处',targetExcerpt:'记录观点时同时写下出处',createdAt:at});
  service.store.create({id:'synthetic-report',kind:'report',title:'合成 AI 整理报告',body:'这些内容是合成整理建议，没有实际调用模型。',meta:{stage:'reference'}});
  service.store.create({id:'synthetic-mistake',kind:'mistake',title:'合成错题 · 结论遗漏边界',body:'原回答：只写结论。\n\n建议：同时说明适用条件。',meta:{noteId:knowledge[0].id,knowledgeId:knowledge[0].id,correctionState:'open',stage:'reference'}});
  for(let i=0;i<8;i++)service.store.put('calls',`synthetic-call-${i}`,{id:`synthetic-call-${i}`,createdAt:at,capability:'model',model:'offline-synthetic',inputTokens:100+i,outputTokens:50,cost:i?0:null,ok:true,purpose:'grade'});
  service.store.put('proposals','synthetic-proposal',{id:'synthetic-proposal',noteId:knowledge[1].id,before:knowledge[1].body,body:knowledge[1].body+'\n\n合成提案：再补充一个反例。',reason:'合成写入建议',expectedHash:knowledge[1].hash,state:'pending',createdAt:at});
  const deleted=service.store.create({id:'synthetic-deleted',kind:'knowledge',title:'合成待恢复知识',body:'这份合成资料用于测试历史恢复。',meta:{stage:'reference'}});
  service.store.delete(deleted.id,deleted.hash);
  service.store.create({id:'synthetic-plan-note',kind:'knowledge',title:'合成今日安排 · 给思考一点时间',body:'这是一个没有前置依赖的合成学习项目，用于验证跳过、暂停和恢复。',meta:{stage:'learning',claimType:'opinion',depth:'explain'}});
  service.today();
  service.backup(); // The preview fixture must obey the real full-backup contract.
  return {sourceId:source.id,knowledgeIds:knowledge.map(n=>n.id),topicId:topic.id,sessionId:session.id};
}
