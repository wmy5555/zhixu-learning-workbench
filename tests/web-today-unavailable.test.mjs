import test from 'node:test';import assert from 'node:assert/strict';
import {groupUnavailable,unavailableHTML,unavailableRows} from '../public/web/today-unavailable.mjs';
test('groups by stable server code, preserves every item and unknown reasons without parsing prose',()=>{
 const items=[{noteId:'one',code:'not_due',reason:'date invalid'},{noteId:'two',code:'stage',reason:'same'},{noteId:'three',code:'stage',reason:'same'},{noteId:'four',code:'new_code',reason:'unknown retained'}];
 const before=JSON.stringify(items),groups=groupUnavailable(items);assert.deepEqual(groups.map(g=>[g.code,g.items.length]),[['stage',2],['not_due',1],['other',1]]);assert.equal(groups.flatMap(g=>g.items).length,items.length);assert.equal(groups[2].items[0].reason,'unknown retained');assert.equal(JSON.stringify(items),before);
});
test('shared explanations appear once while differing dates and restrictions remain complete',()=>{
 const shared=groupUnavailable([{noteId:'1',title:'一',code:'stage',reason:'共同原因'},{noteId:'2',title:'二',code:'stage',reason:'共同原因'}])[0];assert.equal(unavailableRows(shared).split('共同原因').length-1,1);
 const dates=groupUnavailable([{noteId:'3',code:'not_due',reason:'2026-10-23（Asia/Shanghai）'},{noteId:'4',code:'not_due',reason:'无效复习时间'}])[0];const html=unavailableRows(dates);assert.match(html,/Asia\/Shanghai/);assert.match(html,/无效复习时间/);
});
test('closed overview does not render the long list; rows are bounded and escape all source text',()=>{
 const items=Array.from({length:1000},(_,i)=>({noteId:`id-${i}`,title:'<img onerror=bad>',code:'stage',reason:'<script>bad</script>'}));const groups=groupUnavailable(items);
 assert.equal((unavailableHTML(items).match(/<li>/g)||[]).length,0);assert.equal((unavailableRows(groups[0]).match(/<li>/g)||[]).length,5);assert.equal((unavailableRows(groups[0],10).match(/<li>/g)||[]).length,10);assert.doesNotMatch(unavailableRows(groups[0]),/<script>|<img/);assert.match(unavailableRows(groups[0]),/data-route="read\/id-0"/);assert.equal(unavailableHTML([]),'');
});
