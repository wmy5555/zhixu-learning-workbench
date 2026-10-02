import { el, clear, button, badge, field, emptyState, serializeForm } from './ui.mjs';

const names = { model: '文本生成', embedding: '语义嵌入', search: '联网搜索', fetch: '网页读取' };
const count = value => new Intl.NumberFormat('zh-CN').format(value ?? 0);
const amount = value => value === null || value === undefined ? '未知' : value > 0 && value < .000001 ? '< 0.000001' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value);
const compactAmount = value => value > 0 && value < .0001 ? '< 0.0001' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value);
const costText = row => row.unknownCostCalls ? `${amount(row.knownCost)} + 未知` : amount(row.knownCost);
const heading = (title, subtitle, action) => el('div', { class: 'section-heading' }, [el('div', {}, [el('h2', { text: title }), el('p', { text: subtitle })]), action]);
const select = (label, options, value) => el('select', { ariaLabel: label }, options.map(([key, text]) => el('option', { value: key, selected: key === value, text })));
const metric = (label, value, detail) => el('article', { class: 'usage-stat' }, [el('span', { class: 'muted', text: label }), el('strong', { text: value }), el('small', { text: detail })]);

function table(headers, rows, caption) {
  return el('div', { class: 'call-table-scroll' }, el('table', { class: 'call-table usage-table' }, [
    el('caption', { class: 'sr-only', text: caption }),
    el('thead', {}, el('tr', {}, headers.map(text => el('th', { scope: 'col', text })))),
    el('tbody', {}, rows.map(cells => el('tr', {}, cells.map(cell => el('td', {}, cell))))),
  ]));
}

function budgetCard(title, value, limit, detail, unknown = false) {
  const progress = el('progress', { max: limit > 0 ? limit : 1, value: unknown ? undefined : Math.min(value, limit > 0 ? limit : 1), ariaLabel: title });
  return el('article', { class: 'usage-budget-card' }, [
    el('div', { class: 'usage-budget-title' }, [el('strong', { text: title }), badge(unknown ? '费用不完整' : limit === 0 ? title.includes('今日') ? '已暂停外部请求' : '未设置月上限' : value >= limit ? '已达上限' : '使用中', unknown || limit > 0 && value >= limit ? 'warn' : 'neutral')]),
    el('p', { class: 'usage-budget-value', text: `${amount(value)}${unknown ? ' + 未知' : ''} / ${limit > 0 || title.includes('今日') ? amount(limit) : '未设置'}` }),
    limit > 0 ? progress : null, el('small', { text: detail }),
  ]);
}

function trendPanel(report) {
  const panel = el('section', { class: 'panel usage-trend' });
  const switcher = el('div', { class: 'usage-segments', role: 'group', ariaLabel: '趋势指标' });
  const chart = el('div'), buttons = new Map();
  let selected = 'totalTokens';
  const choices = [['totalTokens', 'Token'], ['knownCost', '费用'], ['calls', '请求']];
  function render() {
    for (const [key, control] of buttons) control.setAttribute('aria-pressed', String(key === selected));
    const max = Math.max(0, ...report.daily.map(row => row[selected])) || 1;
    const bars = el('div', { class: 'usage-bars', role: 'list', ariaLabel: `${report.from} 至 ${report.to} 每日${choices.find(([key]) => key === selected)[1]}` });
    report.daily.forEach((row, index) => {
      const unknown = selected === 'knownCost' ? row.unknownCostCalls : selected === 'totalTokens' ? row.unknownTokenCalls : 0;
      const detail = `${row.date} · ${selected === 'knownCost' ? costText(row) : count(row[selected])}${unknown ? '（部分记录未知）' : ''}`;
      const bar = el('span', { class: `usage-bar${unknown ? ' is-partial' : ''}`, style: `height:${Math.max(row[selected] > 0 ? 1 : 0, row[selected] / max * 100)}%` });
      bars.append(el('div', { class: 'usage-day', role: 'listitem', tabIndex: 0, ariaLabel: detail, title: detail }, [
        el('span', { class: 'usage-bar-track' }, [bar, unknown ? el('span', { class: 'usage-unknown-mark', text: '·' }) : null]),
        el('span', { class: 'usage-day-label', text: report.daily.length <= 8 || index % 5 === 0 || index === report.daily.length - 1 ? row.date.slice(5) : '' }),
        el('span', { class: 'usage-chart-tooltip', text: detail }),
      ]));
    });
    clear(chart).append(el('div', { class: 'usage-chart-scale' }, [el('span', { text: selected === 'knownCost' ? amount(max) : count(max) }), el('span', { text: selected === 'knownCost' ? '已记录费用 · 未知部分不画成 0' : selected === 'totalTokens' ? '已报告 token' : '全部外部 HTTP 尝试' })]), bars);
  }
  for (const [key, text] of choices) { const control = button(text, { onClick: () => { selected = key; render(); } }); buttons.set(key, control); switcher.append(control); }
  const details = el('details', { class: 'usage-details' }, [el('summary', { text: '查看每日明细' }), table(
    ['日期', '请求', '输入', '输出', '缓存输入¹', '费用²'], report.daily.map(row => [row.date, count(row.calls), count(row.inputTokens), count(row.outputTokens), `${count(row.cachedInputTokens)}${row.unknownCacheCalls ? ' + 未知' : ''}`, costText(row)]), '每日用量明细',
  )]);
  panel.append(heading('使用趋势', `${report.from} — ${report.to} · ${report.timezone}`, switcher), chart, details);
  render(); return panel;
}

function modelPanel(report) {
  return el('section', { class: 'panel' }, [heading('模型与服务', '按调用时保存的模型统计；更换模型不会重算历史费用。'),
    report.models.length ? table(['模型 / 服务', '请求', '输入 / 输出', '缓存输入¹', '费用²'], report.models.map(row => [
      el('div', {}, [el('strong', { text: row.model || names[row.capability] || '其他' }), el('small', { text: names[row.capability] || '其他' })]),
      count(row.calls), row.tokenCalls ? el('div', {}, [`${count(row.inputTokens)} / ${count(row.outputTokens)}`, row.unknownTokenCalls ? el('small', { text: `${row.unknownTokenCalls} 次用量不完整` }) : null]) : '—',
      row.tokenCalls ? `${count(row.cachedInputTokens)}${row.unknownCacheCalls ? ' + 未知' : ''}` : '—', costText(row),
    ]), '按模型与服务统计') : emptyState('这段时间还没有调用', '使用知序的 AI 或联网能力后，记录会出现在这里。'),
  ]);
}

function recentPanel(report) {
  const content = el('div'), pager = el('div', { class: 'call-pagination' });
  let page = 0;
  function render() {
    const pages = Math.max(1, Math.ceil(report.recentCalls.length / 10));
    clear(content).append(table(['时间', '模型 / 服务', '输入 / 输出', '费用²', '传输状态'], report.recentCalls.slice(page * 10, page * 10 + 10).map(row => [
      new Intl.DateTimeFormat('zh-CN', { timeZone: report.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(row.createdAt)),
      row.model || names[row.capability] || '其他', ['model', 'embedding'].includes(row.capability) ? `${row.inputTokens === null ? '未知' : count(row.inputTokens)} / ${row.outputTokens === null ? '未知' : count(row.outputTokens)}` : '—',
      amount(row.cost), row.ok === true ? 'HTTP 响应成功' : row.ok === false ? '连接或 HTTP 失败' : '未知',
    ]), '最近请求明细'));
    clear(pager).append(el('span', { text: `第 ${page + 1} / ${pages} 页` }), el('div', { class: 'item-actions' }, [
      button('上一页', { disabled: page === 0, onClick: () => { page--; render(); } }), button('下一页', { disabled: page >= pages - 1, onClick: () => { page++; render(); } }),
    ]));
  }
  const panel = el('details', { class: 'panel usage-details' }, [el('summary', { text: `最近请求明细 · ${report.recentCalls.length} 条` }), el('p', { class: 'fine-print', text: `明细最多展示最近 ${report.recentLimit} 条；上方统计包含所选期间的全部记录。传输状态仅表示连接和 HTTP 响应情况，不代表生成、解析或校验成功；实际结果以对应操作页面或任务结果为准。失败请求也可能已计费。` }), content, pager]);
  render(); return panel;
}

function settingsForm(settings, readOnly, save, refresh) {
  const ai = settings.ai || {}, embedding = settings.embedding || {}, search = settings.search || {};
  const numberInput = (name, value, step = 'any') => el('input', { name, type: 'number', min: 0, step, value: value ?? '', placeholder: '未知', required: ['dailyCallLimit', 'monthlyBudget'].includes(name) });
  const submit = button('保存预算与单价', { type: 'submit', kind: 'primary', disabled: readOnly });
  const status = el('p', { role: 'status', class: 'fine-print' });
  const form = el('form', { class: 'panel page-stack', dataset: { tour: 'usage-budget' } }, [
    heading('预算与单价', '单价仅用于估算未来请求，实际费用以供应商账单为准。'),
    readOnly ? el('p', { class: 'notice info', text: '练习空间与正式库共用用量及预算。这里仅供查看；请退出练习后到正式库的「用量与费用」修改。' }) : null,
    el('fieldset', { class: 'usage-fields', disabled: readOnly }, [
      el('legend', { class: 'sr-only', text: '预算与单价设置' }),
      el('div', { class: 'form-grid' }, [
        field('每日外部请求总上限', numberInput('dailyCallLimit', ai.dailyCallLimit ?? 500, '1'), '涵盖模型、嵌入、搜索和网页读取；0 表示暂停外部请求。'),
        field('月预算', numberInput('monthlyBudget', ai.monthlyBudget ?? 0), '0 表示未设置。启用后如本月存在未知费用，将停止新请求。'),
      ]),
      el('p', { class: 'notice info', text: '所有单价和月预算须使用同一货币单位（例如都用人民币），此处不自动换汇。留空表示未知，只有明确免费才填 0。' }),
      el('h3', { text: `文本生成 · ${ai.model || '尚未配置模型'}` }),
      el('div', { class: 'form-grid' }, [
        field('输入单价 / 百万 token', numberInput('inputPrice', ai.inputPrice)),
        field('输出单价 / 百万 token', numberInput('outputPrice', ai.outputPrice)),
        field('缓存命中输入单价 / 百万 token', numberInput('cachedInputPrice', ai.cachedInputPrice), '留空时全部输入按普通输入价估算；填写后若供应商未报告缓存数量，该次费用保持未知。'),
      ]),
      el('div', { class: 'form-grid' }, [
        field(`语义嵌入输入单价 / 百万 token${embedding.model ? ` · ${embedding.model}` : ''}`, numberInput('embeddingPrice', embedding.inputPrice)),
        field('联网搜索单价 / 次', numberInput('searchPrice', search.requestPrice), '按当前高级搜索请求填写；连接或 HTTP 失败时费用保持未知。'),
      ]),
      el('p', { class: 'fine-print', text: `单份资料上限仍为 ${ai.sourceCallLimit ?? 12} 次；模型等待上限为 ${(ai.timeoutMs ?? 180000) / 1000} 秒。更换服务地址或模型后需重新填写单价。预算按请求前的已记录费用检查，单次请求仍可能超过余额。` }),
    ]), submit, status,
  ]);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (readOnly || submit.disabled) return;
    const data = serializeForm(form), number = key => data[key] === '' ? null : Number(data[key]);
    submit.disabled = true; status.textContent = '正在保存…';
    try {
      await save({
        pricingFor: Object.fromEntries(['ai', 'embedding', 'search'].map(group => [group, { baseUrl: settings[group]?.baseUrl || '', model: settings[group]?.model || '' }])),
        ai: { dailyCallLimit: number('dailyCallLimit'), monthlyBudget: number('monthlyBudget'), inputPrice: number('inputPrice'), outputPrice: number('outputPrice'), cachedInputPrice: number('cachedInputPrice') },
        embedding: { inputPrice: number('embeddingPrice') }, search: { requestPrice: number('searchPrice') },
      });
      status.textContent = '已保存。新单价从后续请求开始生效；历史记录保持原样。';
      await refresh();
    } catch (error) { status.textContent = `未保存：${error.message}`; }
    finally { submit.disabled = false; }
  });
  return form;
}

export async function createUsagePanel({ load, settings, readOnly = false, save }) {
  const root = el('div', { class: 'page-stack usage-dashboard' });
  const period = select('统计时间范围', [['month', '本月'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['today', '今天']], 'month');
  const capability = select('调用类型', [['', '全部服务'], ...Object.entries(names)], '');
  const model = select('统计模型', [['', '全部模型']], '');
  const status = el('p', { role: 'status', class: 'fine-print' }), body = el('div', { class: 'page-stack' });
  let current, revision = 0;
  const exportButton = button('导出统计', { disabled: true, onClick: () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }));
    const link = el('a', { href: url, download: `zhixu-usage-${current.from}-${current.to}.json` });
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  async function refresh() {
    const version = ++revision;
    exportButton.disabled = true; status.textContent = '正在读取本地统计…';
    try {
      const report = await load({ period: period.value, capability: capability.value, model: model.value });
      if (version !== revision) return;
      current = report;
      const selected = model.value;
      clear(model).append(el('option', { value: '', text: '全部模型' }), ...[...new Set([...report.availableModels, ...(selected ? [selected] : [])])].map(value => el('option', { value, text: value, selected: value === selected })));
      const t = report.totals, budget = report.budget;
      clear(body).append(
        el('div', { class: 'usage-stats' }, [
          metric('总 Token', count(t.totalTokens), t.unknownTokenCalls ? `${t.unknownTokenCalls} 次用量不完整，仅汇总已知部分` : '输入 + 输出，来自供应商响应'),
          metric('已记录费用', compactAmount(t.knownCost), t.unknownCostCalls ? `另有 ${t.unknownCostCalls} 次费用未知 · 总费用待确认` : '按请求当时单价估算'),
          metric('外部请求', count(t.calls), `${count(t.failedCalls)} 次连接或 HTTP 失败 · 包含重试与连接测试`),
          metric('缓存输入¹', t.tokenCalls && t.unknownCacheCalls === t.tokenCalls ? '未知' : count(t.cachedInputTokens), `${count(t.inputTokens)} 输入 / ${count(t.outputTokens)} 输出${t.unknownCacheCalls ? ` · ${t.unknownCacheCalls} 次缓存未知` : ''}`),
        ]),
        budget.unavailable ? el('p', { class: 'notice warn', text: '部分调用日期无效，当前无法读取预算状态；统计只包含日期有效的记录。请检查诊断记录。' }) : el('div', { class: 'usage-budget-grid' }, [
          budgetCard('今日请求', budget.callsToday, budget.dailyCallLimit, '所有服务共用 · 按正式库时区每日重置'),
          budgetCard('本月费用', budget.knownCostMonth, budget.monthlyBudget, budget.unknownCostCalls ? `${budget.unknownCostCalls} 次费用未知，无法确定剩余额度` : '所有服务共用 · 与下方筛选条件无关', budget.costMonth === null),
        ]),
        trendPanel(report), modelPanel(report), recentPanel(report),
        el('p', { class: 'fine-print usage-footnotes', text: `¹ 缓存输入已包含在输入 token 中；推理 token 已包含在输出中，不重复累加。未报告的明细保持未知。² 费用使用设置中的统一货币单位；不含供应商账单调整。${report.invalidDateCalls ? `有 ${report.invalidDateCalls} 条日期无效的记录未参与统计。` : ''}` }),
      );
      status.textContent = `${report.from} 至 ${report.to} · ${report.timezone} · ${report.sharedUsage ? '正式与练习共用记录' : '知序本地记录'} · 已更新`;
      exportButton.disabled = false;
    } catch (error) {
      if (version !== revision) return;
      current = null; clear(body).append(emptyState('暂时无法读取统计', error.message, button('重试', { onClick: refresh })));
      status.textContent = '统计未加载，请重试。';
    }
  }
  for (const control of [period, capability, model]) control.addEventListener('change', () => { if (control !== model) model.value = ''; refresh(); });
  root.append(heading('用量与费用', '了解每次 AI 使用，把花费控制在自己的节奏内。', exportButton), el('div', { class: 'usage-toolbar' }, [period, capability, model, button('刷新统计', { onClick: refresh })]), status, body, settingsForm(settings, readOnly, save, refresh));
  await refresh(); return root;
}
