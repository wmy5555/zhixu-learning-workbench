import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCaptureFiles,saveCaptureOriginal} from '../public/web/capture-files.mjs';
import {prepareTexts} from '../public/web/batch-import.mjs';
const file=(name,size=12,type='')=>({name,size,type});
test('unified picker routes text and every existing original format without widening the allowlist',()=>{
 assert.equal(classifyCaptureFiles([file('note.MD')]).texts.length,1);
 for(const ext of ['png','jpg','jpeg','gif','webp','pdf','doc','docx'])assert.equal(classifyCaptureFiles([file('原件.'+ext)]).originals.length,1);
 assert.throws(()=>classifyCaptureFiles([file('run.exe')]),/暂不支持/);
 assert.throws(()=>classifyCaptureFiles([file('image.png',12,'application/pdf')]),/不一致/);
});
test('invalid selection is rejected before reading or uploading, including folders, mixtures and limits',()=>{
 for(const files of [[file('ok.md'),file('bad.zip')],[file('a.md'),file('a.pdf')],[file('empty.txt',0)],[file('large.md',2097153)],[file('large.pdf',50000001)],[{...file('nested.pdf'),webkitRelativePath:'folder/nested.pdf'}],Array.from({length:21},()=>file('a.pdf'))])assert.throws(()=>classifyCaptureFiles(files));
 assert.equal(classifyCaptureFiles([file('limit.pdf',50000000)]).originals.length,1);
 assert.deepEqual(classifyCaptureFiles([]),{texts:[],originals:[]});
});
test('text validation still rejects empty bodies and excess characters for the single-file path',async()=>{
 await assert.rejects(prepareTexts([{...file('a.txt'),text:async()=>''}]),/字符/);
 await assert.rejects(prepareTexts([{...file('a.txt'),text:async()=>'字'.repeat(500001)}]),/字符/);
 const [row]=await prepareTexts([{...file('a.md'),text:async()=>'# 原文\n\n保持段落。'}]);assert.equal(row.body,'# 原文\n\n保持段落。');
});
test('import retry reuses upload identity and completed original is not saved twice',async()=>{
 let uploads=0,imports=0;const row={file:file('a.pdf'),uploadId:'synthetic-upload'};
 const api={upload:async(f,id)=>{uploads++;assert.equal(id,'synthetic-upload');},post:async(p,b)=>{imports++;assert.equal(p,'/api/file-import');assert.deepEqual(b,{uploadId:'synthetic-upload'});if(imports===1)throw Error('temporary');return {note:{id:'synthetic-note'}};}};
 await assert.rejects(saveCaptureOriginal(row,api),/temporary/);await saveCaptureOriginal(row,api);await saveCaptureOriginal(row,api);assert.equal(uploads,1);assert.equal(imports,2);
});
