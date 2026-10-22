export const validAccent = value => /^#[\da-f]{6}$/i.test(value||'');
const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const mix = (a,b,t) => '#'+rgb(a).map((n,i)=>Math.round(n+(rgb(b)[i]-n)*t).toString(16).padStart(2,'0')).join('');
const light = hex => rgb(hex).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
export const contrast = (a,b) => (Math.max(light(a),light(b))+.05)/(Math.min(light(a),light(b))+.05);
export function accentPalette(seed,dark=false) {
  if(!validAccent(seed))throw Error('请输入六位十六进制色码，例如 #C6613F。');
  const surface=dark?'#242422':'#fcfcfb';let accent=seed;
  for(let i=0;i<=100;i++){const next=mix(seed,dark?'#ffffff':'#000000',i/100);if(contrast(next,surface)>=4.5){accent=next;break;}}
  const ink=contrast(accent,'#000000')>contrast(accent,'#ffffff')?'#000000':'#ffffff';
  return {accent,ink,hover:mix(accent,ink==='#ffffff'?'#000000':'#ffffff',.12)};
}
