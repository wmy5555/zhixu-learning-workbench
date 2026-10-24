import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [source, base, output] = process.argv.slice(2).map(p=>path.resolve(p));
if(!source||!base||!output)throw Error('source, base payload and output required');
const stage=path.join(output,'target'), delta=path.join(output,'delta');
if(fs.existsSync(stage)||fs.existsSync(delta))throw Error('Use a fresh output directory');
fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(delta,{recursive:true});
const git=(...a)=>execFileSync('git',['-c',`safe.directory=${source}`,'-C',source,...a],{encoding:'utf8'}).trim();
if(git('status','--porcelain=v1','--untracked-files=no'))throw Error('Source must be committed');
const sourceSha=git('rev-parse','HEAD'),sourceTree=git('rev-parse','HEAD^{tree}');
const files=git('ls-files','-z').split('\0').filter(p=>p.startsWith('src/')||p.startsWith('public/')||['package.json','pnpm-lock.yaml'].includes(p));
for(const p of files){const dest=path.join(stage,p);fs.mkdirSync(path.dirname(dest),{recursive:true});const f=path.join(source,p);if(fs.lstatSync(f).isSymbolicLink())throw Error('Source link '+p);fs.copyFileSync(f,dest);}
const roots=['@modelcontextprotocol/sdk','yaml','zod','mammoth','yauzl','filepond','filepond-plugin-file-validate-size','filepond-plugin-file-validate-type','filepond-plugin-image-preview'];
const global=new Map(),inventory=[],placed=new Map();
function find(name,start){let p=start;for(;;){const f=path.join(p,'node_modules',name,'package.json');if(fs.existsSync(f))return fs.realpathSync(path.dirname(f));const next=path.dirname(p);if(p===next)throw Error('Missing '+name+' from '+start);p=next;}}
function add(name,real,parent,ancestors=new Map()){
  if(ancestors.get(name)===real||global.get(name)===real&&!ancestors.has(name))return;
  const nested=global.has(name),dest=path.join(nested?parent:stage,'node_modules',name);
  if(placed.get(dest)===real)return;
  if(!nested)global.set(name,real);
  if(fs.existsSync(dest))throw Error('Dependency collision '+dest);
  placed.set(dest,real);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.cpSync(real,dest,{recursive:true,dereference:false,filter:p=>path.relative(real,p).split(path.sep)[0]!=='node_modules'});
  const pkg=JSON.parse(fs.readFileSync(path.join(real,'package.json')));
  const notices=fs.readdirSync(real).filter(n=>(/^(licen[cs]e|copying|notice|copyright)(\.|$|-)/i.test(n)||/^readme/i.test(n)&&/permission is hereby granted|redistribution and use/i.test(fs.readFileSync(path.join(real,n),'utf8')))&&fs.statSync(path.join(real,n)).isFile());
  inventory.push({name:pkg.name,version:pkg.version,license:pkg.license,location:path.relative(stage,dest).replaceAll('\\','/'),notices});
  const next=new Map(ancestors);next.set(name,real);
  const deps={...pkg.dependencies,...pkg.optionalDependencies};
  for(const dep of Object.keys(deps)){try{add(dep,find(dep,real),dest,next);}catch(e){if(!pkg.optionalDependencies?.[dep])throw e;}}
  for(const dep of Object.keys(pkg.peerDependencies||{})){try{add(dep,find(dep,real),dest,next);}catch(e){if(!pkg.peerDependenciesMeta?.[dep]?.optional)throw e;}}
}
for(const n of roots)add(n,find(n,source),stage);
fs.cpSync(path.join(base,'runtime'),path.join(stage,'runtime'),{recursive:true});
for(const name of ['portable-server.mjs','使用说明.txt'])fs.copyFileSync(path.join(base,name),path.join(stage,name));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const resources=files.filter(p=>p.startsWith('public/')).map(p=>({file:p.slice(7),sha256:sha(fs.readFileSync(path.join(stage,p)))}));
const manifest={format:1,version:'2026.10.23.1',sourceSha,sourceTree,node:JSON.parse(fs.readFileSync(path.join(base,'package-manifest.json'))).node,platform:'win32-x64',builtAt:new Date().toISOString(),resources,packages:inventory};
fs.writeFileSync(path.join(stage,'package-manifest.json'),JSON.stringify(manifest,null,2));
let text='THIRD-PARTY NOTICES\n\nNode.js: runtime/LICENSE (includes bundled components).\n\n';
for(const p of inventory){text+=`${p.name}@${p.version} (${p.license})\n`;for(const n of p.notices)text+=fs.readFileSync(path.join(stage,p.location,n),'utf8')+'\n';text+='\n';}
text+='Browser editor notices: public/vendor/vditor/; tutorial notices: public/tutorial-examples/SOURCE-LICENSES.txt.\nThe project owner has not selected a public project license. This package does not add one.\n';
fs.writeFileSync(path.join(stage,'THIRD-PARTY-NOTICES.txt'),text);
function scan(root,relative=''){
 const out=[];
 for(const item of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
  const p=relative?relative+'/'+item.name:item.name;
  if(item.isSymbolicLink())throw Error('Payload must not contain links: '+p);
  if(item.isDirectory())out.push(...scan(root,p));else if(item.isFile()){
   if(/(^|\/)(\.data|vault|\.env|\.git)(\/|$)|\.(sqlite|db|pem|pfx|key)$/i.test(p))throw Error('Private payload file '+p);
   out.push({path:p,sha256:sha(fs.readFileSync(path.join(root,p)))});
  }
 }
 return out.sort((a,b)=>a.path.localeCompare(b.path));
}
const baseFiles=scan(base),targetFiles=scan(stage),baseHashes=new Map(baseFiles.map(x=>[x.path,x.sha256]));
const deltaFiles=targetFiles.filter(x=>x.sha256!==baseHashes.get(x.path));
for(const entry of deltaFiles){const dest=path.join(delta,entry.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(stage,entry.path),dest);}
const old=JSON.parse(fs.readFileSync(path.join(base,'package-manifest.json')));
const info={format:1,version:manifest.version,baseSourceSha:old.sourceSha,targetSourceSha:sourceSha,targetSourceTree:sourceTree,basePayloadHash:'cbedaeaebd14fa64a6bacad38c23595adb26b2f7511009e12d9d8c6ef1f4740c',baseExeSha256:'082bd7451331a9f714b08599a4469a6a0b82d41ce4710b672dd9e9094253bfda',baseFiles,targetFiles,deltaFiles};
fs.writeFileSync(path.join(output,'update.json'),JSON.stringify(info,null,2));
fs.writeFileSync(path.join(output,'package-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({base:old.sourceSha,target:sourceSha,baseFiles:baseFiles.length,targetFiles:targetFiles.length,changed:deltaFiles.length,removed:baseFiles.filter(x=>!targetFiles.some(t=>t.path===x.path)).length,deltaBytes:deltaFiles.reduce((n,x)=>n+fs.statSync(path.join(delta,x.path)).size,0)}));