/* Throwaway, single-direction visual prototype. The user has explicitly chosen
 * stars -> light -> buds -> leaves -> grounded tree; SSoT sampling is skipped.
 * Scrollama 3.2.0 handles chapters. Canvas progress is derived from native scroll
 * so reverse scroll, deep jumps and resize cannot leave the scene out of sync.
 * No real learning, persistence, model calls, analytics or automatic downloads. */
(() => {
  'use strict';
  const canvas = document.querySelector('#scene');
  const ctx = canvas.getContext('2d', { alpha: false });
  const steps = [...document.querySelectorAll('.step')];
  const nav = [...document.querySelectorAll('.chapter-nav a')];
  const stageName = document.querySelector('#stage-name');
  const shade = document.querySelector('.reading-shade');
  const motion = document.querySelector('#motion-toggle');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = preference.matches;
  let manualMotion = false;
  let w = 0, h = 0, dpr = 1, frame = 0, resizeTimer = 0;
  let current = 0, target = 0, active = -1, scroller;
  let sectionTops = [], scrollRange = 1;
  const stats = { frames: 0, renderMs: [], progress: 0, stage: 0, reduced };
  window.__starTree = stats;
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const phase = (p, a, b) => clamp((p - a) / (b - a));
  // A deterministic smooth interpolation for a scroll position, not a timed UI curve.
  const smooth = t => t * t * (3 - 2 * t);
  let seed = 271828;
  function random() { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; }
  const stars = Array.from({ length: 205 }, () => ({ x: random(), y: random() * 1.4, r: .35 + random() * 1.2, a: .15 + random() * .55 }));
  const concepts = [
    { name: '沉没成本', x: .72, y: .28, hero: true },
    { name: '机会成本', x: .18, y: .34 },
    { name: '复利效应', x: .86, y: .58 },
    { name: '费曼学习法', x: .79, y: .16 },
    { name: '确认偏误', x: .12, y: .68 },
  ];
  const branches = [], leaves = [], tips = [];
  function makeBranch(x, y, length, angle, width, depth, parent = -1) {
    const ex = x + Math.cos(angle) * length;
    const ey = y + Math.sin(angle) * length;
    const bend = (random() - .5) * length * .28;
    const item = { x, y, ex, ey, c1x: x + Math.cos(angle + .12) * length * .35 + bend, c1y: y + Math.sin(angle + .12) * length * .35, c2x: ex - Math.cos(angle - .1) * length * .32, c2y: ey - Math.sin(angle - .1) * length * .32, width, depth, parent, start: .145 + depth * .048 + random() * .015 };
    item.start = parent < 0 ? .13 : branches[parent].start + .05;
    const index = branches.push(item) - 1;
    if (depth === 6) {
      tips.push({ x: ex, y: ey, angle, index });
      for (let j = 0; j < 5; j++) {
        const along = .46 + j * .135;
        const pt = bezier(item, along);
        leaves.push({ x: pt.x, y: pt.y, angle: angle + (j % 2 ? 1 : -1) * (.55 + random() * .65), size: 15 + random() * 14, born: .60 + random() * .22, tint: random() });
      }
      return;
    }
    const spread = depth === 0 ? [-.58, .05, .65] : [-.36 - random() * .18, .3 + random() * .24];
    for (const turn of spread) {
      const nextAngle = clamp(angle + turn, -Math.PI + .18, -.18);
      makeBranch(ex, ey, length * (.67 + random() * .095), nextAngle, width * .63, depth + 1, index);
    }
  }
  function bezier(b, t) {
    const a = 1 - t;
    return { x: a*a*a*b.x + 3*a*a*t*b.c1x + 3*a*t*t*b.c2x + t*t*t*b.ex,
      y: a*a*a*b.y + 3*a*a*t*b.c1y + 3*a*t*t*b.c2y + t*t*t*b.ey };
  }
  makeBranch(0, 0, 280, -Math.PI / 2 + .03, 27, 0);
  const mainTip = tips.reduce((best, t) => Math.hypot(t.x - 95, t.y + 690) < Math.hypot(best.x - 95, best.y + 690) ? t : best);
  const sceneDepth = Math.abs(Math.min(...tips.map(t => t.y)));
  const rightExtent = Math.max(...tips.map(t => t.x)) + 45;
  for (const b of branches.filter(b => b.depth === 4 || b.depth === 5)) {
    for (let j = 0; j < 5; j++) {
      const pt = bezier(b, .42 + j * .14);
      leaves.push({ x: pt.x, y: pt.y, angle: Math.atan2(b.ey-b.y,b.ex-b.x) + (j%2?1:-1)*(.6+random()*.8), size: 19+random()*13, born: .65+random()*.17, tint: random() });
    }
  }
  function palette(a, b, t) { return `rgb(${a.map((v, i) => Math.round(mix(v, b[i], t))).join(',')})`; }
  function glow(x, y, radius, alpha = 1) {
    if (alpha <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(255,236,186,${alpha * .6})`);
    g.addColorStop(.15, `rgba(240,210,150,${alpha * .22})`);
    g.addColorStop(1, 'rgba(226,198,140,0)');
    ctx.fillStyle = g; ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
  }
  function star(x, y, r, alpha, cross = false) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ece2c9'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    if(cross){ctx.strokeStyle='#e9d3a4';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x-r*4,y);ctx.lineTo(x+r*4,y);ctx.moveTo(x,y-r*4);ctx.lineTo(x,y+r*4);ctx.stroke();}
    ctx.globalAlpha = 1;
  }
  function leaf(x, y, angle, size, growth, tint, special = false) {
    if(growth <= .002) return;
    ctx.save(); ctx.translate(x,y); ctx.rotate(angle);
    const length = size * (.25 + .75 * growth);
    const breadth = size * .32 * growth;
    ctx.globalAlpha = growth * (special ? 1 : .86);
    ctx.fillStyle = special ? '#d5c083' : palette([88,122,91],[176,181,111],tint);
    ctx.beginPath();ctx.moveTo(0,0);ctx.bezierCurveTo(length*.25,-breadth,length*.75,-breadth*.85,length,0);ctx.bezierCurveTo(length*.65,breadth*.85,length*.22,breadth,0,0);ctx.fill();
    ctx.strokeStyle=special?'rgba(80,96,57,.7)':'rgba(44,73,51,.38)';ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(length*.48,-breadth*.08,length*.91,0);ctx.stroke();
    ctx.restore();
  }
  function scene(p) {
    const started = performance.now();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const dawn = smooth(phase(p,.60,1));
    const bg=ctx.createLinearGradient(0,0,0,h);
    bg.addColorStop(0,palette([9,19,28],[17,36,35],dawn));
    bg.addColorStop(.63,palette([15,31,38],[39,61,51],dawn));
    bg.addColorStop(1,palette([23,43,46],[105,111,77],dawn));
    ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    for(const s of stars){const y=(s.y-p*.32)*h;if(y>-5&&y<h+5)star(s.x*w,y,s.r,s.a*(1-dawn*.65));}
    const mobile=w<760;
    const labelOpacity=phase(p,0,.045)*(1-phase(p,.25,.40));
    for(const c of concepts){
      const x=c.x*w,y=(c.y-p*.22)*h;
      const a=c.hero?1:1-phase(p,.28,.48);
      if(c.hero)glow(x,y,27+phase(p,.12,.27)*17,.65*(1-dawn*.7));
      star(x,y,c.hero?2.2:1.3,.85*a,true);
      const alpha = c.hero ? Math.max(.4,labelOpacity)*(1-phase(p,.43,.52)) : labelOpacity;
      if(alpha>.01){ctx.globalAlpha=alpha;ctx.fillStyle=c.hero?'#e7d0a0':'#aebfb9';ctx.font=`${c.hero?13:11}px "Microsoft YaHei",sans-serif`;ctx.fillText(c.name,x+13,y+4);ctx.globalAlpha=1;}
    }
    const camera=smooth(phase(p,.68,.99));
    const rise=smooth(phase(p,.13,.43));
    const scaleBase=Math.min(w/(mobile?970:1320),h/930);
    const fitScale=Math.min(h*.69/(sceneDepth+35),w*(mobile?.34:.275)/rightExtent);
    const scale=mix(scaleBase*1.13,fitScale,camera);
    const rootX=w*(mobile?.62:.69);
    const rootY=h*mix(mix(1.73,1.24,rise),.84,camera);
    const ground=phase(p,.78,.98);
    if(ground>0){
      ctx.save();ctx.globalAlpha=ground;
      const y=rootY+8*scale;
      const g=ctx.createLinearGradient(0,y,0,h);g.addColorStop(0,'#334936');g.addColorStop(1,'#172d28');ctx.fillStyle=g;
      ctx.beginPath();ctx.moveTo(0,y+28);ctx.bezierCurveTo(w*.23,y-18,w*.42,y+24,rootX,y);ctx.bezierCurveTo(w*.84,y-14,w*.92,y+10,w,y-9);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fill();
      ctx.strokeStyle='rgba(202,202,140,.15)';ctx.lineWidth=1;
      for(let i=0;i<34;i++){const x=w*(i/34),gy=y+15+Math.sin(i*3.1)*12;ctx.beginPath();ctx.moveTo(x,gy+9);ctx.quadraticCurveTo(x-3,gy+1,x-5,gy-5);ctx.stroke();}
      ctx.restore();
    }
    ctx.save();ctx.translate(rootX,rootY);ctx.scale(scale,scale);
    for(const b of branches){
      const t=smooth(phase(p,b.start,b.start+.05));if(t<=0)continue;
      ctx.beginPath();ctx.moveTo(b.x,b.y);
      const segments=Math.ceil(15*t);
      for(let i=1;i<=segments;i++){const point=bezier(b,t*i/segments);ctx.lineTo(point.x,point.y);}
      ctx.strokeStyle=palette([135,143,112],[176,164,119],b.depth/6);ctx.lineWidth=b.width;ctx.lineCap='round';ctx.stroke();
      if(b.depth<3){ctx.strokeStyle='rgba(219,205,159,.2)';ctx.lineWidth=Math.max(.5,b.width*.14);ctx.stroke();}
    }
    if(ground>0){
      ctx.globalAlpha=ground*.7;ctx.strokeStyle='#9d9f74';
      for(let i=0;i<7;i++){const sign=i%2?1:-1;ctx.lineWidth=6-i*.6;ctx.beginPath();ctx.moveTo(0,-8);ctx.bezierCurveTo(sign*25,12,sign*(35+i*10),15,sign*(65+i*13),30+i*2);ctx.stroke();}
      ctx.globalAlpha=1;
    }
    for(const l of leaves)leaf(l.x,l.y,l.angle,l.size,smooth(phase(p,l.born,l.born+.11)),l.tint);
    const mainGrowth=smooth(phase(p,.48,.60));
    leaf(mainTip.x,mainTip.y,mainTip.angle+.55,46,mainGrowth,.7,true);
    ctx.restore();
    const tip={x:rootX+mainTip.x*scale,y:rootY+mainTip.y*scale};
    const transfer=phase(p,.30,.47);
    if(transfer>0&&transfer<1){
      const source={x:concepts[0].x*w,y:(concepts[0].y-p*.22)*h};
      const path={x:source.x,y:source.y,c1x:source.x+60*scale,c1y:source.y+100*scale,c2x:tip.x+50*scale,c2y:tip.y-80*scale,ex:tip.x,ey:tip.y};
      ctx.beginPath();ctx.moveTo(source.x,source.y);
      for(let i=1;i<=28;i++){const pt=bezier(path,transfer*i/28);ctx.lineTo(pt.x,pt.y);}
      ctx.strokeStyle=`rgba(224,204,152,${.3*Math.sin(transfer*Math.PI)})`;ctx.lineWidth=1;ctx.stroke();
      const light=bezier(path,smooth(transfer));glow(light.x,light.y,26,.8);star(light.x,light.y,2,1,true);
    }
    if(p>.42&&p<.75){glow(tip.x,tip.y,31,(1-phase(p,.57,.75))*.6);}
    if(p>.5&&p<.80&&!mobile){ctx.fillStyle=`rgba(220,214,180,${phase(p,.5,.55)*(1-phase(p,.73,.8))})`;ctx.font='11px "Microsoft YaHei",sans-serif';ctx.fillText('沉没成本 · 我的理解',tip.x+16,tip.y-18);}
    shade.style.opacity=String(phase(p,.07,.17)*(.9-dawn*.25));
    stats.progress=Number(p.toFixed(4));stats.frames++;stats.branchCount=branches.length;stats.leafCount=leaves.length+1;stats.treeHeight=Math.round(sceneDepth*scale);
    stats.renderMs.push(performance.now()-started);if(stats.renderMs.length>180)stats.renderMs.shift();
  }
  function setStage(index){
    if(index===active)return;active=index;
    nav.forEach((a,i)=>i===index?a.setAttribute('aria-current','step'):a.removeAttribute('aria-current'));
    stageName.textContent=steps[index].dataset.name;stats.stage=index;
  }
  function readScroll(){
    target=clamp(window.scrollY/scrollRange);
    const marker=scrollY+h*.5;
    let index=0;for(let i=0;i<sectionTops.length;i++)if(marker>=sectionTops[i])index=i;
    setStage(index);requestDraw();
  }
  function requestDraw(){if(!frame&&!document.hidden)frame=requestAnimationFrame(draw);}
  function draw(){
    frame=0;if(document.hidden)return;
    if(reduced){current=target;scene(1);stats.progress=Number(target.toFixed(4));return;}
    current=Math.abs(current-target)>.001?mix(current,target,.2):target;
    scene(current);
    if(Math.abs(current-target)>.0001)requestDraw();
  }
  function setupChapters(){
    if(scroller)scroller.destroy();
    if(typeof window.scrollama==='function')scroller=window.scrollama().setup({step:steps,offset:Math.round(h*.5)+'px',progress:false}).onStepEnter(({index})=>setStage(index));
  }
  function resize(){
    w=innerWidth;h=innerHeight;dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    sectionTops=steps.map(s=>s.getBoundingClientRect().top+scrollY);
    scrollRange=Math.max(1,document.documentElement.scrollHeight-h);
    setupChapters();readScroll();
  }
  function setReduced(value){reduced=value;stats.reduced=value;document.documentElement.dataset.reduced=String(value);motion.setAttribute('aria-pressed',String(value));motion.textContent=value?'恢复动态':'减少动态';current=target;requestDraw();}
  motion.addEventListener('click',()=>{manualMotion=true;setReduced(!reduced);});
  preference.addEventListener('change',e=>{if(!manualMotion)setReduced(e.matches);});
  addEventListener('scroll',readScroll,{passive:true});
  addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(resize,180);},{passive:true});
  addEventListener('pageshow',()=>{resize();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else readScroll();});
  document.querySelectorAll('.choice').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('.choice').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    document.querySelector('.choice-feedback').textContent=button.dataset.choice==='future'?'这次，你把注意力放在了未来。已经等过的时间无法收回；接下来是否值得，才是判断的依据。':'已经等过的时间无法收回。试着把它放在一边：还要等多久，等待的收获又是什么？';
  }));
  document.querySelector('#download-demo').addEventListener('click',()=>{document.querySelector('#download-note').textContent='这是官网视觉原型。正式安装包与平台说明将在确认方案后接入。';});
  if(location.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(location.hostname))document.querySelector('.prototype-bar').hidden=true;
  setReduced(reduced);resize();
})();
