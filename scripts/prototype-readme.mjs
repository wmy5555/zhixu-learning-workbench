// Throwaway README UI prototype: three information architectures on /?variant=A|B|C.
// Run directly to generate offline files; pnpm prototype:readme serves only these public artifacts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'node:http';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(resolve(root, 'README.PROTOTYPE.md'), 'utf8').replaceAll('\r\n', '\n');
const chunks = source.split(/(?=^## )/m);
const section = title => chunks.find(text => text.startsWith(`## ${title}\n`))?.trim() ?? '';
const content = title => section(title).replace(/^## [^\n]+\n+/, '');
const intro = chunks[0].replace(/^<!--[\s\S]*?-->\s*/, '').trim();
const introOnly = intro.replace(/\n\[快速开始\][\s\S]*$/, '');
const slug = value => value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const toc = headings => `## 目录\n\n${headings.map(h => `- [${h}](#${slug(h)})`).join('\n')}`;
const start = content('快速开始')
  .replace('网页版直接运行，无需构建；无需安装 Codex 或 Obsidian。', '网页版直接运行，无需构建。')
  .replace('网页版直接运行，无需构建；', '网页版直接运行，无需构建。');
const steps = [
  ['01 · 收集', '保存原文与出处。读书摘录、课程笔记、网页材料和 AI 对话先留在原始资料中，随时可以回看。'],
  ['02 · 整理', '按需让 AI 拆解概念、主张、方法和问题。主动联网核验时，阅读证据、分歧与适用条件，再决定哪些内容值得继续学习。'],
  ['03 · 选择', '只需未来查找的材料留作参考，尚未决定的内容进入候选；希望消化的知识再加入学习安排。'],
  ['04 · 理解', '亲自解释和作答，记录反馈与修正，再确认自己的理解。自己的回答、AI 建议和最终确认内容分别保存。'],
  ['05 · 复习与应用', '回到到期知识，修正误解。需要写作、推进项目或做决策时，检索材料、回看来源，再带着引用形成输出。'],
];
const flow = steps.map(([name, text]) => `### ${name}\n\n${text}`).join('\n\n');
const technicalStart = start.split(/^### /m);
const startDetails = technicalStart[0].trim() + '\n\n' + technicalStart.slice(1).map(chunk => {
  const at = chunk.indexOf('\n');
  return `<details>\n<summary>${chunk.slice(0, at)}</summary>\n\n${chunk.slice(at + 1).trim()}\n\n</details>`;
}).join('\n\n');
const development = content('文档与开发');
const docsTable = development.split('\n\n主要技术栈：')[0];
const devCommands = '主要技术栈：' + development.split('\n\n主要技术栈：')[1];
const notice = key => `<!-- README UI 原型 ${key}，仅供比较；不替换正式 README，不加入许可证、图片或图片徽章。 -->`;
const variants = [
  {
    key: 'A', name: '上手优先', disclosure: '全文展开',
    hypothesis: '先把项目运行起来，再逐步了解功能。',
    tradeoff: '上手路径最短，学习方法需要继续向下阅读。',
    seed: 'c3dd7e99-c2aa-4870-96a0-429092c94d1257e4f1b4-d082-4c14-be07-650cc9e5ec2a',
    order: ['快速开始', '知序能做什么', '走完一条学习流程', 'AI 与隐私', '当前状态', '文档与开发', '参与贡献'],
    markdown: `${notice('A')}\n\n${intro}\n\n${toc(['快速开始', '知序能做什么', '走完一条学习流程', 'AI 与隐私', '当前状态', '文档与开发', '参与贡献'])}\n\n## 快速开始\n\n${start}\n\n${section('知序能做什么')}\n\n${section('走完一条学习流程')}\n\n${section('AI 与隐私')}\n\n${section('当前状态')}\n\n${section('文档与开发')}\n\n${section('参与贡献')}\n`,
  },
  {
    key: 'B', name: '学习路线', disclosure: '全文展开',
    hypothesis: '先让读者看见一条资料如何变成自己的理解。',
    tradeoff: '学习目标更鲜明，安装命令出现在学习路线之后。',
    seed: 'edf0771a-0678-4b9a-ba49-4313ea492d169e7dd93a-086b-446c-9489-dca6e2bace72',
    order: ['一条资料的旅程', '三种内容，各有位置', '启动知序', '知序能做什么', 'AI 与隐私', '文档与开发', '当前状态', '参与贡献'],
    markdown: `${notice('B')}\n\n${introOnly}\n\n[跟着做一遍](docs/ONBOARDING.md) · [启动知序](#启动知序) · [更新记录](CHANGELOG.md) · [CI 检查](https://github.com/wmy5555/zhixu-learning-workbench/actions/workflows/ci.yml)\n\n## 一条资料的旅程\n\n${flow}\n\n想跟着操作，可以从今日页或帮助入口开始新手引导。引导在独立练习库中进行；教程中的 AI 请求仍使用真实服务与预算，可能产生费用。完整步骤见 [新手实操说明](docs/ONBOARDING.md)。\n\n## 三种内容，各有位置\n\n| 保存什么 | 留住什么 |\n| --- | --- |\n| 原始资料 | 实际收到的原文、出处与上下文。 |\n| 结构化材料 | 拆解得到的概念、主张、方法与问题，连同证据和限制。 |\n| 个人理解 | 你自己的解释、应用与最终确认内容。 |\n\n保存不代表学会，AI 生成也不代表你已经理解。不是每条材料都需要进入学习队列。\n\n## 启动知序\n\n${start}\n\n${section('知序能做什么')}\n\n${section('AI 与隐私')}\n\n${section('文档与开发')}\n\n${section('当前状态')}\n\n${section('参与贡献')}\n`,
  },
  {
    key: 'C', name: '任务索引', disclosure: '技术细节折叠',
    hypothesis: '让读者按眼前要做的事进入文档，减少通读成本。',
    tradeoff: '查找与回访更快，首次了解学习理念的叙事较少。',
    seed: '5c11d909-976a-4089-9d15-13c47a9e36edf2a1dbcd-c4bd-4039-958e-e5e943b7ecb6',
    order: ['按目的找到入口', '目录', '功能一览', '安装与运行', '学习流程', 'AI 与隐私', '当前状态', '开发与贡献'],
    markdown: `${notice('C')}\n\n${introOnly}\n\n## 按目的找到入口\n\n| 现在想做什么 | 直接进入 |\n| --- | --- |\n| 第一次运行知序 | [安装与运行](#安装与运行) |\n| 跟着材料体验学习 | [新手引导](docs/ONBOARDING.md) |\n| 查找某个操作 | [使用指南](public/guide.html) |\n| 设置模型、搜索或向量 | [服务配置](docs/PROVIDERS.md) |\n| 理解保存、外发与费用 | [AI 与隐私](#ai-与隐私) |\n| 查看近期变化与项目检查 | [更新记录](CHANGELOG.md) · [CI 检查](https://github.com/wmy5555/zhixu-learning-workbench/actions/workflows/ci.yml) |\n\n${toc(['功能一览', '安装与运行', '学习流程', 'AI 与隐私', '当前状态', '开发与贡献'])}\n\n## 功能一览\n\n${content('知序能做什么')}\n\n## 安装与运行\n\n${startDetails}\n\n## 学习流程\n\n${content('走完一条学习流程')}\n\n${section('AI 与隐私')}\n\n${section('当前状态')}\n\n## 开发与贡献\n\n${docsTable}\n\n<details>\n<summary>技术栈与验证命令</summary>\n\n${devCommands}\n\n</details>\n\n${content('参与贡献')}\n`,
  },
];

const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const repo = 'https://github.com/wmy5555/zhixu-learning-workbench/blob/feat/prototype-readme-20261024/';
function link(raw) {
  const value = raw.replaceAll('&amp;', '&');
  if (/^(?:https?:|#)/i.test(value)) return escape(value);
  if (/^[\w./-]+(?:#[\p{L}\p{N}_-]+)?$/u.test(value)) return escape(repo + value);
  return '#';
}
function inline(value) {
  const code = [];
  let html = escape(value).replace(/`([^`]+)`/g, (_, text) => `\u0000${code.push(`<code>${text}</code>`) - 1}\u0000`);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${link(href)}">${label}</a>`);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => code[Number(index)]);
}
function render(markdown) {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      out.push(`<pre><code class="language-${escape(language)}">${escape(body.join('\n'))}</code></pre>`); i++; continue;
    }
    if (/^<\/?details>$/.test(line)) { out.push(line); i++; continue; }
    if (/^<summary>.*<\/summary>$/.test(line)) { out.push(`<summary>${inline(line.slice(9, -10))}</summary>`); i++; continue; }
    const heading = /^(#{1,6}) (.+)$/.exec(line);
    if (heading) { const level = heading[1].length; out.push(`<h${level} id="${slug(heading[2])}">${inline(heading[2])}</h${level}>`); i++; continue; }
    if (line.startsWith('|') && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const cells = row => row.trim().slice(1, -1).split('|').map(text => text.trim());
      const head = cells(line); const rows = [];
      for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(cells(lines[i]));
      out.push(`<div class="table-scroll"><table><thead><tr>${head.map(text=>`<th>${inline(text)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(text=>`<td>${inline(text)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    const ordered = /^\d+\. /.test(line);
    if (ordered || /^- /.test(line)) {
      const tag = ordered ? 'ol' : 'ul'; const items = [];
      const pattern = ordered ? /^\d+\. / : /^- /;
      for (; i < lines.length && pattern.test(lines[i]); i++) items.push(lines[i].replace(pattern, ''));
      out.push(`<${tag}>${items.map(text=>`<li>${inline(text)}</li>`).join('')}</${tag}>`); continue;
    }
    const paragraph = [];
    for (; i < lines.length && lines[i].trim() && !/^(?:#{1,6} |```|<\/?details>|<summary>|\||- |\d+\. )/.test(lines[i]); i++) paragraph.push(lines[i]);
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    else i++;
  }
  return out.join('\n');
}

const production = process.env.NODE_ENV === 'production';
const payload = variants.map(variant => ({...variant, html: render(variant.markdown)}));
const html = `<!doctype html>
<html lang="zh-CN" data-prototype="readme">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>知序 README · 三种原型</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2328;background:#f6f8fa;--paper:#fff;--line:#d1d9e0;--muted:#59636e;--soft:#f6f8fa;--link:#0969da;color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:36px 28px 124px}button,a,summary{ -webkit-tap-highlight-color:transparent}button{font:inherit;cursor:pointer}a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #0969da;outline-offset:4px}.frame{max-width:1060px;margin:auto}.repo{font-size:15px;margin-bottom:22px;display:flex;gap:10px;align-items:center}.repo strong{font-weight:600}.prototype-label{margin-left:auto;color:var(--muted);font-size:12px}.paper{border:1px solid var(--line);background:var(--paper);border-radius:7px;overflow:hidden}.toolbar{padding:13px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:600}.toolbar button{border:0;background:transparent;color:var(--muted);font-size:13px}.readme{padding:34px 42px 52px;font-size:15px;line-height:1.85}.readme h1{font-size:32px;line-height:1.3;font-weight:650;margin:0 0 20px;padding-bottom:17px;border-bottom:1px solid var(--line)}.readme h2{font-size:23px;line-height:1.5;margin:38px 0 16px;border-bottom:1px solid var(--line);padding-bottom:8px;scroll-margin-top:24px}.readme h3{font-size:18px;line-height:1.5;margin:25px 0 12px;scroll-margin-top:24px}.readme p{margin:0 0 17px}.readme ul,.readme ol{padding-left:25px;margin:0 0 20px}.readme li{margin:6px 0}.readme code{background:var(--soft);padding:2px 6px;border-radius:5px;font-size:13px;font-family:Consolas,"Cascadia Code",monospace}.readme pre{background:var(--soft);border:1px solid var(--line);padding:18px 22px;overflow:auto;line-height:1.8;border-radius:6px;margin:14px 0 22px}.readme pre code{background:none;padding:0;white-space:pre}.table-scroll{overflow:auto;margin:16px 0 24px}table{width:100%;border-collapse:collapse;line-height:1.7;font-size:14px}th,td{border:1px solid var(--line);padding:11px 15px;text-align:left;vertical-align:top}th{font-weight:600;background:var(--soft)}td:first-child{min-width:156px}details{border:1px solid var(--line);border-radius:6px;padding:13px 18px;margin:12px 0 20px}summary{cursor:pointer;font-weight:600}details[open]>summary{margin-bottom:20px}.variant-A{max-width:900px;margin:auto}.variant-A h2:first-of-type{margin-top:30px}.variant-B{max-width:790px;margin:auto;padding-top:54px;padding-bottom:70px}.variant-B h1{font-size:38px;border-bottom:0;margin-bottom:10px}.variant-B>p:first-of-type{font-size:23px;line-height:1.7;font-weight:550;margin-bottom:24px}.variant-B h2{font-size:25px;margin-top:54px}.variant-B #一条资料的旅程~h3{border-left:3px solid #2f6f50;padding-left:18px;margin-top:30px}.variant-B #三种内容各有位置~h3{border-left:0;padding-left:0}.variant-C{font-size:14px;padding:28px 34px}.variant-C h1{font-size:28px;margin-bottom:14px}.variant-C h2{font-size:21px;margin-top:30px}.variant-C th,.variant-C td{padding:9px 13px}.variant-C #按目的找到入口{margin-top:24px}.switcher{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:8px 10px;background:#24292f;color:#fff;border:1px solid #424a53;border-radius:100px;box-shadow:0 8px 26px #0003;z-index:10}.switcher button{color:inherit;background:transparent;border:0;border-radius:100px;min-width:36px;height:36px;font-size:20px}.switcher button:hover{background:#ffffff20}.switcher output{text-align:center;min-width:210px;font-size:14px;white-space:nowrap}.switcher small{font-size:11px;color:#bfc9d4;margin-left:7px}.switcher[hidden]{display:none}dialog{width:min(900px,90vw);max-height:84vh;padding:0;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:inherit}dialog::backdrop{background:#0006}dialog header{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--line)}dialog header div{display:flex;gap:18px}dialog button{border:0;background:transparent;color:var(--muted)}dialog pre{margin:0;padding:24px;white-space:pre-wrap;font-size:13px;line-height:1.7;overflow:auto;max-height:65vh}
@media(prefers-color-scheme:dark){:root{background:#0d1117;color:#e6edf3;--paper:#0d1117;--line:#30363d;--muted:#919aa5;--soft:#161b22;--link:#79b8ff;color-scheme:dark}.variant-B #一条资料的旅程~h3{border-color:#65a586}.switcher{background:#212830}}
@media(max-width:700px){body{padding:16px 10px 110px}.readme{padding:24px 20px}.repo{font-size:12px;flex-wrap:wrap}.prototype-label{width:100%;margin:0}.readme h1{font-size:27px}.switcher{bottom:15px}.switcher output{min-width:180px}.switcher small{display:none}}
@media print{body{padding:0;background:white}.repo,.toolbar,.switcher,dialog{display:none!important}.paper{border:0}.readme{max-width:none;padding:0}details{break-inside:avoid}}
</style></head><body>
<div class="frame"><div class="repo"><a href="https://github.com/wmy5555/zhixu-learning-workbench">wmy5555 / <strong>zhixu-learning-workbench</strong></a><span class="prototype-label">README 原型 · 未替换正式文档</span></div>
<main class="paper"><div class="toolbar"><span>README</span><button type="button" id="source-button">查看 Markdown</button></div><article class="readme" id="readme"></article></main></div>
<nav aria-label="README 原型切换" class="switcher" id="switcher"${production ? ' hidden' : ''}><button id="previous" type="button" aria-label="上一个方案">←</button><output id="current" aria-live="polite"></output><button id="next" type="button" aria-label="下一个方案">→</button></nav>
<dialog id="source-dialog"><header><strong id="source-title"></strong><div><a id="download" download>下载</a><button id="close-source" type="button">关闭</button></div></header><pre id="source-text"></pre></dialog>
<script type="application/json" id="prototype-data">${JSON.stringify(payload).replaceAll('<', '\\u003c')}</script>
<script>
const variants=JSON.parse(document.getElementById('prototype-data').textContent);
const readme=document.getElementById('readme'),current=document.getElementById('current'),dialog=document.getElementById('source-dialog');
let index=0,downloadURL;
function show(key,updateURL=true){
 index=Math.max(0,variants.findIndex(v=>v.key===key));const variant=variants[index];
 readme.className='readme variant-'+variant.key;readme.innerHTML=variant.html;
 current.replaceChildren(document.createTextNode(variant.key+' · '+variant.name));
 const count=document.createElement('small');count.textContent=(index+1)+' / '+variants.length;current.append(count);
 current.title=variant.disclosure+'；'+variant.hypothesis+' '+variant.tradeoff;
 document.title='知序 README · '+variant.key+' '+variant.name;
 if(updateURL){const url=new URL(location.href);url.searchParams.set('variant',variant.key);url.hash='';history.replaceState(null,'',url);window.scrollTo(0,0);}
 console.info('README prototype',{variant:variant.key,name:variant.name,disclosure:variant.disclosure,sections:variant.order,license:false,images:false,persistence:false});
}
function cycle(delta){show(variants[(index+delta+variants.length)%variants.length].key);}
if(!${JSON.stringify(production)}){
 document.getElementById('previous').addEventListener('click',()=>cycle(-1));document.getElementById('next').addEventListener('click',()=>cycle(1));
 document.addEventListener('keydown',event=>{if(dialog.open||event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,select,[contenteditable]'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();cycle(event.key==='ArrowLeft'?-1:1);}});
}
document.getElementById('source-button').addEventListener('click',()=>{
 const variant=variants[index];document.getElementById('source-title').textContent=variant.key+' · '+variant.name;
 document.getElementById('source-text').textContent=variant.markdown;
 if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=URL.createObjectURL(new Blob([variant.markdown],{type:'text/markdown;charset=utf-8'}));
 const download=document.getElementById('download');download.href=downloadURL;download.download='README.PROTOTYPE-'+variant.key+'.md';dialog.showModal();
});
document.getElementById('close-source').addEventListener('click',()=>dialog.close());
window.addEventListener('popstate',()=>show(new URL(location.href).searchParams.get('variant')||'A',false));
show(new URL(location.href).searchParams.get('variant')||'A',false);
</script></body></html>`;

for (const variant of variants) writeFileSync(resolve(root, `README.PROTOTYPE-${variant.key}.md`), variant.markdown);
writeFileSync(resolve(root, 'README.PROTOTYPE.html'), html);
console.log(`Generated A 上手优先 / B 学习路线 / C 任务索引\n${resolve(root, 'README.PROTOTYPE.html')}`);

if (process.argv.includes('--serve')) {
  const files = new Map([['/', ['text/html; charset=utf-8', html]], ...variants.map(v => [`/README.PROTOTYPE-${v.key}.md`, ['text/markdown; charset=utf-8', v.markdown]])]);
  const server = createServer((request, response) => {
    const file = files.get(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!file || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return; }
    response.writeHead(200, {'Content-Type':file[0], 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"});
    response.end(request.method === 'HEAD' ? undefined : file[1]);
  });
  server.listen(0, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}/?variant=A\nCtrl+C to stop this prototype only.`));
}
