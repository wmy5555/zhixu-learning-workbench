import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDiscoveryCatalog,bodyDigest} from '../public/web/discovery-catalog.mjs';
const lesson={id:'lesson',type:'lesson',title:'理解',pages:[{title:'概念',body:'正文'}]};
const quiz={id:'quiz',type:'quiz',title:'判断',question:'选哪项？',options:[{id:'a',text:'A',explanation:'解释A'},{id:'b',text:'B',explanation:'解释B'}],correctOptionId:'a',prerequisites:['lesson']};
async function note(cards=[lesson,quiz]){return {id:'note-1',kind:'knowledge',title:'资料',body:'依据正文',meta:{stage:'learning',topic:'主题',discovery:{version:1,sourceHash:await bodyDigest('依据正文'),cards}}};}
test('structured cards bind to their body and qualify local prerequisites',async()=>{const cards=await buildDiscoveryCatalog([await note()]);assert.equal(cards.length,3);assert.deepEqual(cards[2].prerequisites,['note-1:lesson']);assert.equal(cards[2].noteId,'note-1');});
test('changed body falls back to reading and never scores stale questions',async()=>{const n=await note();n.body='编辑后的材料';const cards=await buildDiscoveryCatalog([n]);assert.equal(cards.length,1);assert.equal(cards[0].stale,true);assert.equal(cards[0].body,n.body);});
test('changed question invalidates old evidence even when source prose is unchanged',async()=>{const n=await note(),before=await buildDiscoveryCatalog([n]);n.meta.discovery.cards[1]={...quiz,correctOptionId:'b'};const after=await buildDiscoveryCatalog([n]);assert.notEqual(before[2].sourceHash,after[2].sourceHash);});
test('invalid answers, prerequisites, and cycles cannot unlock scored cards',async()=>{const n=await note([{...quiz,correctOptionId:'missing'}, {...lesson,id:'cycle',prerequisites:['cycle']}, {...quiz,id:'orphan',prerequisites:['unknown']}]);assert.equal((await buildDiscoveryCatalog([n])).length,1);});
test('retired material is excluded without mutating source notes',async()=>{const n=await note();n.meta.stage='retired';const prior=JSON.stringify(n);assert.deepEqual(await buildDiscoveryCatalog([n]),[]);assert.equal(JSON.stringify(n),prior);});
