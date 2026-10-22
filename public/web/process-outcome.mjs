import { escape as e } from './markdown.mjs';
import { routeButton as link } from './ui.mjs';

export function processOutcome(job, { research = false, sourceId, returnTo, pendingProposals = 0 } = {}) {
  const active = ['queued','running'].includes(job.state);
  const retry = ['waiting','failed','cancelled'].includes(job.state);
  const actualResearch = job.research ?? job.payload?.research ?? research;
  const needsResearch = research && !actualResearch && job.state === 'done';
  const title = active ? (job.state === 'running' ? '正在处理这份资料' : '任务已排队') : job.state === 'done' ? '本轮处理已完成' : '任务尚未完成';
  const label = job.state === 'waiting' ? `继续${research ? '核验' : '拆解'}` : `重试${research ? '核验' : '拆解'}`;
  const progress = job.researchProgress;
  const count = progress ? `<p class="form-note">已检索 ${Number(progress.covered)||0} / ${Number(progress.total)||0} 项 · 证据充分 ${Number(progress.verified)||0} 项</p>` : '';
  return { title, active, retry, needsResearch, html:`<div class="process-outcome"><div role="status"><p class="process-state">${active ? '<span class="status-pulse"></span>' : ''}${active ? '可以继续阅读或学习，任务会在后台进行。' : job.state === 'done' ? actualResearch ? '核验结果已保存。学习安排保持不变，材料的可信度提示会按证据更新。' : '拆解结果已保存，尚未执行联网核验。你可以先选择知识学习。' : e(job.error || '当前没有执行中的任务。请确认条件后主动继续。')}</p>${count}</div>
    ${research&&!actualResearch&&active ? '<p class="form-note">当前执行的是拆解，尚未包含联网核验。完成后可在这里确认补充核验。</p>' : ''}
    ${needsResearch ? '<button type="button" class="primary" data-process-research>开始联网核验</button><p class="form-note">继续复用拆解，联网请求可能计费。</p>' : ''}
    ${retry ? `<p class="form-note">${job.extractionSaved ? '已保存的拆解会继续复用。' : ''}点击下方按钮才会重新排队，可能继续使用已配置的外部服务并计费。</p><button type="button" class="primary" data-process-retry>${label}</button>` : ''}
    ${pendingProposals ? `<p class="form-note">有 ${Number(pendingProposals)} 条核验修订待你决定。当前正文与练习已保留。</p>${link('核对修订建议','manage/maintenance','secondary')}` : ''}
    <div class="actions">${link(returnTo?.startsWith('read/') ? '返回这条知识' : '查看原文与知识',returnTo || `read/${sourceId}`,'text-button')}${link('查看处理任务','jobs','text-button')}<button type="button" class="text-button" data-process-refresh>刷新状态</button></div><p class="form-note" data-process-error role="status"></p></div>` };
}
