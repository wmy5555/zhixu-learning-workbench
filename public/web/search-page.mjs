import { escape as e } from './markdown.mjs';
import { $, icon, routeButton as link, field, heading, busy, list, select, details, facts } from './ui.mjs';
import { evidenceHTML } from './learning-display.mjs';
import { kindOptions, stageOptions } from './classification.mjs';

export function createSearchPage({ api, getNotes, getSequence, go, submit }) {
  function page() {
    const sources = list(getNotes()).filter(note => note.kind === 'source');
    return {html:heading('CONNECT THE DOTS','找回一个想法，发现新的联系。','检索结果会保留来源与实际采用的检索方式。',link('知识联系与建议 ↗','relations','text-button'))+
      `<form id="parity-search" class="search-composer"><div>${icon('search')}<input name="q" type="search" required placeholder="你在找什么？" aria-label="搜索内容"><button class="primary" type="submit">搜索 ${icon('arrow')}</button></div>${details('检索方式与筛选范围',`<div class="form-grid">${select('检索方式','mode',[['keyword','本地文字'],['semantic','纯语义'],['hybrid','语义与文字']])}${select('类别','kind',kindOptions)}${select('学习状态','stage',stageOptions)}</div><label class="check"><input type="checkbox" name="cloud"> 允许本次查询发给已配置的语义服务（可能计费）</label><div class="form-grid">${select('来源','source',[['','全部来源'],...sources.map(n=>[n.id,n.title])])}${field('主题','topic')}${field('起始日期','from',{type:'date'})}${field('结束日期','to',{type:'date'})}</div>`)}</form><div id="parity-results"></div>`,

      bind() {
        const form = $('#parity-search'), host = $('#parity-results');
        const { mode, cloud } = form.elements;
        const mountedSequence = getSequence();
        let revision = 0;

        function syncMode() {
          for (const option of mode.options) option.disabled = option.value !== 'keyword' && !cloud.checked;
          if (!cloud.checked) mode.value = 'keyword';
        }
        syncMode();
        cloud.onchange = syncMode;

        async function render(parameters, cursor) {
          if (cursor && host.inert) return;
          const request = ++revision;
          const isCurrent = () => request === revision && mountedSequence === getSequence() && host.isConnected;
          const query = new URLSearchParams({ ...parameters, ...(cursor ? { cursor } : {}) });
          if (!cursor) host.inert = true;
          let data;
          try {
            data = await api.get('/api/search?' + query);
          } catch (error) {
            if (isCurrent()) throw error;
            return;
          } finally {
            if (!cursor && request === revision) host.inert = false;
          }
          if (!isCurrent()) return;
          const { nextCursor } = data;
          if (!cursor) host.innerHTML = '';
          host.querySelector('[data-more]')?.remove();
          host.insertAdjacentHTML('beforeend',list(data.results).map(n=>`<article class="search-result"><h2>${link(e(n.title),`read/${n.id}`,'result-title')}</h2><p class="preserve-text">${e(n.snippet||'')}</p>${facts([['定位',n.location],['检索来源',n.via]])}${details('核验与来源',evidenceHTML(n.meta?.evidence||[],n.limitations))}</article>`).join('')||'<p class="empty">未找到相关资料。</p>');
          host.insertAdjacentHTML('beforeend',details('本次检索诊断',`<pre class="parity-json">${e(JSON.stringify(data.diagnostics,null,2))}</pre>`)+(nextCursor?'<button class="text-button" data-more>加载下一页</button>':''));
          if (nextCursor) host.querySelector('[data-more]').onclick = event => busy(event.currentTarget, () => render(parameters, nextCursor));
        }

        submit(form, async values => {
          syncMode();
          const parameters = { ...values, mode: mode.value, privacy: cloud.checked ? 'cloud' : 'local', limit: 20 };
          delete parameters.cloud;
          await render(parameters);
        });
      },
    };
  }

  async function openQuery(query) {
    if (!await go('search')) return;
    const form = $('#parity-search');
    if (!form) return;
    form.elements.q.value = query;
    form.requestSubmit();
  }

  return { page, openQuery };
}
