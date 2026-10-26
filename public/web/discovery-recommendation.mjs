// Session-local, explainable learning suggestions. No model, persistence or product-study writes.
// Numerical weights and delays below are preview choices, not recovered platform parameters.
const ACTIVE = new Set(['quiz', 'flash']);
const DAY = 86400000;
const identity = card => JSON.stringify([String(card.id), String(card.sourceHash || '')]);
const topicOf = card => String(card.topic || '未归入主题');
const noteOf = card => String(card.noteId || card.id);
const basisOf = card => String(card.basisHash || card.sourceHash || '');
const materialKey = card => JSON.stringify([noteOf(card), basisOf(card)]);
const bounded = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));

export function createRecommender({ now = Date.now, random = Math.random } = {}) {
  const records = new Map(), versions = new Map(), ties = new Map();
  const saved = new Set(), liked = new Set(), muted = new Set();
  const topicSignals = new Map(), materialCooldowns = new Map(), events = [];
  let lastExposure = null;

  function entry(card) {
    const key = identity(card);
    versions.set(String(card.id), key);
    if (!records.has(key)) records.set(key, {
      cardId:String(card.id), noteId:noteOf(card), sourceHash:String(card.sourceHash || ''), basisHash:basisOf(card), topic:topicOf(card), type:card.type,
      seen:false, lessonCompleted:false, attempts:0, activeAttempt:null, assistedAttempt:null,
      independentCorrect:0, selfReports:0, assistedAttempts:0, retry:null, suggestedAt:null,
    });
    return records.get(key);
  }
  const currentRecord = card => records.get(identity(card));
  const ready = retry => !!retry && retry.seen.size >= retry.gap && (!retry.needsExplanation || retry.explained);
  const materialRemaining = card => Math.max(0,2-(materialCooldowns.get(materialKey(card))?.seen.size ?? 2));
  const materialReady = card => materialRemaining(card)===0;
  const markMaterial = card => materialCooldowns.set(materialKey(card),{noteId:noteOf(card),basisHash:basisOf(card),seen:new Set()});
  const isCurrent = record => versions.get(record.cardId) === JSON.stringify([record.cardId, record.sourceHash]);
  function signal(topic) {
    if (!topicSignals.has(topic)) topicSignals.set(topic, { seen:new Set(), skipped:new Set(), dwell:0 });
    return topicSignals.get(topic);
  }
  function remember(card, event, detail = {}) {
    events.push({type:event.type,cardId:String(card.id),noteId:noteOf(card),sourceHash:String(card.sourceHash || ''),topic:topicOf(card),at:now(),...detail});
    if (events.length > 60) events.shift();
  }
  function scheduleRetry(record, gap, needsExplanation) {
    record.suggestedAt = null;
    record.retry = { gap, seen:new Set(), needsExplanation, explained:!needsExplanation };
  }

  function observe(card, event = {}) {
    if (!card?.id || typeof event.type !== 'string') return false;
    const supported = ['exposure','save','unsave','like','unlike','skip','not-interested','lesson-complete','quiz-result','flash-result','open-material'];
    if (!supported.includes(event.type)) return false;
    const key=identity(card), record=entry(card), topic=topicOf(card), noteId=noteOf(card);
    if (event.type === 'quiz-result' || event.type === 'flash-result') {
      if ((event.type === 'quiz-result' && card.type !== 'quiz') || (event.type === 'flash-result' && card.type !== 'flash')) return false;
      if (event.attempt !== undefined && event.attempt !== record.attempts) return false;
      if (record.suggestedAt > now() || (record.retry && !ready(record.retry))) return false;
      if (event.type === 'quiz-result' && typeof event.correct !== 'boolean') return false;
      if (event.type === 'flash-result' && !['again','hard','good','easy'].includes(event.grade)) return false;
      const assisted = event.assisted === true || record.assistedAttempt === record.attempts || (card.type==='flash'&&!materialReady(card));
      const independent = !assisted && (event.type === 'flash-result' || event.firstAttempt === true);
      record.attempts++;record.activeAttempt=null;record.assistedAttempt=null;
      if (!independent) record.assistedAttempts++;
      if (event.type === 'quiz-result') {
        if (event.correct && independent) {
          record.independentCorrect++;record.retry=null;record.suggestedAt=now()+DAY;
        } else scheduleRetry(record,2,event.correct !== true);
      } else {
        record.selfReports++;
        if (event.grade === 'again') scheduleRetry(record,2,true);
        else if (!independent) scheduleRetry(record,2,false);
        else if (event.grade === 'hard') scheduleRetry(record,4,false);
        else {record.retry=null;record.suggestedAt=now()+(event.grade === 'easy'?4:1)*DAY;}
      }
      remember(card,event,{correct:event.correct,grade:event.grade,assisted:!independent,attempt:record.attempts-1});
      return true;
    }
    if (event.type === 'save') saved.add(noteId);
    if (event.type === 'unsave') saved.delete(noteId);
    if (event.type === 'like') liked.add(noteId);
    if (event.type === 'unlike') liked.delete(noteId);
    if (event.type === 'not-interested') muted.add(topic);
    if (event.type === 'skip') signal(topic).skipped.add(key);
    if (event.type === 'exposure') {
      record.seen=true;lastExposure={cardId:record.cardId,key,type:card.type,topic};
      // Very brief visibility may be logged, but is not used to satisfy a retry gap.
      const meaningful = event.elapsedMs === undefined || Number(event.elapsedMs) >= 600;
      if (meaningful) {
        const t=signal(topic);t.seen.add(key);t.dwell=Math.max(t.dwell,bounded(event.elapsedMs,0,60000));
        for (const other of records.values()) if (isCurrent(other) && other.retry && other.cardId !== record.cardId) other.retry.seen.add(key);
        // Different presentations of one material are one intervening material, not several.
        const material=materialKey(card);
        for(const [basis,cooldown] of materialCooldowns)if(basis!==material)cooldown.seen.add(material);
        if(card.type==='reading'||card.type==='compare')markMaterial(card);
      }
      if (!record.retry || ready(record.retry)) record.activeAttempt=record.attempts;
    }
    if (event.type === 'lesson-complete') {
      if (card.type !== 'lesson') return false;
      record.lessonCompleted=true;
    }
    if (event.type === 'open-material' || event.type === 'lesson-complete') {
      markMaterial(card);
      for (const other of records.values()) if (isCurrent(other) && other.noteId === noteId && other.basisHash === record.basisHash && other.retry) other.retry.explained=true;
      // Reading remedial material before the delayed attempt is study, not aid during that attempt.
      if (event.type === 'open-material' && ACTIVE.has(card.type) && (!record.retry || record.activeAttempt === record.attempts)) record.assistedAttempt=record.attempts;
    }
    remember(card,event);
    return true;
  }

  function rank(cards = [], { mode='discover', todayNoteIds=[], pausedNoteIds=[], focusTopics=[], excludeIds=[], limit=12 } = {}) {
    const today=new Set(todayNoteIds.map(String)), paused=new Set(pausedNoteIds.map(String)), focus=new Set(focusTopics.map(String)), excluded=new Set(excludeIds.map(String));
    const unique=new Map();
    for (const card of cards) if (card?.id && !unique.has(String(card.id))) {unique.set(String(card.id),card);versions.set(String(card.id),identity(card));}
    const candidates=[],interestTopics=new Set(),remedialBases=new Set();
    for(const card of unique.values())if(saved.has(noteOf(card))||liked.has(noteOf(card)))interestTopics.add(topicOf(card));
    for(const r of records.values())if(isCurrent(r)&&r.retry?.needsExplanation&&!r.retry.explained)remedialBases.add(JSON.stringify([r.noteId,r.basisHash]));
    for (const card of unique.values()) {
      const id=String(card.id),noteId=noteOf(card),topic=topicOf(card),record=currentRecord(card),due=today.has(noteId);
      if (excluded.has(id) || paused.has(noteId) || card.paused || card.retired || card.stage==='retired' || card.meta?.stage==='retired' || card.disabled) continue;
      if (mode === 'discover' && muted.has(topic)) continue;
      if (mode === 'saved' && !saved.has(noteId)) continue;
      if (mode === 'review' && !due && !record?.retry && !(record?.suggestedAt && record.suggestedAt<=now())) continue;
      if (ACTIVE.has(card.type)) {
        if(card.type==='flash'&&!materialReady(card))continue;
        if (record?.suggestedAt>now() || (record?.retry&&!ready(record.retry))) continue;
        const missing=(card.prerequisites||[]).some(prerequisite=>{
          const source=unique.get(String(prerequisite));if(!source)return true;
          if(noteOf(source)===noteId && basisOf(source)!==basisOf(card))return true;
          const evidence=currentRecord(source);return !evidence?.lessonCompleted && !evidence?.independentCorrect;
        });
        if(missing)continue;
      }
      const remediation=!ACTIVE.has(card.type) && remedialBases.has(JSON.stringify([noteId,basisOf(card)]));
      const retrial=ready(record?.retry), t=signal(topic);
      const explicitInterest=interestTopics.has(topic);
      const affinity=(saved.has(noteId)?8:0)+(liked.has(noteId)?5:0)+(focus.has(topic)?4:0)+(explicitInterest?2:0)+Math.min(.75,t.seen.size*.15)+Math.min(.25,t.dwell/240000)-Math.min(1.5,t.skipped.size*.3);
      if(!ties.has(identity(card)))ties.set(identity(card),bounded(random(),0,1));
      const score=(due?100:0)+(remediation?65:0)+(retrial?55:0)+affinity+(lastExposure?.topic===topic?2:0)-(record?.seen?3:0)-(record?.lessonCompleted?4:0)+ties.get(identity(card));
      let reason='换一个角度，看看这条知识',reasonCode='balanced';
      if(remediation){reason='先补上刚才卡住的解释';reasonCode='remediation';}
      else if(retrial){reason='间隔后，再独立回忆一次';reasonCode='retry-ready';}
      else if(card.type==='flash'&&materialCooldowns.has(materialKey(card))){reason='隔开其他内容后，再回忆这个事实';reasonCode='delayed-recall';}
      else if(due){reason='这条知识在今日复习计划里';reasonCode='today-review';}
      else if(ACTIVE.has(card.type)&&(card.prerequisites||[]).length){reason='读过相关微课，试着用一用';reasonCode='apply-after-lesson';}
      else if(saved.has(noteId)){reason='来自你收藏的知识';reasonCode='saved';}
      else if(explicitInterest){reason='你对这个主题表达过兴趣';reasonCode='interest';}
      else if(focus.has(topic)){reason='与你关注的主题有关';reasonCode='focus';}
      else if(lastExposure?.topic===topic){reason='接着刚才的话题';reasonCode='continuation';}
      else if(card.type==='lesson'){reason='先把这个概念弄清楚';reasonCode='foundation';}
      candidates.push({card,record,due,remediation,retrial,topic,affinity,score,reason,reasonCode});
    }
    const remaining=candidates.sort((a,b)=>b.score-a.score||String(a.card.id).localeCompare(String(b.card.id))),selected=[];
    const maximum=Math.trunc(bounded(limit,0,30));
    while(remaining.length && selected.length<maximum){
      const previous=selected.at(-1),previousType=previous?.card.type||lastExposure?.type;
      let pool=remaining.filter(c=>!(ACTIVE.has(previousType)&&ACTIVE.has(c.card.type)));
      if(!pool.length)break;
      if(selected.length===0&&pool.some(c=>c.due))pool=pool.filter(c=>c.due);
      const twoSame=selected.length>1&&selected.at(-1).topic===selected.at(-2).topic;
      if(twoSame&&pool.some(c=>c.topic!==previous.topic))pool=pool.filter(c=>c.topic!==previous.topic);
      let choice;
      if(mode==='discover'&&selected.length===2){
        const topics=new Set(selected.map(c=>c.topic));
        const explore=pool.filter(c=>!topics.has(c.topic)&&!c.remediation&&!c.retrial);
        if(explore.length){choice=explore.sort((a,b)=>a.affinity-b.affinity||b.score-a.score)[0];choice={...choice,reason:'换个主题，保持一点探索',reasonCode:'exploration'};}
      }
      if(!choice)choice=pool.reduce((best,c)=>{
        const score=c.score-(previous?.card.type===c.card.type?3:0)-(previous?.topic===c.topic?4:0);
        return !best||score>best.adjusted?{...c,adjusted:score}:best;
      },null);
      selected.push(choice);remaining.splice(remaining.findIndex(c=>c.card.id===choice.card.id),1);
    }
    return selected.map(({card,record,reason,reasonCode})=>({...card,reason,reasonCode,attempt:record?.attempts||0}));
  }

  function snapshot(){
    const current=[...records.values()].filter(isCurrent);
    return {
      version:1,scope:'session',savedNoteIds:[...saved],likedNoteIds:[...liked],mutedTopics:[...muted],
      completedLessons:current.filter(r=>r.lessonCompleted).map(r=>({cardId:r.cardId,sourceHash:r.sourceHash})),
      plans:current.filter(r=>r.retry||r.suggestedAt).map(r=>({cardId:r.cardId,noteId:r.noteId,sourceHash:r.sourceHash,kind:r.retry?'retry':'future',remainingCards:Math.max(r.retry?Math.max(0,r.retry.gap-r.retry.seen.size):0,r.type==='flash'?materialRemaining(r):0),needsExplanation:!!r.retry?.needsExplanation&&!r.retry.explained,ready:(r.retry?ready(r.retry):r.suggestedAt<=now())&&(r.type!=='flash'||materialReady(r)),suggestedAt:r.suggestedAt,attempt:r.attempts})),
      materialCooldowns:[...materialCooldowns.values()].map(c=>({noteId:c.noteId,basisHash:c.basisHash,remainingMaterials:Math.max(0,2-c.seen.size),ready:c.seen.size>=2})),
      counts:{exposedCards:current.filter(r=>r.seen).length,quizIndependentCorrect:current.reduce((n,r)=>n+r.independentCorrect,0),flashSelfReports:current.reduce((n,r)=>n+r.selfReports,0),assistedAttempts:current.reduce((n,r)=>n+r.assistedAttempts,0)},
      recentEvents:events.map(event=>({...event})),
    };
  }
  function reset(){records.clear();versions.clear();ties.clear();saved.clear();liked.clear();muted.clear();topicSignals.clear();materialCooldowns.clear();events.length=0;lastExposure=null;}
  return {rank,observe,reset,snapshot};
}
