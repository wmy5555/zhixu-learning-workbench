import test from 'node:test';import assert from 'node:assert/strict';import {markdown} from '../public/web/markdown.mjs';
import {discoveryFindings,discoveryMarkdown} from '../src/discovery-guidance.mjs';
test('report citations allow only canonical knowledge read routes, preserving external URL safety',()=>{const id='648da3f6-bc54-460c-b756-9e28ee038d6d';const valid=markdown(`[材料](#read/${id})`).html;assert.match(valid,new RegExp(`href="#read/${id}"`));assert.doesNotMatch(valid,/target=/);for(const target of ['#settings','#read/../../settings','#read/not-an-id','javascript:alert','file:///secret'])assert.doesNotMatch(markdown(`[拒绝](${target})`).html,/<a\s/);assert.match(markdown('[来源](https://example.com)').html,/rel="noopener noreferrer"/);});

test('validated discovery quotes and citation labels render literal punctuation without losing safe links',()=>{
 const quote='user_name [index] `x` **条件** <tag> \\_literal';
 const materials=[{id:'648da3f6-bc54-460c-b756-9e28ee038d6d',title:'数组[索引]_学习',summary:quote,sourceIds:['one']},{id:'658da3f6-bc54-460c-b756-9e28ee038d6d',title:'[伪链接](javascript:boom)<script>',summary:'对照原文里的实际记录',sourceIds:['two']}];
 const result=discoveryFindings({findings:[{type:'comparison',title:'核对两条记录',insight:'相似表述需要核对',task:'分别回到原文',boundary:'仅为练习建议',evidence:materials.map(n=>({noteId:n.id,quote:n.summary}))}]},materials);
 assert.equal(result.findings.length,1);const html=markdown(discoveryMarkdown(result)).html;
 assert.ok(html.includes(`href="#read/${materials[0].id}">数组[索引]_学习</a>`));
 assert.ok(html.includes('：“user_name [index] `x` **条件** &lt;tag&gt; \\_literal”'));
 assert.ok(html.includes(`href="#read/${materials[1].id}">[伪链接](javascript:boom)&lt;script&gt;</a>`));
 assert.doesNotMatch(html,/<(?:script|img|code|strong)\b|href="javascript:/);
 assert.equal(markdown('`user\\_name`').html,'<p><code>user\\_name</code></p>');
});
