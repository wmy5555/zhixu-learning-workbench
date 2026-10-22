import test from 'node:test';
import assert from 'node:assert/strict';
import {learningTarget} from '../public/web/onboarding-targets.mjs';
function scope(nodes={},dataset={}){return {dataset,querySelectorAll:s=>nodes[s]||[]};}
const visible=n=>!n.hidden;
test('learning form guides stage, depth, then save using live field values',()=>{
 const stage={value:'candidate'},depth={value:'apply'},save={};
 const dialog=scope({'[name="stage"]':[stage],'[name="depth"]':[depth],'form button[type="submit"]':[save]},{guideForm:'learning',guideNote:'chosen'});
 const input={root:scope({'dialog[open]':[dialog]}),route:'read/chosen',noteId:'chosen',visible};
 assert.equal(learningTarget(input),stage);stage.value='learning';assert.equal(learningTarget(input),depth);depth.value='explain';assert.equal(learningTarget(input),save);
 stage.value='reference';assert.equal(learningTarget(input),stage);
 stage.value='integrated';assert.equal(learningTarget(input),save);
});
test('only the topmost modal and selected knowledge can supply an action',()=>{
 const old={},current={},other={};
 const lower=scope({'[data-action="promote"][data-id="chosen"]':[old]});
 const upper=scope({'[data-action="promote"][data-id="chosen"]':[current],'[data-action="promote"][data-id="other"]':[other]});
 const input={root:scope({'dialog[open]':[lower,upper]}),route:'read/chosen',noteId:'chosen',visible};
 assert.equal(learningTarget(input),current);current.hidden=true;assert.equal(learningTarget(input),null);
 upper.dataset={guideForm:'learning',guideNote:'other'};upper.querySelectorAll=s=>s==='[name="stage"]'?[other]:[];assert.equal(learningTarget(input),null);
});
test('selected reader, editor return and library entry follow the same knowledge identity',()=>{
 const promote={},menu={},back={},entry={};
 const root=scope({'[data-action="promote"][data-id="chosen"]':[promote],'[data-action="reader-actions"][data-id="chosen"]':[menu],'#main [data-route="read/chosen"]':[entry]});
 const input={root,route:'read/chosen',noteId:'chosen',visible};assert.equal(learningTarget(input),promote);
 promote.hidden=true;assert.equal(learningTarget(input),menu);
 input.route='library';assert.equal(learningTarget(input),entry);
 input.root=scope({'#main [data-route="read/chosen"]':[back]});input.route='edit/chosen';assert.equal(learningTarget(input),back);
 input.route='read/other';assert.equal(learningTarget(input),null);input.noteId=null;assert.equal(learningTarget(input),null);
});
