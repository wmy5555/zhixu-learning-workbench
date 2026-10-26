import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverySeeds} from '../public/web/discovery-content.mjs';
import {renderLearningCard} from '../public/web/discovery-cards.mjs';

const find=type=>discoverySeeds.flatMap(s=>s.cards).find(c=>c.type===type);
const quiz=find('quiz'),flash=find('flash'),lesson=find('lesson');

test('curated preview cards have local prerequisites and one valid key per single-choice question',()=>{
 assert.equal(discoverySeeds.length,6);assert.equal(new Set(discoverySeeds.map(s=>s.topic)).size,2);
 assert.equal(discoverySeeds.flatMap(s=>s.cards).length,12);
 for(const seed of discoverySeeds){
  assert.ok(seed.body&&seed.sources.length);const ids=new Set(seed.cards.map(c=>c.id));assert.equal(ids.size,seed.cards.length);
  for(const c of seed.cards){
   for(const id of c.prerequisites)assert.ok(ids.has(id));
   if(c.type==='lesson'){assert.equal(c.pages.length,3);assert.ok(c.pages.at(-1).takeaway);}
   if(c.type==='quiz'){assert.equal(c.options.length,4);assert.equal(c.options.filter(o=>o.id===c.correctOptionId).length,1);assert.ok(c.options.every(o=>o.explanation));}
  }
 }
});

test('microcourse exposes only its current page and ends with an explicit completion action',()=>{
 const start=renderLearningCard(lesson,{page:0});assert.ok(start.includes(lesson.pages[0].body));assert.ok(!start.includes(lesson.pages[2].takeaway));
 assert.match(start,/data-feed-action="lesson-prev" disabled/);assert.ok(!start.includes('data-feed-action="lesson-complete"'));
 const end=renderLearningCard(lesson,{page:2});assert.ok(end.includes(lesson.pages[2].takeaway));assert.ok(end.includes('data-feed-action="lesson-complete"'));
 const completed=renderLearningCard(lesson,{page:2,completed:true});assert.ok(completed.includes('data-feed-action="feed-next"'));assert.ok(!completed.includes('data-feed-action="lesson-complete"'));
});

test('quiz cannot confirm an absent or invalid selection and hides explanatory feedback until submission',()=>{
 for(const selected of [null,'not-an-option']){
  const html=renderLearningCard(quiz,{selected});assert.match(html,/data-feed-action="quiz-submit" disabled/);
  assert.ok(!html.includes('lfc-quiz-feedback'));assert.ok(!html.includes(quiz.options[0].explanation));assert.ok(!html.includes('is-correct'));
 }
 const chosen=renderLearningCard(quiz,{selected:quiz.correctOptionId});assert.ok(chosen.includes('is-selected'));assert.ok(!chosen.includes('data-feed-action="quiz-submit" disabled'));
});

test('submitted options lock and a retry keeps the first wrong selection visible',()=>{
 const wrong=quiz.options.find(o=>o.id!==quiz.correctOptionId),first={selected:wrong.id,correct:false,firstAttempt:true};
 const html=renderLearningCard(quiz,{selected:quiz.correctOptionId,submitted:true,first,attempts:[first,{selected:quiz.correctOptionId,correct:true,firstAttempt:false}],assisted:true});
 assert.equal((html.match(/role="radio" aria-checked="(?:true|false)" disabled/g)||[]).length,4);
 assert.ok(html.includes('首次选择已保留'));assert.ok(html.includes(wrong.text));assert.ok(html.includes('不计作新的独立回忆证据'));
 assert.ok(html.includes('data-feed-action="quiz-retry"'));assert.ok(html.includes(quiz.options[0].explanation));
 const retry=renderLearningCard(quiz,{selected:null,submitted:false,first,attempts:[first],assisted:true});assert.ok(retry.includes('首次选择保持不变'));assert.ok(!retry.includes('lfc-quiz-feedback'));
});

test('flash answer and rating actions are absent from the unrevealed DOM',()=>{
 const card={...flash,answer:'UNSEEN_ANSWER',explanation:'UNSEEN_EXPLANATION'};
 const html=renderLearningCard(card,{draft:'my attempt'});assert.ok(!html.includes(card.answer));assert.ok(!html.includes(card.explanation));assert.ok(!html.includes('data-feed-action="flash-rate"'));
 assert.ok(html.includes('my attempt'));assert.ok(html.includes('data-feed-action="flash-reveal"'));
 const revealed=renderLearningCard(card,{draft:'my attempt',revealed:true});assert.ok(revealed.includes(card.answer));assert.ok(revealed.includes('揭晓前的回答'));assert.equal((revealed.match(/data-grade=/g)||[]).length,4);
});

test('learning from the answer only offers retry, while recorded assessment has no rating controls',()=>{
 const assisted=renderLearningCard(flash,{revealed:true,assisted:true});assert.ok(assisted.includes('data-grade="again"'));
 for(const g of ['hard','good','easy'])assert.ok(!assisted.includes(`data-grade="${g}"`));
 const rated=renderLearningCard(flash,{revealed:true,grade:'good',receipt:'稍后复习'});assert.ok(!rated.includes('data-grade='));assert.ok(rated.includes('稍后复习'));assert.ok(rated.includes('不改变正式掌握等级'));
});

test('untrusted card and answer text are escaped, including option attributes',()=>{
 const malicious='<img src=x onerror=alert(1)>',value='x" onclick="alert(1)';
 const html=renderLearningCard({type:'quiz',question:malicious,correctOptionId:value,options:[{id:value,text:malicious,explanation:malicious}]},{selected:value,submitted:true});
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('data-option="x" onclick='));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&quot; onclick=&quot;'));
 const answer=renderLearningCard({...flash,answer:malicious,explanation:malicious},{revealed:true,draft:'</textarea><script>alert(1)</script>'});assert.ok(!answer.includes('<script>'));assert.ok(!answer.includes('<img'));
});
