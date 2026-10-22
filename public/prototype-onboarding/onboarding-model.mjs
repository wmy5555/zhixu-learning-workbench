export function intersection(a,b){return Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));}
export function sidePosition(target,{width,height,top=76,bottom=height-20},obstacles=[],previous){
 const size=44,gap=16,clamp=p=>({x:Math.max(12,Math.min(width-size-12,p.x)),y:Math.max(top,Math.min(bottom-size,p.y)),w:size,h:size});
 const candidates=[{x:target.x+target.w+gap,y:target.y+target.h/2-size/2},{x:target.x-gap-size,y:target.y+target.h/2-size/2},{x:target.x+target.w/2-size/2,y:target.y-gap-size},{x:target.x+target.w/2-size/2,y:target.y+target.h+gap}].map(clamp);
 const score=p=>intersection(p,target)*100+obstacles.reduce((n,r)=>n+intersection(p,r),0)*20;
 candidates.sort((a,b)=>score(a)-score(b));
 if(previous&&score(clamp(previous))===0&&Math.hypot(previous.x-candidates[0].x,previous.y-candidates[0].y)<80)return clamp(previous);
 return candidates[0];
}
