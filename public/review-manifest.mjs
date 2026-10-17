// Explicitly maintained with each immutable preview deployment; never inferred from main.
export const reviewManifest = Object.freeze({
  revision: 'unified-20261017-r2',
  candidate: 'unified-20261017-r2',
  baseline: 'e4b7eff045534b9b056441a432baf75e93a809d6',
  apiTree: '2717cd0ad4fb69c48b9f23db0d1e2d6531bb6f93',
  entryCommit: 'e61427b67a4696631686a9142cf7984d1ea7c730',
  pricingTree: '296dc978ad6da960a5aaeb75c62c0fe14dc544a0',
  systemTabs: ['settings', 'usage'],
  entries: [
    { id: 'capture', view: 'capture', title: '临时标题与保存回执', enabled: true,
      changes: [
        { pr: 82, head: '85628fc', status: '已合并；含容器内围栏修复' },
        { pr: 84, head: '5031909', status: '已合并；本轮保留复核' },
      ],
      description: '只展示快速收集。保存、重复保存、新输入保留及查看整组均使用真实组件。操作会修改本预览服务的数据。' },
    { id: 'history', view: 'library', title: '编辑记录与历史版本', enabled: true,
      changes: [{ pr: 83, head: 'e3a3d3596684ca84d0a64ae69437c91f15bdf498', status: '已组合；草稿未合并' }],
      description: '原始资料列表仅作为选择入口。打开资料后可编辑、查看版本并展开版本属性；冲突、失败和恢复确认保留。' },
    { id: 'api-center', view: 'system', title: 'API 配置与自动价目', enabled: true,
      changes: [{ pr: 85, head: '47b795ab360773b595440f412f9cf87ba1da2b5c', status: '已组合；草稿未合并' },
        { pr: 87, head: '793907c48cc6de74e715416a9e4e539b72a83d82', status: '已组合；草稿未合并' },
        { pr: 88, head: '874aa9a4cd6333d577aaa4eee5b883aea19bd8a6', status: '已组合；草稿未合并' }],
      description: '保留真实 API 配置、连接测试和用量与费用两个标签。目录读取和连接测试可能请求供应商，测试成功会保存对应卡片；公开价目读取 models.dev，不上传配置或资料。预算、币种、历史快照和核对入口均使用真实组件。普通保存仍沿用原表单并保留隐藏偏好。' },
  ],
});

export function isReviewLocation(location) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
    && location.port === '14318' && location.pathname === '/review.html';
}
export function entryForView(view, manifest = reviewManifest) {
  return manifest.entries.find(entry => entry.enabled && entry.view === view) || null;
}
export function initialReviewView(hash, manifest = reviewManifest) {
  const [view, tab] = String(hash || '').replace(/^#/, '').split('/');
  const entry = entryForView(view, manifest);
  if (entry?.view === 'system' && tab) return `system/${manifest.systemTabs.includes(tab) ? tab : 'settings'}`;
  return entry?.view || manifest.entries.find(entry => entry.enabled).view;
}
export function applyReviewNavigation(buttons, manifest = reviewManifest) {
  for (const button of buttons) {
    const entry = entryForView(button.dataset.view, manifest);
    button.hidden = !entry;
    button.disabled = !entry;
    if (entry) button.textContent = entry.title;
  }
}
