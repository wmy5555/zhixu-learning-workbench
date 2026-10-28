import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/web/main.mjs',import.meta.url),'utf8');
function navigation({route='capture',accepted=false}={}) {
  const listeners=new Map(),calls=[],decisions=[];
  const state={route,dirty:true},location={hash:`#${route}`};
  const sandbox={state,location,$$:()=>[],window:{addEventListener(type,handler){listeners.set(type,handler);}},
    history:{replaceState(_state,_title,url){location.hash=url;}},
    go:async(target,options)=>{
      calls.push({target,options});
      await new Promise(resolve=>decisions.push(resolve));
      if(!accepted)return false;
      state.route=target;state.dirty=false;return true;
    }};
  vm.runInNewContext(source.slice(source.indexOf("window.addEventListener('beforeunload'"),source.indexOf('try { await onboarding.initialize()')),sandbox);
  const emit=type=>listeners.get(type)?.();
  return {state,location,calls,decisions,emit};
}

test('one history traversal asks to leave unsaved input only once and cancellation restores the current route',async()=>{
  const nav=navigation();nav.location.hash='#today';
  const pop=nav.emit('popstate'),hash=nav.emit('hashchange');
  assert.equal(nav.calls.length,1,'popstate and hashchange describe the same browser back action');
  nav.decisions.forEach(resolve=>resolve());await Promise.all([pop,hash]);
  assert.equal(nav.location.hash,'#capture');assert.equal(nav.state.route,'capture');assert.equal(nav.state.dirty,true);
});

test('accepting browser forward renders its destination once',async()=>{
  const nav=navigation({route:'today',accepted:true});nav.location.hash='#capture';
  const pop=nav.emit('popstate'),hash=nav.emit('hashchange');
  assert.equal(nav.calls.length,1);
  nav.decisions.forEach(resolve=>resolve());await Promise.all([pop,hash]);
  assert.equal(nav.state.route,'capture');assert.equal(nav.location.hash,'#capture');assert.equal(nav.state.dirty,false);
});

test('direct fragment navigation still reaches the requested route',async()=>{
  const nav=navigation({accepted:true});nav.location.hash='#library';
  const pending=nav.emit('hashchange');assert.equal(nav.calls[0].target,'library');assert.equal(nav.calls[0].options.replace,true);
  nav.decisions[0]();await pending;assert.equal(nav.state.route,'library');
});

test('history entries with the same fragment leave the current draft untouched',async()=>{
  const nav=navigation();const pop=nav.emit('popstate'),hash=nav.emit('hashchange');
  nav.decisions.forEach(resolve=>resolve());await Promise.all([pop,hash]);
  assert.equal(nav.calls.length,0);assert.equal(nav.state.dirty,true);
});
