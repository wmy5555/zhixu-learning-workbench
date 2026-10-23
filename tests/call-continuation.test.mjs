import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';
const settings={timezone:'Asia/Shanghai',ai:{dailyCallLimit:10,monthlyBudget:0}};
function fixture(t){const root=fs.mkdtempSync(path.resolve('.tmp/call-continuation-'));const store=new Store({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault')});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});const ledger=createCallLedger({store,allowUncertainContinuation:true});const row=ledger.reserve({capability:'embedding',key:'original',contextKey:'original-operation'},settings);ledger.dispatch(row.id);ledger.unknown(row.id,{error:'synthetic timeout'});ledger.finish(row.id);return {store,ledger,row};}
test('continuation requires explicit acknowledgement and never converts unknown cost into zero',t=>{
 const {store,ledger,row}=fixture(t);const input={capability:'model',key:'new',contextKey:'new-operation'};
 assert.throws(()=>ledger.reserve(input,settings),{code:'CALL_RECOVERY_REQUIRED'});assert.throws(()=>ledger.allowNewRequests(row.id,{reason:'test'}),{code:'INVALID_INPUT'});
 ledger.allowNewRequests(row.id,{acknowledgeUnknownCost:true,reason:'user authorizes distinct future requests'});
 assert.equal(store.get('calls',row.id).cost,null);assert.equal(store.get('callLedger',row.id).phase,'unknown');assert.equal(ledger.listPending()[0].newRequestsAllowed,true);
 assert.throws(()=>ledger.replay('original'),{code:'CALL_RECOVERY_REQUIRED'});assert.throws(()=>ledger.reserve({...input,key:'altered',contextKey:'original-operation'},settings),{code:'CALL_RECOVERY_REQUIRED'});
 const next=ledger.reserve(input,settings);assert.doesNotThrow(()=>ledger.dispatch(next.id));
});
test('daily/monthly limits and default instances still block after a lab acknowledgement',t=>{
 const {store,ledger,row}=fixture(t);ledger.allowNewRequests(row.id,{acknowledgeUnknownCost:true,reason:'explicit lab consent'});
 const input={capability:'model',key:'new',contextKey:'new'};
 assert.throws(()=>ledger.reserve(input,{...settings,ai:{dailyCallLimit:1,monthlyBudget:0}}),{code:'BUDGET_EXCEEDED'});
 assert.throws(()=>ledger.reserve(input,{...settings,ai:{dailyCallLimit:10,monthlyBudget:10}}),{code:'BUDGET_UNKNOWN'});
 const formal=createCallLedger({store});assert.throws(()=>formal.reserve(input,settings),{code:'CALL_RECOVERY_REQUIRED'});assert.throws(()=>formal.allowNewRequests(row.id,{acknowledgeUnknownCost:true,reason:'test'}),{code:'CALL_CONTINUE_DISABLED'});
});
