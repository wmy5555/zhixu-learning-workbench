import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashDeck, mixFlashcards, flashItem, revealFlash, rateFlash, renderFlash } from '../public/web/prototype-feed/flashcards.mjs';

const notes=['n1','n2','n3','n4','n5','n6'];
const setup=()=>{const deck=createFlashDeck(),order=mixFlashcards(notes,deck),id=order.find(k=>flashItem(k,deck));return {deck,order,id,entry:deck.entries[id]};};

test('initial mixing keeps every note and due fact once, with ordinary items between facts',()=>{
 for(let run=0;run<20;run++){
  const {deck,order}=setup();assert.deepEqual(order.filter(id=>!flashItem(id,deck)),notes);
  const facts=order.filter(id=>flashItem(id,deck));assert.equal(facts.length,3);assert.equal(new Set(facts.map(id=>deck.entries[id].card.cardId)).size,3);
  assert.equal(order[0],'n1');for(let i=1;i<order.length;i++)assert.ok(!flashItem(order[i],deck)||!flashItem(order[i-1],deck));
 }
});
test('answers and rating controls are absent until reveal; viewing alone is not a rating',()=>{
 const {deck,order,entry,id}=setup(),html=renderFlash(entry.card,entry,0,{e:String,icon:()=>'',button:(label,action)=>`<button data-action="${action}">${label}</button>`});
 assert.ok(!html.includes('class="fc-answer"'));assert.ok(!html.includes('data-action="flash-rate"'));
 assert.equal(rateFlash(entry,deck,order,order.indexOf(id),'good'),false);assert.equal(deck.records[entry.card.cardId].history.length,0);
 entry.draft='my original answer';revealFlash(entry);assert.equal(entry.attempt,'my original answer');assert.equal(deck.records[entry.card.cardId].history.length,0);
});
test('Again queues a fresh hidden-answer attempt after two ordinary items and cannot double-submit',()=>{
 const {deck,order,entry,id}=setup();entry.draft='forgot';revealFlash(entry);const at=order.indexOf(id);
 assert.equal(rateFlash(entry,deck,order,at,'again'),true);const queued=deck.pending[0].id,newAt=order.indexOf(queued);
 assert.equal(order.slice(at+1,newAt).filter(k=>!flashItem(k,deck)).length,2);
 assert.equal(deck.entries[queued].phase,'question');assert.equal(deck.entries[queued].draft,'');assert.equal(deck.entries[queued].attempt,'');
 assert.equal(rateFlash(entry,deck,order,at,'again'),false);assert.equal(deck.records[entry.card.cardId].history.length,1);
});
test('repeat spacing uses visible ordinary items in a filtered review queue',()=>{
 const {deck,order,entry,id}=setup();revealFlash(entry);const visible=[id,'n4','n6'];
 rateFlash(entry,deck,order,order.indexOf(id),'again',visible);const queued=deck.pending[0].id;
 assert.equal(order.indexOf(queued),order.indexOf('n6')+1);
});
test('a pending retry survives refreshing at the end, without duplicate occurrences',()=>{
 const {deck,entry,id}=setup();revealFlash(entry);const order=[...notes,id];rateFlash(entry,deck,order,6,'hard');
 const queued=deck.pending[0].id,mixed=mixFlashcards(notes,deck),pos=mixed.indexOf(queued);
 assert.ok(pos>=0);assert.equal(mixed.filter(k=>flashItem(k,deck)?.cardId===entry.card.cardId).length,1);
 assert.ok(mixed.slice(0,pos).filter(k=>!flashItem(k,deck)).length>=4);
});
test('successful recall leaves the due pool; learning from the answer cannot count as success',()=>{
 const {deck,order,entry,id}=setup();revealFlash(entry,true);assert.equal(rateFlash(entry,deck,order,order.indexOf(id),'good'),false);
 assert.equal(deck.records[entry.card.cardId].history.length,0);
 const fresh=setup();revealFlash(fresh.entry);const before=Date.now();rateFlash(fresh.entry,fresh.deck,fresh.order,fresh.order.indexOf(fresh.id),'good');
 const result=fresh.deck.records[fresh.entry.card.cardId];assert.equal(result.due,false);assert.ok(result.nextAt>=before+86400000);
 assert.equal(mixFlashcards(notes,fresh.deck).some(k=>flashItem(k,fresh.deck)?.cardId===fresh.entry.card.cardId),false);
});
