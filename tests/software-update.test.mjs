import test from 'node:test';
import assert from 'node:assert/strict';
import {softwareUpdateHTML, mountSoftwareUpdate, updateResult} from '../public/web/software-update.mjs';
const release={version:'2026.10.23.1',url:'/updates/zhixu-update-20261023.exe',sha256:'a'.repeat(64),bytes:1024};
function harness(request) {
  const button={disabled:false}, result={textContent:'',innerHTML:''};
  mountSoftwareUpdate({querySelector:s=>s==='[data-software-update]'?button:result},request);
  return {button,result};
}
test('update entry waits for a click and prevents duplicate requests', async()=>{
  let calls=0,finish;
  const h=harness(()=>{calls++;return new Promise(resolve=>finish=resolve);});
  assert.equal(calls,0);
  const pending=h.button.onclick(); await h.button.onclick();
  assert.equal(calls,1);assert.equal(h.button.disabled,true);
  finish({ok:true,status:200,json:async()=>release});await pending;
  assert.equal(h.button.disabled,false);assert.match(h.result.innerHTML,/无需重复更新/);
  assert.match(h.result.innerHTML,/download/);assert.match(softwareUpdateHTML(),/settings-update/);
});
test('missing catalog and failed request allow retry without claiming latest',async()=>{
  for(const response of [{status:404},{status:503}]){
    const h=harness(async()=>response);await h.button.onclick();
    assert.equal(h.button.disabled,false);assert.match(h.result.textContent,/尚未提供|暂时无法/);
  }
});
test('catalog only permits local executable paths and complete checksums',()=>{
  for(const value of ['https://evil.invalid/a.exe','/updates/../a.exe','javascript:alert(1)','/updates/a.exe" onclick="bad'])assert.throws(()=>updateResult({...release,url:value}));
  assert.throws(()=>updateResult({...release,sha256:''}));
  assert.match(updateResult({...release,version:'2026.10.24.1'}),/可更新至/);
});
