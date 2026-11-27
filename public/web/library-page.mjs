import { createLibraryPreferences } from './library-preferences.mjs';
import { escape as e } from './markdown.mjs';
import { $, $$, icon, button as btn, routeButton as link, heading, list, select, details } from './ui.mjs';
import { kind, stage, kindOptions, stageOptions, quickKindOptions } from './classification.mjs';
import { knowledgeRow, recommendationsHTML } from './knowledge-display.mjs';
import { hasUnknownClassification } from '../note-classification.mjs';

const noteCard = note => `<article class="library-note"><div class="note-kind">${icon(note.kind==='source'?'file':'book')}<span>${e(kind(note.kind))}</span><small>${hasUnknownClassification(note)?'分类待确认':e(stage(note.meta?.stage))}</small></div><h2>${e(note.title)}</h2><p>${e(String(note.body||'').replace(/<!-- zhixu-managed-links:start -->[\s\S]*?<!-- zhixu-managed-links:end -->/g,'').replace(/<!--[\s\S]*?-->/g,'').replace(/[#>*`]/g,'').replace(/\s+/g,' ').slice(0,135))}</p><footer><span>${e(note.meta?.topic || '未归入主题')}</span>${link('打开阅读 ↗',`read/${note.id}`,'text-button')}</footer></article>`;

export function createLibraryPage(api) {
  const libraryPreferences = createLibraryPreferences();
  let snapshot = null;
  let generation = 0;

  function visit(reuse) {
    const { version, revision } = api.getContext();
    const visitGeneration = generation;
    const nodes = reuse && snapshot?.version === version && snapshot.revision === revision ? snapshot.nodes : null;
    return {
      nodes,
      remember(host) {
        if (visitGeneration !== generation) return;
        snapshot = { version, revision, nodes: [...host.childNodes] };
      },
    };
  }

  async function page() {
    const preferences = libraryPreferences.read();
    const data = await api.get('/api/library');
    const recommendations = await api.get('/api/recommendations');
    const groups = list(data.groups), standalone = list(data.standalone);
    const allNotes = [...groups.flatMap(group => [group.source, ...list(group.children)]), ...standalone];
    const notes = [...new Map(allNotes.map(note => [note.id, note])).values()]
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return {html:heading('YOUR GROWING LIBRARY','让每一个想法，有处可寻。',`${notes.filter(n=>n.kind==='source').length} 份原文 · ${notes.filter(n=>n.kind==='knowledge').length} 条知识，慢慢长成自己的理解。`,link(`${icon('plus')} 收集资料`,'capture','primary'))+`<div class="library-toolbar"><div class="segmented" aria-label="内容类型">${quickKindOptions.map(([value,label])=>btn(label,'library-filter','',`data-kind="${value}" aria-pressed="${value===preferences.kind}"`)).join('')}</div><label class="inline-search">${icon('search')}<input name="libraryQuery" value="${e(preferences.q)}" type="search" placeholder="在这些想法里找一找" aria-label="筛选知识库"></label></div>${details('筛选与分组',`<div class="form-grid">${select('类别','libraryKind',kindOptions,preferences.kind)}${select('学习状态','libraryStage',stageOptions,preferences.stage)}</div><label class="check"><input type="checkbox" name="sourceGroups" ${preferences.grouped?'checked':''}> 按原文分组，展开子知识</label>`,preferences.optionsOpen).replace('<details ', '<details data-library-options ')}<div id="parity-library"></div>${details('知识使用建议',recommendationsHTML(recommendations),preferences.adviceOpen).replace('<details ', '<details data-library-advice ')}`,
      bind() {
        const host = $('#parity-library');
        const query = $('[name="libraryQuery"]');
        const category = $('[name="libraryKind"]');
        const stageFilter = $('[name="libraryStage"]');
        const grouped = $('[name="sourceGroups"]');
        const buttons = $$('[data-action="library-filter"]');
        const grid = items => `<div class="library-grid">${items.map(noteCard).join('')}</div>`;

        function draw() {
          const { value: kind } = category, { value: stage } = stageFilter;
          libraryPreferences.update({ q: query.value, kind, stage, grouped: grouped.checked });
          const q = query.value.trim().toLowerCase();
          const filtering = Boolean(q || kind || stage);
          const matches = note => (!kind || note.kind === kind) && (!stage || note.meta?.stage === stage) &&
            (!q || `${note.title} ${note.body} ${note.meta?.topic}`.toLowerCase().includes(q));
          buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kind === kind)));
          host.innerHTML = grouped.checked
            ? groups.filter(group => matches(group.source) || list(group.children).some(matches)).map(group => {
                const children = list(group.children);
                return `<section class="parity-source-group">${knowledgeRow(group.source)}${details(`${children.length} 条子知识`, grid(filtering ? children.filter(matches) : children), filtering)}</section>`;
              }).join('') + grid(standalone.filter(matches))
            : grid(notes.filter(matches));
          if (!host.querySelector('article')) host.innerHTML = '<p class="empty">没有符合条件的资料。</p>';
        }

        for (const [selector, key] of [['[data-library-options]', 'optionsOpen'], ['[data-library-advice]', 'adviceOpen']]) {
          const panel = $(selector);
          panel.addEventListener('toggle', () => {
            if (panel.isConnected) libraryPreferences.update({ [key]: panel.open });
          });
        }
        for (const input of [query, category, stageFilter, grouped]) input.addEventListener('input', draw);
        buttons.forEach(button => {
          button.onclick = () => {
            category.value = button.dataset.kind;
            draw();
          };
        });
        draw();
      },
    };
  }

  return {
    page,
    visit,
    invalidate() {
      generation++;
      snapshot = null;
    },
  };
}
