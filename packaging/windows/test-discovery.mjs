import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [exe,oldExe,output]=process.argv.slice(2).map(p=>path.resolve(p));
const root=path.join(output,'新用户 定位验收-'+Date.now()),home=path.join(root,'不同用户的本地应用目录'),custom=path.join(root,'自选资料目录');
const hash='cbedaeaebd14fa64a6bacad38c23595adb26b2f7511009e12d9d8c6ef1f4740c',key=hash.slice(0,20);
fs.mkdirSync(root,{recursive:true});let number=0;
function locate(args=[],success=true){const file=path.join(root,'result-'+number+++'.json');const r=spawnSync(exe,['--portable-home',home,'--locate-only','--status-file',file,...args],{windowsHide:true,timeout:120000});assert.equal(r.status,success?0:1,r.error?.message);return JSON.parse(fs.readFileSync(file,'utf8'));}
assert.deepEqual(locate().locations,[]);
const app=path.join(home,'versions',key);fs.mkdirSync(app,{recursive:true});fs.writeFileSync(path.join(app,'.complete'),hash);
let found=locate().locations;assert.equal(found.length,1);assert.equal(found[0].Data,path.join(home,'data'));assert.equal(found[0].Custom,null);assert.equal(found[0].App,app);
const other=path.join(custom,'.app','versions',key);fs.mkdirSync(other,{recursive:true});fs.writeFileSync(path.join(other,'.complete'),hash);
for(const folder of [custom,other]){found=locate(['--select-folder',folder]).locations;assert.equal(found[0].App,other);assert.equal(found[0].Data,custom);assert.equal(found[0].Custom,custom);}
assert.equal(locate(['--data-dir',custom]).locations[0].Data,custom);
const wrong=path.join(root,'不是知序.exe');fs.writeFileSync(wrong,'synthetic wrong program');assert.match(locate(['--original-exe',wrong],false).message,/不是此更新包支持/);
// A user with the old EXE but no extracted cache can bootstrap only application
// resources, without launching a scheduler or creating any personal data.
const firstHome=path.join(root,'从未运行旧版的用户');const report=path.join(root,'first-run.json');
const run=spawnSync(exe,['--portable-home',firstHome,'--original-exe',oldExe,'--locate-only','--status-file',report],{windowsHide:true,timeout:180000});assert.equal(run.status,0,run.error?.message);
const first=JSON.parse(fs.readFileSync(report));assert.equal(first.locations[0].App,path.join(firstHome,'versions',key));assert.ok(!fs.existsSync(path.join(firstHome,'data')));
assert.equal(fs.readFileSync(path.join(first.locations[0].App,'.complete'),'utf8'),hash);
const result={status:'passed',checks:['missing-old-program-no-target','different-user-home-auto-detection','custom-data-folder','direct-cache-folder','explicit-custom-data','wrong-exe-refused','old-exe-never-launched-bootstrap','no-personal-data-created'],root};
fs.writeFileSync(path.join(output,'discovery-test-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
