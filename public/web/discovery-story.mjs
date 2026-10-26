import {contentTags} from './discovery-flow.mjs';

const text=value=>String(value||'').replace(/<!--[\s\S]*?-->/g,'').replace(/```[\s\S]*?```/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?)/gm,'').replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g,(_,a,b)=>a||b).replace(/`([^`\n]+)`/g,'$1').trim();

// Extractive illustrated pages: no generated claims, hidden quiz answers or remote images.
export function buildStoryPages(card){
 const pages=[{title:card.title,body:'',cover:true}];
 if(card.type!=='reading')return pages;
 const body=text(card.body),sentences=body.match(/[^。！？\n]+[。！？]?/g)||[];let chunks=[],part='';
 for(const raw of sentences){const sentence=raw.trim();if(!sentence||sentence===card.title)continue;if(part&&part.length+sentence.length>115){chunks.push(part);part='';}part+=sentence;}
 if(part)chunks.push(part);
 for(const chunk of chunks.slice(0,3)){
  const sentence=chunk.match(/^[^。！？]+[。！？]?/u)?.[0]||chunk,title=sentence.length<=65?sentence:card.title;
  const rest=title===sentence?chunk.slice(sentence.length).trim():chunk;
  pages.push({title,body:rest.length>200?rest.slice(0,200)+'…':rest,cover:false});
 }
 return pages;
}

export function createRelatedIndex(cards,notes){
 const readings=cards.filter(c=>c.type==='reading'),byNote=new Map(readings.map(c=>[c.noteId,c])),byTitle=new Map(readings.map(c=>[c.title,c]));
 const terms=new Map(),inverted=new Map(),explicit=new Map(),cache=new Map();
 const link=(a,b)=>{if(a===b||!byNote.has(a)||!byNote.has(b))return;if(!explicit.has(a))explicit.set(a,new Set());explicit.get(a).add(b);};
 for(const note of notes){const card=byNote.get(note.id);if(!card)continue;
  const words=contentTags(card,note.meta?.tags).filter(w=>w.length>=2);terms.set(note.id,words);
  for(const word of words){if(!inverted.has(word))inverted.set(word,new Set());inverted.get(word).add(note.id);}
  for(const relation of Array.isArray(note.meta?.relations)?note.meta.relations:[]){if(relation?.state!=='accepted')continue;link(relation.fromId,relation.toId);link(relation.toId,relation.fromId);}
  for(const match of String(note.body||'').matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|\]\(#read\/([a-z0-9-]+)\)/gi)){const target=match[2]||byTitle.get(match[1])?.noteId;link(note.id,target);link(target,note.id);}
 }
 return card=>{
  if(cache.has(card.noteId))return cache.get(card.noteId);
  const matches=new Map();
  for(const id of explicit.get(card.noteId)||[])matches.set(id,{card:byNote.get(id),query:byNote.get(id).title,score:100});
  for(const word of terms.get(card.noteId)||[])for(const id of inverted.get(word)||[]){if(id===card.noteId)continue;const target=byNote.get(id);const old=matches.get(id);matches.set(id,{card:target,query:old?.query||word,score:(old?.score||0)+1});}
  const result=[...matches.values()].sort((a,b)=>b.score-a.score||a.card.title.localeCompare(b.card.title,'zh')).slice(0,4);cache.set(card.noteId,result);return result;
 };
}

export function createStoryStrip({getElement,stateFor,reduced,onChange,prepareDetail=()=>{}}){
 let active=null,animation=null,frame=0,pending=0,revision=0,dragStart=0,width=0,disposed=false;
 const transform=x=>`translate3d(${x}px,0,0)`;
 function cancel(){revision++;animation?.cancel();animation=null;if(frame){cancelAnimationFrame(frame);frame=0;}}
 function save(){if(!active)return;const scroll=active.element.querySelector('[data-story-detail-body]');if(scroll)active.state.scroll=scroll.scrollTop;}
 function readX(){const value=getComputedStyle(active.track).transform,match=value.match(/^matrix(3d)?\((.+)\)$/);if(match)return Number(match[2].split(',')[match[1]?12:4])||0;return -active.state.index*active.element.clientWidth;}
 function update(){if(!active)return;const {element,pages,state}=active,index=state.index,detail=index===pages.length-1;
  element.dataset.storyIndex=String(index);element.dataset.detailOpen=String(detail);
  pages.forEach((page,i)=>{page.inert=i!==index;if(i===index)page.removeAttribute('aria-hidden');else page.setAttribute('aria-hidden','true');});
  element.querySelectorAll('[data-story-go]').forEach(button=>{const i=Number(button.dataset.storyGo);button.classList.toggle('active',i===index);button.classList.toggle('past',i<index);if(i===index)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
  element.querySelector('[data-story-detail]').dataset.expanded=String(Boolean(state.expanded));
  onChange?.({detail,index,key:element.dataset.storyKey});
 }
 function sync(){save();cancel();const element=getElement();if(!element){active=null;onChange?.({detail:false});return;}
  const track=element.querySelector('.lf-story-track'),pages=[...track.children],state=stateFor(element.dataset.storyKey);state.index=Math.max(0,Math.min(pages.length-1,state.index||0));
  active={element,track,pages,state};track.style.transform=transform(-state.index*element.clientWidth);
  if(state.index>=pages.length-2)prepareDetail(element);
  const scroll=element.querySelector('[data-story-detail-body]');if(scroll)scroll.scrollTop=state.scroll||0;update();
 }
 async function go(index,{animate=true,focus=false,from}={}){if(!active||disposed)return;const a=active,previous=a.state.index,target=Math.max(0,Math.min(a.pages.length-1,index));
  const start=from??readX();cancel();const request=revision;if(target<a.pages.length-1)a.state.lastPicture=target;else if(previous<a.pages.length-1)a.state.lastPicture=previous;
  if(target>=a.pages.length-2)prepareDetail(a.element);
  a.state.index=target;const end=-target*a.element.clientWidth;a.track.style.transform=transform(end);update();
  if(animate&&!reduced()&&Math.abs(start-end)>.5){animation=a.track.animate([{transform:transform(start)},{transform:transform(end)}],{duration:260,easing:'cubic-bezier(.16,1,.3,1)'});try{await animation.finished;}catch{return;}}
  if(request!==revision||active!==a)return;animation=null;if(focus)a.pages[target].querySelector('button')?.focus({preventScroll:true});
 }
 function start(){if(!active)return;dragStart=readX();cancel();width=active.element.clientWidth;active.track.style.transform=transform(dragStart);}
 function drag(dx){if(!active)return;let x=dragStart+dx;const min=-(active.pages.length-1)*width;if(x>0)x*=.18;else if(x<min)x=min+(x-min)*.18;pending=x;if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(active)active.track.style.transform=transform(pending);});}
 function end(dx,velocity,cancelled=false){if(!active)return;if(frame){cancelAnimationFrame(frame);frame=0;active.track.style.transform=transform(pending);}
  const enough=Math.abs(dx)>=Math.min(100,width*.2),flick=Math.abs(dx)>28&&Math.abs(velocity)>.65&&Math.sign(dx)===Math.sign(velocity);
  const index=cancelled||!enough&&!flick?active.state.index:Math.round(-dragStart/width)-Math.sign(dx);void go(index,{from:pending});
 }
 return {sync,save,start,drag,end,get detailOpen(){return Boolean(active&&active.state.index===active.pages.length-1);},
  step(direction,animate=true){if(active)return go(active.state.index+direction,{animate});},go,
  detail(animate=true){if(active)return go(active.pages.length-1,{animate,focus:true});},
  back(animate=true){if(active)return go(active.state.lastPicture||0,{animate,focus:true});},
  expand(){if(active){active.state.expanded=!active.state.expanded;update();}},
  dispose(){save();disposed=true;cancel();active=null;}
 };
}
