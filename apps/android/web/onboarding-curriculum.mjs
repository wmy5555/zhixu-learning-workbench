// Shared by the browser and the practice manager. This module has no side effects.
import { getMaterial, materialSample } from './onboarding-materials.mjs';
const step = (id, title, instruction, why, expected, view, target, extra = {}) => ({
  id, title, instruction, why, expected, view, target, kind: 'read', ...extra,
});
const action = (id, title, instruction, why, expected, view, target, check, extra = {}) =>
  step(id, title, instruction, why, expected, view, target, { kind: 'action', check, ...extra });
const preset = (id, title, instruction, why, expected, view, target, check, caseId, extra = {}) =>
  action(id, title, instruction, why, expected, view, target, check, { kind: 'case', caseId, ...extra });
const external = (id, title, instruction, why, expected, view, target, extra = {}) =>
  step(id, title, instruction, why, expected, view, target, { kind: 'external', ...extra });
const settings = { tab: 'settings' };

export const readingExample = {
  title: '新手练习 · 小岚的读书分享',
  body: '【原创虚构练习，人物、书名和情节均为设定】\n小岚准备介绍虚构读物《纸桥书店》。她的任务是写一段读书分享。她决定为每个观点留下一段对应摘录，并写清章节位置；摘录与自己的理解分开保存。\n虚构摘录：店主把同一本书放在两个书架，分别标注“想寻找答案时”和“想提出问题时”。小岚认为，同一材料可以服务不同问题，因此她要先写自己的问题，再决定引用哪段。\n这是小岚对这次写作的个人安排，不是关于所有人的学习规律，也没有引用真实研究结论。',
  platform: '原创虚构教程', author: '示例人物小岚', locator: '练习文本第 1—3 段',
};

export const chapters = [
  { id: 'setup', title: '1. 配好 AI 和学习环境', steps: [
    step('setup-welcome', '认识首页', '这里是“今日”首页，集中查看学习安排和处理进度。左上角菜单可以打开导航，前往收集、知识库、学习和输出等页面。先按下面的介绍看看首页各块内容。', '日常使用时，可以先收集一份资料，再生成今日清单，或继续已安排的学习。', '你能找到收集入口，读懂内容统计，并知道去哪里开始学习或查看任务。', 'today', 'nav-today', { overview: [
      { title: '引导进度', body: '查看已完成的步数，点击“继续新手引导”接着练习。扩展阅读可以按需要选择。' },
      { title: '快速收集', body: '用右上角的“快速收集”保存文章、摘录或想法。日期卡片上的“收集资料”也能进入收集页；小屏幕上可以从这里开始。' },
      { title: '日期与今日概览', body: '查看今天的安排、预计学习时间和时间预算。点击“收集资料”添加内容，或“生成今日清单”安排已有知识。' },
      { title: '四项统计', body: '“已存内容”是库里的条目总数；“今日待学习”是尚未完成的安排；“待处理任务”统计等待继续或失败的任务；“异常任务”只统计失败的任务。' },
      { title: '今日安排', body: '新学、到期复习和错题会汇总在这里。点击“开始”进入练习；暂时没空时可以“延期”“跳过”或“暂停”。“调整预算”可以修改每日学习时间。' },
      { title: '处理动态', body: '查看 AI 拆解、批改等任务的进度。遇到等待或失败时，可进入“系统 → 任务”查看详情。' },
      { title: '今日原则', body: '提醒你把注意力放在理解上。学习记录会保留回答、提示使用和后续修正，方便回顾。' },
    ] }),
    step('setup-model', '填写模型服务信息', '在 AI 模型区域填写供应商提供的 HTTPS 服务地址、模型名和密钥，勾选启用。已有配置可以直接使用；不要把密钥粘贴到笔记或教程中。', '拆解和批改需要真正可用的 AI 服务。', '地址、模型和启用状态已填好，密钥只在设置中保存。', 'system', 'settings-model', settings),
    action('setup-save', '保存 AI 配置', '点击“保存能力设置”。这里保存的是正式能力配置，之后正式库和练习空间共用。', '先保存才能测试正在使用的配置。', '页面显示设置已保存，密钥显示已设置。', 'system', 'settings-save', 'settings-save', settings),
    action('setup-test', '测试 AI 连接', '点击模型区域的“测试连接”，等待连接结果。失败时检查地址、模型和供应商余额，再重试。', '连接成功后，就可以用 AI 拆解资料和批改回答。', '页面提示连接成功；修改连接配置后，再测试一次。', 'system', 'settings-model', 'ai-test', settings),
    step('setup-budget', '看懂请求上限和等待时间', '在用量与费用查看 token、每日请求上限和月预算；模型等待时间仍在能力设置。费用未知不等于免费。练习与正式使用共用额度；每次外部请求由你点击触发。', '理解等待和费用，避免失败时连续点击。', '你知道预算不足或超时后要查看任务，再自行决定是否重试。', 'system', 'usage-budget', { tab: 'usage' }),
    action('setup-preferences', '设置本次练习的节奏', '把每日学习时间设为 25 分钟，确认自己的时区和清单生成时间，点击保存。', '今日安排按时区、预算和生成时间工作。', '练习偏好保存成功。', 'system', 'settings-general', 'preferences-save', settings),
    step('setup-storage', '认识两处保存位置', '打开诊断，查看练习的 Vault 和数据目录。Markdown 保存内容，数据库保存可重建索引与运行记录；后面只在此练习 Vault 体验外部编辑。', '避免把练习文件操作到正式资料。', '你能辨认当前练习 Vault 路径。', 'system', 'system-diagnostics', { tab: 'diagnostics' }),
  ] },
  { id: 'capture', title: '2. 收集示例资料', steps: [
    action('capture-save', '粘贴并保存第一份资料', '点击“填入示例”，查看标题、原文、平台、作者和位置；保持“仅本地”，点击保存。', '先保留原始材料，后续加工也能追溯出处。', '出现“小岚的读书分享”及保存结果，原文保持完整。', 'capture', 'capture-form', 'import', { sample: readingExample, needs: ['ai'] }),
    step('capture-source', '打开刚刚保存的原文', '点击框选的“查看原始资料全文”展开原文，再展开“原始资料信息”，看看作者、链接和位置。', '之后阅读拆解结果时，也可以从这里回到原文。', '能读到完整练习文本和来源信息。', 'library', 'note-original', { noteRole: 'capturedSource' }),
    action('capture-permission', '只为示例允许外发', '编辑刚保存的示例，把隐私改为“允许云端”，保存。稍后学习示例知识时，也要为其原文和知识分别亲自允许外发。', 'AI 需要你的外发授权，本地保存不会自动授权。', '这份示例显示允许外发，正式资料不受影响。', 'library', 'note-editor', 'privacy-cloud', { noteRole: 'capturedSource' }),
    step('capture-download', '下载两份练习文件', '下载下方的“读书卡片.md”和“查找线索.txt”，保存在容易找到的位置。下一步会一起导入它们。', '批量导入适合一次收集多份材料。', '本机得到 .md 和 .txt 两个示例文件。', 'capture', 'capture-batch', { downloads: [{ title: '读书卡片.md', href: '/tutorial-examples/reading-card.md' }, { title: '查找线索.txt', href: '/tutorial-examples/finding-clues.txt' }] }),
    action('capture-batch', '一次导入两个文件', '在“批量导入”同时选择刚下载的 .md 和 .txt 文件，保持本地权限后导入。', '批量保存也应逐条保留来源。', '两份文件各自出现在收集结果中。', 'capture', 'capture-batch', 'import-batch'),
  ] },
  { id: 'process', title: '3. 拆解与核验', steps: [
    action('process-ai', '用 AI 拆解原文', '对“小岚的读书分享”点击“AI 拆解”，等待结果。处理进度可以在“系统 → 任务”中查看。', '观察原文如何变成可选择的知识条目。', '原文下方出现拆解出的候选知识；失败时可到任务页查看原因。', 'library', 'note-process', 'process-done', { noteRole: 'capturedSource', needs: ['ai'] }),
    step('process-group', '读懂来源和候选知识的关系', '展开来源分组，分别打开原文和拆解出的知识。检查 AI 是否加入了原文没有的事实。', 'AI 的整理和事实核验是不同环节。', '能沿来源回到原文；待核验事实仍显示限制。', 'library', 'library-content'),
    action('process-manual', '亲手整理一条观点', '对示例原文选择“手动整理为待选学”。标题写“先确定分享的问题”，用自己的话写小岚的个人安排；类型选“仅个人观点或虚构练习”，目标选“讲清原理”，保存。涉及事实的其他内容使用事实类型，并继续核验。', '手工整理适合保存你特别想学的一段内容。', '原文下方出现你整理的候选知识，保留标题、正文与出处。', 'library', 'note-extract', 'extract', { noteRole: 'capturedSource', sample: { title: '先确定分享的问题', body: '在本次虚构读书任务中，小岚先写下想讨论的问题，再选择对应摘录。这个安排仅用于她的分享，不代表对所有学习者都有效。', topic: '读书与知识整理', claimType: 'opinion' } }),
    external('process-search-config', '配置搜索与正文读取能力', '如要真实联网核验，在能力设置点击“前往正式 API 配置”，填写搜索服务信息，启用公开网页读取，保存后分别测试搜索与读取。暂不配置可把本项保留为“待配置”。', '核验必须有可读取的依据，搜索摘要不能代替正文。', '真实配置测试成功，或本项清楚保留为待配置。', 'system', 'settings-capabilities', { ...settings, needs: ['search'] }),
    action('process-validity', '设置资料的复查期限', '编辑这份原始资料，将“核验有效天数”设为 7 并保存。', '容易变化的信息到期后需要重新检查。', '原始资料保存了 7 天的复查周期。', 'library', 'note-editor', 'research-interval', { noteRole: 'capturedSource' }),
    action('process-research', '主动运行联网核验', '在原始资料中选择联网加工并提交。只对服务实际返回的事实和可读取正文记录结论；若虚构文本没有待核验事实，查看“无事实待核验”的实际结果。', '亲自观察外部能力可用时的完整流程。', '任务确实完成，或明确显示缺少正文、额度不足等原因。', 'library', 'note-process', 'research-done', { noteRole: 'capturedSource', needs: ['ai', 'search', 'fetch'] }),
    preset('process-evidence', '查看支持、反对和限制案例', '加载“证据展示”案例，打开证据详情，看看支持、反对和限制分别显示在哪里，再展开引用原文。', '这里可以对照不同依据，了解一条结论的适用条件。', '详情显示三类依据及引用原文，带有“预设演示案例”标记。', 'library', 'note-evidence', 'evidence-open', 'evidence', { noteRole: 'evidenceKnowledge' }),
    preset('process-expired', '观察材料过期提示', '加载“资料过期”案例，打开知识，查看过期提示与重新研究入口；真正重新研究由你主动点击。', '陈旧材料不会因为曾有依据就永久可用。', '显示待复查原因，该案例不能直接进入正常学习。', 'library', 'note-detail', 'note-open', 'expired', { noteRole: 'staleKnowledge' }),
  ] },
  { id: 'library', title: '4. 管理知识', steps: [
    action('library-filter', '找到指定类型和阶段', '在知识库搜索“读书”，切换类型、阶段和分组，找到四个带“练习”前缀的学习目标示例。', '资料多时先缩小范围。', '列表随关键词、类型和阶段条件变化。', 'library', 'library-filter', 'library-filter'),
    action('library-edit', '修改一条知识并保存', '编辑“能够解释”示例，在正文末尾补充一句你对虚构任务的观察并保存。', '人工整理的内容应被明确保留。', '详情显示你的修改，历史里保留旧版。', 'library', 'note-editor', 'note-edit', { noteRole: 'explain' }),
    action('library-aware', '设置“知道存在”目标', '打开“知道存在”示例，编辑页确认学习目标为“了解用途”并保存。回到详情点击“设为仅供查阅”，理由写“知道这张卡片的用途即可”。', '不同材料不必都深入练习。', '这条知识以仅供查阅保存，学习目标是知道存在。', 'library', 'note-lifecycle', 'depth-aware', { noteRole: 'aware' }),
    action('library-find', '设置“知道去哪找”目标', '打开“知道去哪找”示例，编辑页确认学习目标为“会查资料”并保存。回到详情点击“设为仅供查阅”，填写保留查找线索的理由。', '有些知识保留查找线索就足够。', '这条知识保留来源位置和查找目标。', 'library', 'note-lifecycle', 'depth-find', { noteRole: 'find' }),
    action('library-explain', '把解释目标加入学习', '打开练习库准备好的“能够解释”示例卡片，在编辑页将学习目标设为“讲清原理”并保存，再点击“加入学习”，理由写“我要用自己的话说明出处的作用”。', '练习目标决定提问方式。', '知识进入正在学习，之后出现解释型问题。', 'library', 'note-lifecycle', 'depth-explain', { noteRole: 'explain' }),
    action('library-apply', '把应用目标加入学习', '打开“能够迁移应用”示例，编辑页确认对应深度并保存。回到详情点击“加入学习”，理由写“想把方法用于另一种分享”。', '应用练习需要换场景并说明边界。', '另一条独立知识进入学习，保留应用目标。', 'library', 'note-lifecycle', 'depth-apply', { noteRole: 'apply' }),
    step('library-stages', '看懂六个知识阶段', '阅读知识状态：仅供查阅、待选学、正在学习、已整理个人理解、重点知识、不再使用。整理个人理解需要自己的解释；重点知识还应审阅学习和实际使用依据。', '阶段帮助你区分留作参考、准备学习和已经整理过的内容。', '详情中可以查看当前阶段，调整阶段时需要填写理由。', 'library', 'note-lifecycle', { noteRole: 'explain' }),
    preset('library-history', '查看内容历史', '加载“历史、重复与删除”案例，打开“历史恢复专用卡片”的“查看版本”，阅读旧文版本 A 与当前版本 B。', '历史帮助比较修改，防止丢失原意。', '专用卡片显示修改前版本，主线学习知识不受影响。', 'library', 'note-history', 'history-open', 'duplicates', { noteRole: 'versionNote' }),
    preset('library-restore', '恢复练习知识的旧版', '在“历史恢复专用卡片”的版本列表选择版本 A，确认恢复，再打开这张专用卡片核对。', '通过专用卡片理解恢复会改变当前内容和属性。', '专用卡片恢复旧文，操作留有历史；主线解释知识保持原有阶段和权限。', 'library', 'note-history', 'history-restore', 'duplicates', { noteRole: 'versionNote' }),
    preset('library-merge-preview', '预览合并两条重复内容', '加载“重复与删除”案例，打开保留项的合并界面，选择另一条“重复”示例并预览。', '先看合并后的正文和来源，再决定。', '预览包含两份观点和全部来源。', 'library', 'note-merge', 'merge-preview', 'duplicates', { noteRole: 'mergeKeep' }),
    preset('library-merge', '确认合并专用示例', '核对上一步预览后确认合并。只操作标题带“预设演示案例”的重复条目。', '理解被合并项会成为被替代内容。', '保留项包含两份内容，另一项标为被替代。', 'library', 'note-merge', 'merge', 'duplicates', { noteRole: 'mergeKeep' }),
    preset('library-delete', '删除专用练习条目', '打开“仅供删除的卡片”，选择删除并确认。', '删除移除当前文件；历史和已有备份仍可能保留。', '这张专用卡片从当前知识列表消失。', 'library', 'note-detail', 'note-delete', 'duplicates', { noteRole: 'deleteNote' }),
    action('library-suggestions', '查看知识使用建议', '打开知识使用建议，阅读一条建议的触发原因和依据；暂不接受需要后续学习证据的建议。', '建议来自行为记录，最后由你判断。', '看见理由和可采取的操作；后面会再次回访。', 'library', 'library-recommendations', 'recommendations-open'),
  ] },
  { id: 'study', title: '5. 完成一次学习', steps: [
    action('study-source-permission', '允许示例原文参与批改', '打开“练习原文 · 小岚的读书工作台”，隐私选择“允许云端”并保存。', '批改会用到知识及其原文，两处权限需要分别设置。', '原文显示允许云端处理；下一步设置知识的权限。', 'library', 'note-editor', 'privacy-cloud', { noteRole: 'source' }),
    action('study-permission', '允许解释示例用于真实批改', '打开“能够解释”示例的编辑页，选允许外发并保存。只授权这条虚构示例。', '学习问题和回答需要与材料一起交给模型。', '这条示例允许外发，后续批改可正常请求。', 'library', 'note-editor', 'privacy-cloud', { noteRole: 'explain' }),
    action('study-plan', '生成今日清单', '回到今日，点击“生成今日清单”或“重新安排”，找到刚加入学习的解释知识。若没有出现，按“未安排的原因”检查学习状态、核验、暂停与预算，再生成清单。', '清单按学习目标、到期时间和预算安排。', '选中的解释知识出现在今日待学项中，显示预计分钟和安排理由。', 'today', 'today-generate', 'today-generate', { noteRole: 'explain' }),
    step('study-reason', '阅读为什么这样安排', '查看每项的理由、预计时间、超出预算的余量和被前置知识阻塞的提示。', '今日清单不是固定打卡列表。', '能说明一项是新学、到期复习还是错题练习。', 'today', 'today-plan'),
    action('study-defer', '把应用示例延期一天', '在“能够迁移应用”安排上点击延期，按钮会顺延一天。若清单没有该示例，可先在“知识管理进阶”中完成“把应用目标加入学习”，再刷新今日安排。', '忙碌时可主动调整安排。', '该项显示延期，不再占用当前待学时间。', 'today', 'today-plan', 'plan-defer', { noteRole: 'apply' }),
    action('study-start', '开始解释示例', '对“能够解释”点击开始学习，阅读材料和本次目标。', '先理解原文，再独立回答。', '打开学习会话，显示原文和解释型问题。', 'study', 'study-queue', 'study-start', { noteRole: 'explain' }),
    action('study-hide', '隐藏材料后自己想一想', '点击隐藏原文，先不看提示，在输入区用自己的话思考。', '区分独立回忆与照着原文回答。', '原文已折叠，问题和回答框仍可操作。', 'study', 'study-material', 'study-hide'),
    action('study-answer', '提交你自己的回答', '在回答框解释：小岚为什么把观点、摘录和位置分别记录，以及什么情况下仍需核对。请自行组织语言，点击提交。', '提交后，AI 会结合材料给出反馈，帮你找到需要补充的地方。', '你的回答已保存，界面显示等待批改。', 'study', 'study-answer', 'study-answer', { needs: ['ai'] }),
    action('study-feedback', '核对真实 AI 反馈', '等待批改完成，逐项阅读判断、遗漏、修正依据和追问。AI 判定也可能需要质疑。', '收到回复后再决定如何改进。', '本轮显示实际模型反馈；失败显示原因为未完成。', 'study', 'study-session', 'study-feedback', { needs: ['ai'] }),
    action('study-followup', '回答一次追问', '根据反馈，在下一轮输入自己的补充解释并提交，等待第二轮反馈。若核心练习已经结束，请先对“能够解释”开始新一轮练习并提交首轮回答。完成本专题后记得结束这轮练习。', '多轮练习记录理解的变化。', '同一会话保留至少两轮问题、回答和反馈。', 'study', 'study-answer', 'study-followup', { needs: ['ai'] }),
    action('study-resume', '从最近会话回到这里', '切到其他页面，再在学习页的最近会话中点击继续本次会话。', '学习可以中断后继续，不必重复提交。', '已有两轮回答和反馈仍然存在。', 'study', 'study-history', 'study-resume'),
    action('study-finish', '结束本次练习', '等全部反馈完成后点击结束练习，阅读本次结算和下次复习时间。若存在争议，本轮只保留记录；复习步骤提供重新练习入口，由你核对材料并提交新回答。', '结束练习才会按实际表现安排复习；有争议的记录不产生复习结算。', '本次会话完成，并说明是否独立、是否使用提示或存在争议。', 'study', 'study-finish', 'study-finish'),
    action('study-confirm', '保存自己的理解', '在“确认我的理解”中，用自己的话写下这条知识的含义和一个例子，再点击确认。可以参考刚才的反馈补充说明。', '这里保存你整理后的理解，方便以后复习和使用。', '知识详情显示你写下的个人理解和确认记录。', 'study', 'study-confirm', 'study-confirm'),
  ] },
  { id: 'review', title: '6. 加速体验复习', steps: [
    action('review-same-day', '试一次同日追加练习', '保持当前演示日期，对解释示例再做一次独立作答并结束，阅读“同日追加”的说明。', '同一天多做一次不会让间隔不断翻倍。', '同日正常追加没有重复增加复习间隔。', 'study', 'study-queue', 'review-same-day', { noteRole: 'explain', needs: ['ai'] }),
    action('review-clock-day', '把练习日期推进一天', '在引导卡片点击“推进一天”，看看练习日期和今日清单如何变化。', '可以马上体验第二天的安排，电脑时间和正式库日期保持原样。', '顶部的练习日期向后一天。', 'today', 'today-plan', 'clock-day'),
    action('review-clock-due', '前往下一次真正到期', '在引导的练习时间区域点击“跳到下次复习”，查看今日清单中的复习项。若已经到期，直接刷新查看。只有练习学习日期改变，电脑时间、正式库和请求预算不变。', '复习要按已保存的到期时间发生。', '解释示例作为到期复习出现。', 'today', 'today-plan', 'clock-due'),
    action('review-finish', '完成一次到期复习', '打开到期复习，先隐藏原文，再回答问题。查看反馈后结束练习，看看下一次复习安排。', '知序会根据这次回答和提示使用情况，调整复习间隔。', '显示本次复习结果及下一次复习时间。', 'study', 'study-queue', 'review-finish', { noteRole: 'explain', needs: ['ai'] }),
    preset('review-hint', '查看提示会如何影响练习', '加载“提示完成”预设案例，打开已准备的预设会话，点击“分级提示”；阅读提示来自哪里。', '提示是帮助，同时需要如实记录使用。', '预设会话显示提示，并记录本次使用过提示。', 'study', 'study-hint', 'study-hint', 'hints', { noteRole: 'hintSession' }),
    preset('review-hint-finish', '观察带提示结果的近期安排', '继续“提示完成”案例中的会话，点击结束练习，看看近期复习安排及其原因。', '借助这个案例，了解使用提示后会怎样安排下一次练习。', '预设会话显示近期复习，完成状态是“已看案例”。', 'study', 'study-finish', 'study-finish', 'hints', { noteRole: 'hintSession' }),
    preset('review-skip', '跳过今日的一项安排', '刷新今日清单，在“仅供今日跳过的安排”上点击“今日跳过”。若今日预算已用完，先推进一天再刷新。', '跳过只处理当天安排。', '专用案例项显示今日跳过，解释和应用示例仍保留。', 'today', 'today-plan', 'plan-skip', 'hints', { noteRole: 'skipKnowledge' }),
    preset('review-pause', '暂停不准备继续学的条目', '在“仅供暂停的安排”上点击暂停，与“今日跳过”对照阅读。若今日预算已用完，先推进一天再刷新。', '暂停会让条目离开后续日常安排。', '专用案例项显示暂停；可在设置的暂停项中恢复。', 'today', 'today-plan', 'plan-pause', 'hints', { noteRole: 'pauseKnowledge' }),
  ] },
  { id: 'mistakes', title: '7. 处理错题', steps: [
    preset('mistake-open', '阅读预设错题的原回答', '加载错题案例，打开“只保存结论就够了”的错题，依次查看原问题、当时回答、遗漏和修正依据。', '错误回答保留为记录，不作为正确知识引用。', '错题全文醒目标注预设，并显示具体遗漏。', 'study', 'study-mistakes', 'mistake-open', 'mistakes', { tab: 'mistakes', noteRole: 'mistake' }),
    preset('mistake-study', '开始一次专项练习', '在该错题点击针对练习，阅读针对遗漏提出的问题。若继续提交答案，先为此虚构案例允许外发，并自行作答。', '纠错练习针对具体误解。', '学习会话显示这条错题的上下文。', 'study', 'study-mistakes', 'mistake-study', 'mistakes', { tab: 'mistakes', noteRole: 'mistake' }),
    preset('mistake-dispute', '对判定提出质疑', '回到案例错题，点击质疑并填写“我需要重新核对这条判定的依据”。', 'AI 的结论可以被质疑。', '错题变为已质疑，争议不会当作独立成功记录。', 'study', 'study-mistakes', 'mistake-dispute', 'mistakes', { tab: 'mistakes', noteRole: 'mistake' }),
    preset('mistake-reopen', '重新打开错题', '在刚质疑的错题上点击重新打开。', '处理状态可以修正，记录仍保留。', '错题恢复未解决状态。', 'study', 'study-mistakes', 'mistake-reopen', 'mistakes', { tab: 'mistakes', noteRole: 'mistake' }),
    preset('mistake-resolve', '标记已经纠正', '阅读案例中的修正依据，点击“已纠正”，看看错题的处理状态如何变化。', '纠正后仍可查看原回答和修正依据，方便回顾。', '错题标为已纠正。', 'study', 'study-mistakes', 'mistake-resolve', 'mistakes', { tab: 'mistakes', noteRole: 'mistake' }),
    preset('mistake-revoke', '撤销不成立的错题', '点击撤销，说明“预设流程练习：此记录不作为我的错误证据”。', '不成立的判定应明确撤销。', '记录变为已撤销，原始内容仍能追溯。', 'study', 'study-mistakes', 'mistake-revoke', 'mistakes', { tab: 'mistakes', noteRole: 'mistake' }),
  ] },
  { id: 'topics', title: '8. 组织主题学习', steps: [
    action('topic-create', '建立读书分享主题', '点击新建主题，标题填“小岚的读书分享”，选解释和应用示例为成员，保存。', '把相关知识安排成解决一个问题的学习路径。', '主题列表出现新主题及成员。', 'topics', 'topic-editor', 'topic-create', { action: 'create-topic', sample: { title: '小岚的读书分享', body: '先保留出处并解释观点，再尝试把方法用于另一种分享。' } }),
    action('topic-edit', '安排顺序和前置条件', '编辑刚建的主题，把解释示例排在应用前面，检查前置项、预计分钟和正文后保存。', '先后顺序应对应真实依赖。', '主题详情显示已保存顺序和前置项。', 'topics', 'topic-editor', 'topic-edit', { noteRole: 'createdTopic', action: 'edit-topic' }),
    action('topic-study', '从主题开始下一项', '打开主题，查看完成进度和下一项，点击开始下一项。已暂停的知识需要先恢复。', '主题按成员和前置条件推进。', '进入带主题上下文的学习会话。', 'topics', 'topic-detail', 'topic-study', { noteRole: 'createdTopic', action: 'open-topic' }),
    preset('topic-blocked', '观察前置知识尚未准备好', '加载前置阻塞案例，打开对应主题，查看为什么下一项被阻塞。', '系统不会把待核验前置项悄悄略过。', '指出具体前置知识及阻塞原因。', 'topics', 'topic-detail', 'topic-open', 'prerequisites', { noteRole: 'topicBlocked', action: 'open-topic' }),
    action('topic-copy', '复制为另一个学习目标', '在你创建的主题中点击“复制或拆分为新学习包”，保留全部成员，为副本改名“小岚的第二次分享”并保存。', '已有结构可以复用，主题目的可以不同。', '出现独立副本，原主题仍在。', 'topics', 'topic-detail', 'topic-copy', { noteRole: 'createdTopic', action: 'open-topic' }),
    action('topic-split', '把成员拆分成小主题', '点击“复制或拆分为新学习包”，从新表单移除一部分成员，以“小岚的出处核对”另存。', '过大的学习包可以分次处理。', '生成包含所选成员的新主题。', 'topics', 'topic-detail', 'topic-split', { noteRole: 'createdTopic', action: 'open-topic' }),
    action('topic-pause', '暂停这个主题', '关闭详情，在主题列表的对应卡片点击暂停。', '整包暂缓可减少当前学习负担。', '主题显示已暂停。', 'topics', 'topics-list', 'topic-pause', { noteRole: 'createdTopic' }),
    action('topic-resume', '恢复主题学习', '在列表的同一主题卡片点击恢复。', '暂停后保留成员和已有进度。', '主题恢复活动状态，已有记录仍在。', 'topics', 'topics-list', 'topic-resume', { noteRole: 'createdTopic' }),
    action('topic-ai', '请求真实 AI 主题建议', '点击 AI 学习包建议，确认只有已允许外发的示例会参与，等待任务完成。', 'AI 可以建议分组，仍需你审阅。', '出现真实的学习包建议报告。', 'topics', 'topics-list', 'topics-done', { needs: ['ai'] }),
    action('topic-adopt', '手动采用一个主题建议', '到检索与发现查看“AI 学习包建议”报告，核对成员、前置缺口和顺序，再回主题页点击“新建主题学习包”，按你认可的建议选择成员并保存。', 'AI 报告不会自动成为你的学习计划。', '选中的建议成为可编辑的主题。', 'topics', 'topics-list', 'topic-adopt'),
  ] },
  { id: 'discover', title: '9. 检索与发现联系', steps: [
    action('search-keyword', '用关键词找材料', '搜索“出处”，再试类型、主题、来源、日期和阶段筛选，打开一条结果。', '范围越清楚，结果越容易核对。', '结果带匹配片段，可以回到原文。', 'discover', 'discover-search', 'search-keyword', { sample: { query: '出处' } }),
    action('search-empty', '看懂空结果与检索诊断', '输入“zzzxqv_nothing_742993”搜索，查看空结果和诊断，再清空筛选。这个特殊词没有出现在任何示例资料中。', '没有找到不等于知识被删除。', '空结果明确显示，没有编造答案。', 'discover', 'discover-results', 'search-empty', { sample: { query: 'zzzxqv_nothing_742993' } }),
    external('search-embedding', '配置可选语义服务', '在能力设置点击“前往正式 API 配置”，填写向量服务地址、模型和密钥，启用并保存后点击“测试嵌入”。暂不配置就保持待配置，关键词检索仍能用。', '语义检索需要独立服务，不能把关键词回退当作语义成功。', '真实连接成功，或清楚显示待配置。', 'system', 'settings-capabilities', { ...settings, needs: ['embedding'] }),
    action('search-index', '为允许外发的示例补建向量', '在诊断中点击更新检索索引，等待任务结束，查看待补数量；仅本地资料不会外发。', '有向量的材料才能参与对应语义比较。', '任务完成，诊断反映实际生成的向量和剩余待补内容。', 'system', 'system-index', 'index-done', { tab: 'diagnostics', needs: ['embedding'] }),
    action('search-semantic', '体验语义检索', '先清空上次筛选条件，勾选允许本次查询外发，再选择语义模式，输入“如何回到支持观点的原文”搜索，检查结果来源和诊断。', '用含义相近的问题查找材料。', '诊断确认实际执行语义检索；回退时本项仍待配置。', 'discover', 'discover-search', 'search-semantic', { needs: ['embedding'], sample: { query: '如何回到支持观点的原文' } }),
    action('search-hybrid', '比较混合检索', '对相同问题选择混合检索，查看结果中的关键词与语义标记。', '比较两种信号如何共同找材料。', '诊断确认实际使用混合模式及可用语义结果。', 'discover', 'discover-search', 'search-hybrid', { needs: ['embedding'] }),
    action('relation-local', '查看本地关联候选', '打开解释示例的联系区域，点击本地寻找联系；查看候选，但先不要把相似误认为支持。', '相似只是线索，需要明确关系和边界。', '显示本地候选或明确的暂无候选结果。', 'library', 'note-relations', 'relations-local', { noteRole: 'explain' }),
    action('relation-ai', '主动请求 AI 细查联系', '在联系区域点击 AI 分析，等待完成后阅读关联理由、用途、边界及双方摘录。', '联系需要依据，不能只靠两个标题相近。', '显示真实建议或无足够依据的结果。', 'library', 'note-relations', 'relations-done', { noteRole: 'explain', needs: ['ai'] }),
    preset('relation-accept', '审阅后接受一条联系', '加载“关系审阅”案例，核对两端摘录和适用边界，对带“待接受”标题的建议点击接受。', '只有你接受后，建议才成为确认联系。', '预设联系变为已接受，并显示在知识关联中。', 'discover', 'discover-relations', 'relation-accept', 'relations', { noteRole: 'relationAccept' }),
    preset('relation-reject', '拒绝不合适的联系', '在另一条带“待拒绝”标题的预设建议上点击拒绝。', '拒绝也保留审阅结果。', '该建议不再出现在待审阅列表。', 'discover', 'discover-relations', 'relation-reject', 'relations', { noteRole: 'relationReject' }),
    preset('relation-ignore', '忽略没有依据的候选', '查看“仅供忽略”的预设候选，点击“忽略候选”。', '候选只是线索，可以明确不采纳。', '该候选离开待探索列表，没有创建已确认关系。', 'discover', 'discover-relations', 'relation-reject', 'relations', { noteRole: 'relationIgnore' }),
    preset('relation-remove', '移除已经接受的联系', '对刚接受的预设联系点击移除，核对知识中的关联也同步变化。', '关系判断可以随着理解更新。', '该联系不再作为已接受关系显示。', 'discover', 'discover-relations', 'relation-remove', 'relations', { noteRole: 'relationAccept' }),
    action('discovery-run', '运行全库发现并读报告', '点击全库结构检查，先选择本地模式；任务完成后打开报告，阅读孤立节点、尚未采用和本次覆盖范围。可另外主动选择 AI 探索。', '全库发现提供待审阅线索，单次并非穷尽。', '生成报告并明确哪些是本地检查、哪些实际使用 AI。', 'discover', 'discover-relations', 'discovery-done'),
  ] },
  { id: 'output', title: '10. 用知识完成输出', steps: [
    action('output-answer', '根据知识回答问题', '问题填“在小岚的读书分享中，怎样让观点能回到原文核对？”，选择“回答问题”和知识取材范围，勾选允许将本次问题发给外部模型，再点击开始生成。', '输出应能回到真实收集的材料。', '出现真实 AI 回答、引用和限制；无依据时明确说明。', 'output', 'output-form', 'ask-answer', { needs: ['ai'], sample: { question: '在小岚的读书分享中，怎样让观点能回到原文核对？' } }),
    step('output-citations', '逐一核对引用与底层来源', '点击生成内容中的引用，阅读对应知识，再回到它的原始资料，检查是否真的支持这一句。', '引用存在不代表每句话都被支持。', '能从输出回到知识与底层原文。', 'output', 'output-result'),
    action('output-outline', '生成一次提纲', '将输出方式改为“组织提纲”，问题写“小岚的读书分享应按什么顺序展开？”，确认本次问题外发授权后点击开始生成。', '同一知识可以服务不同输出目的。', '出现真实 AI 提纲及对应引用。', 'output', 'output-form', 'ask-outline', { needs: ['ai'], sample: { question: '小岚的读书分享应按什么顺序展开？' } }),
    action('output-draft', '生成一段真实 AI 草稿', '改选草稿，提出“小岚如何用一段话解释保留出处的做法？”，允许此次问题外发，点击生成并等待。', 'AI 草稿需要你审阅和改写。', '出现实际模型生成的草稿和引用，或明确失败原因。', 'output', 'output-form', 'ask-draft', { needs: ['ai'], sample: { question: '小岚如何用一段话解释保留出处的做法？' } }),
    action('output-edit', '保存自己的编辑', '在历史草稿打开刚生成内容，改写一句使其符合你的表达，再保存。', '最终采用的内容由你决定。', '草稿保存了你的修改。', 'output', 'draft-editor', 'draft-edit'),
    action('output-use', '标记真正采用的知识', '勾选你确实用于这次练习输出的引用，保存采用记录。仅生成或看见引用不算采用。', '实际使用记录是之后知识建议的一项依据。', '出现你明确勾选的采用记录。', 'output', 'draft-editor', 'draft-use'),
    action('output-unuse', '取消一次采用标记', '取消刚才一个引用的采用勾选并保存，检查记录随之撤回。', '误勾选可以更正，不应累积虚假使用。', '取消的引用不再计作本草稿实际采用。', 'output', 'draft-editor', 'draft-unuse'),
    action('output-capture', '把草稿送回收集箱', '在草稿中选择送回收集箱，检查标题和正文后保存为新资料。', '输出可成为下一轮整理的输入。', '收集箱出现新资料，并保留你确认后的正文。', 'output', 'draft-editor', 'draft-capture'),
    preset('output-core-review', '读懂核心知识建议的依据', '加载“核心建议”案例，打开知识使用建议，展开三天练习和两天采用记录，看看建议是怎样形成的。', '知序会结合练习和使用记录，建议哪些知识值得重点保留。', '预设记录单独标记，建议显示具体依据。', 'library', 'library-recommendations', 'recommendations-open', 'core-suggestion', { noteRole: 'coreKnowledge' }),
    preset('output-core-accept', '接受一次预设阶段建议', '只对带“预设演示案例”的核心建议点击接受，查看知识阶段变化。', '练习最后仍由用户决定阶段。', '案例知识成为核心，主线学习记录不被替代。', 'library', 'library-recommendations', 'recommendation-accept', 'core-suggestion', { noteRole: 'coreKnowledge' }),
    preset('output-suggestion-dismiss', '暂不采纳另一条建议', '在知识使用建议中找到“暂不采纳建议的专用卡片”，阅读转为查阅的理由后点击“暂不采用”。', '建议可以拒绝，不必全部接受。', '专用卡片的建议记为已处理，知识阶段仍为待选学。', 'library', 'library-recommendations', 'recommendation-dismiss', 'core-suggestion', { noteRole: 'dismissKnowledge' }),
  ] },
  { id: 'maintenance', title: '11. 维护自己的工作台', steps: [
    action('jobs-filter', '筛选后台任务', '进入系统的任务页，切换全部、等待、失败、完成等状态，查看之前的拆解或批改任务。', '长时间运行的操作可以在这里追踪。', '列表按所选状态筛选。', 'system', 'system-jobs', 'jobs-filter', { tab: 'jobs' }),
    preset('jobs-detail', '打开一个任务的详情', '加载“任务故障”案例，将筛选恢复为全部，展开预设索引失败任务的“查看详情”，阅读失败原因。', '任务状态解释当前发生了什么。', '看见预设失败任务的原因和案例标记。', 'system', 'system-jobs', 'job-open', 'jobs', { tab: 'jobs', noteRole: 'failedJob' }),
    preset('jobs-cancel', '取消预设的等待任务', '加载“任务故障”案例，找到“预设演示案例：等待取消”的任务并点击取消。', '取消停止后续执行，但保留已保存输入。', '该任务变为已取消。', 'system', 'system-jobs', 'job-cancel', 'jobs', { tab: 'jobs', noteRole: 'cancelJob' }),
    preset('jobs-retry', '手动重试预设失败任务', '对“预设演示案例：索引失败”点击重试，观察新状态。该预设案例仅重新扫描本地练习资料，不会发起外部请求。', '失败不会自动重复请求，重试由你决定。', '预设任务重新排队并显示本地扫描结果，仍标为案例。', 'system', 'system-jobs', 'job-retry', 'jobs', { tab: 'jobs', noteRole: 'failedJob' }),
    action('calls-open', '查看 AI 调用记录', '进入诊断，查看调用次数、耗时、费用及成功或失败记录。可以找到之前拆解、出题和批改的请求。', '遇到等待或失败时，可以从这里了解请求情况。', '诊断页显示调用记录；缺少价格信息的费用显示为未知。', 'system', 'system-calls', 'calls-open', { tab: 'diagnostics' }),
    action('prompts-save', '修改练习提示词', '在能力设置展开提示词，阅读变量说明，只在一份模板末尾补充“请使用简洁中文”，保存；保留所有必填变量。', '练习提示词可独立调整，影响之后主动发起的调用。', '练习模板保存成功，已有记录不被重写。', 'system', 'settings-prompts', 'prompts-save', settings),
    action('prompts-reset', '恢复默认提示词', '把刚修改的模板恢复默认并保存。', '试验后可以回到已知模板。', '该模板恢复默认内容。', 'system', 'settings-prompts', 'prompts-reset', settings),
    action('appearance-theme', '切换日间与夜间外观', '点击外观中的日间或夜间选项，检查文字、抽屉和引导卡片；这是浏览器外观设置。', '选择适合自己的阅读环境。', '整个界面和引导都切换主题。', 'system', 'system-appearance', 'appearance-theme', { tab: 'appearance' }),
    action('appearance-accent', '选择强调色', '选择一个强调色并应用，查看按钮与选中状态。', '外观可以个性化，含义仍要清晰。', '强调色应用成功。', 'system', 'system-appearance', 'appearance-accent', { tab: 'appearance' }),
    action('backup-download', '下载练习备份', '在完整备份区域下载当前练习备份，确认文件标识为练习用途。', '先有备份，再练习恢复。', '本机得到可恢复的练习备份文件。', 'system', 'system-backup', 'backup-download', { tab: 'data' }),
    action('backup-preview', '预览练习备份恢复', '选择刚下载的练习备份，点击预览，阅读将恢复的内容数量与覆盖提示。', '预览让你先核对恢复对象。', '显示练习空间中的恢复预览，没有改写正式库。', 'system', 'system-restore', 'restore-preview', { tab: 'data' }),
    action('backup-restore', '确认恢复练习空间', '核对预览后确认恢复，等待完成。正在进行的任务必须先结束，进度会重新核对证据。', '在隔离空间中亲自体验完整恢复。', '练习恢复成功，正式配置、路径和凭据不变。', 'system', 'system-restore', 'restore', { tab: 'data' }),
    step('backup-boundary', '记住附件的备份范围', '阅读备份说明：JSON 备份包含 Markdown 与运行记录；图片、其他附件和 .obsidian 配置需要另外备份整个 Vault。', '避免恢复时才发现附件未在文件里。', '能区分应用备份与整个文件夹备份。', 'system', 'system-backup', { tab: 'data' }),
  ] },
  { id: 'external', title: '12. 外部工具与文件协作', steps: [
    external('mcp-config', '了解并配置正式 MCP 通道', '在能力设置阅读 MCP 接入说明。如需使用，点击“前往正式 API 配置”，在正式设置主动启用，再按文档配置外部客户端的 stdio 服务。外部 MCP 连接的是正式库。', '配置后，外部客户端可以按你授予的权限查找和读取知识。', '能力设置中可以查看 MCP 的启用状态和接入方法；暂未连接时保留待配置。', 'system', 'settings-mcp', { tab: 'settings', needs: ['mcp'] }),
    external('mcp-read', '在外部客户端读取知识', '连接后，在客户端试试只读查找、读取知识、读取来源和关联查询。查看返回结果，再回诊断页查看调用记录。', '可以从外部客户端查找材料，并回到知序追踪它的出处。', '客户端显示查询结果，诊断页可以查看 MCP 调用记录。', 'system', 'system-diagnostics', { tab: 'diagnostics', needs: ['mcp'] }),
    preset('proposal-accept', '审阅并接受预设写入提案', '加载“写入提案”案例，在写入提案页比较修改前后，对“待接受”提案点击接受。它是练习用记录，没有开启 MCP 权限。', '外部建议先审阅，才可写入。', '案例提案被接受，专用知识正文改变。', 'system', 'system-proposals', 'proposal-accept', 'proposals', { tab: 'proposals', noteRole: 'proposal' }),
    preset('proposal-reject', '拒绝另一份预设提案', '对“待拒绝”提案检查理由后点击拒绝。', '不适合的建议不必写入。', '提案变为已拒绝，专用知识保持原文。', 'system', 'system-proposals', 'proposal-reject', 'proposals', { tab: 'proposals', noteRole: 'proposalReject' }),
    external('obsidian-open', '用 Obsidian 打开练习 Vault', '复制诊断中当前练习 Vault 路径，在 Obsidian 选择“打开文件夹作为仓库”，打开这个练习目录。未安装可保留待体验。', '知识内容也能在外部 Markdown 工具中阅读。', 'Obsidian 中显示练习资料；体验后可以在引导中记录进度。', 'system', 'system-diagnostics', { tab: 'diagnostics', needs: ['obsidian'] }),
    external('obsidian-edit', '外部编辑并核对稳定身份', '在 Obsidian 给一条练习知识补充一句备注，保留开头 id、kind 等属性，保存；回知序刷新并核对同一条知识。', '文件名可变，稳定 id 连接学习记录和关系。', '同一知识显示外部修改，已有身份和历史仍可追溯。', 'library', 'note-detail', { noteRole: 'find', needs: ['obsidian'] }),
    preset('links-preview', '预览知识链接更新', '加载“链接与冲突”案例，打开“链接更新专用主题”的链接预览，核对将添加的成员链接以及原来的说明。', '先看系统准备修改哪部分链接。', '预览显示待添加的成员链接，保留专用主题的原文。', 'library', 'note-links', 'links-preview', 'conflicts', { noteRole: 'linkTopic' }),
    preset('links-sync', '确认同步链接', '在“链接更新专用主题”的预览中点击“确认更新链接”，再打开主题查看结果。', '保持应用与 Markdown 中的链接一致。', '专用主题的链接更新完成，原来的说明仍保留。', 'library', 'note-links', 'links-sync', 'conflicts', { noteRole: 'linkTopic' }),
    preset('conflicts-read', '认识外部编辑冲突', '加载“冲突”案例，在系统冲突页阅读旧版与新版的差别，再打开专用知识查看历史。此案例不会覆盖你手写的内容。', '冲突需要对照处理，不能静默选择某一版。', '看到明确的预设冲突报告及两个版本。', 'system', 'system-conflicts', 'conflicts-open', 'conflicts', { tab: 'conflicts', noteRole: 'conflictNote' }),
    step('complete-review', '回顾核心体验', '看看核心流程进度，回顾如何保存原文、拆解知识、作答、整理理解、复习和输出。完成后，回正式库收集自己的第一份资料；也可以按兴趣选择扩展阅读。', '以后可以从今日页或左下角帮助入口，继续练习和查看教程。', '核心步骤都有完成记录；可以回正式库开始使用，或继续扩展阅读。', 'today', 'nav-today'),
  ] },
];

// Keep existing step IDs and evidence. Routes only select and order the lessons.
const coreRoute = [
  { id: 'setup', title: '1. 配好 AI', stepIds: ['setup-welcome', 'setup-model', 'setup-save', 'setup-test', 'setup-budget'] },
  { id: 'capture', title: '2. 收集与加工', stepIds: ['capture-save', 'capture-source', 'capture-permission', 'process-ai', 'process-group', 'library-explain'] },
  { id: 'study', title: '3. 学习并确认理解', stepIds: ['study-source-permission', 'study-permission', 'study-plan', 'study-start', 'study-hide', 'study-answer', 'study-feedback', 'study-finish', 'study-confirm'] },
  { id: 'review', title: '4. 体验到期复习', stepIds: ['review-clock-due', 'review-finish'] },
  { id: 'output', title: '5. 检索与输出', stepIds: ['search-keyword', 'output-draft', 'output-citations', 'output-edit', 'output-use'] },
  { id: 'complete', title: '6. 回顾核心体验', stepIds: ['complete-review'] },
];
// Navigation opens the correct surface; focusTarget frames the precise control within it.
const focusTargets = {
  'capture-permission': 'note-privacy', 'study-source-permission': 'note-privacy', 'study-permission': 'note-privacy',
  'process-validity': 'note-validity', 'library-edit': 'note-body', 'study-hide': 'study-hide', 'study-feedback': 'study-feedback',
  'output-edit': 'draft-body', 'output-use': 'draft-use', 'output-unuse': 'draft-use', 'output-capture': 'draft-capture',
  'review-clock-day': 'onboarding-clock-day', 'review-clock-due': 'onboarding-clock-due',
};
const fallbackTargets = {
  'study-hide': ['study-answer', 'study-session'], 'study-answer': ['study-hide'], 'study-followup': ['study-hide'],
  'study-confirm': ['note-confirm'], 'study-feedback': ['study-session'],
  'topic-copy': ['topic-editor'], 'topic-split': ['topic-editor'],
  'capture-permission': ['note-detail'], 'study-source-permission': ['note-detail'], 'study-permission': ['note-detail'],
  'library-edit': ['note-detail'], 'process-validity': ['note-detail'],
  'output-edit': ['output-drafts'], 'output-use': ['output-drafts'], 'output-unuse': ['output-drafts'], 'output-capture': ['output-drafts'],
};
const coreIds = new Set(coreRoute.flatMap(chapter => chapter.stepIds));
export const flatSteps = chapters.flatMap(chapter => chapter.steps.map(item => ({ ...item, focusTarget: focusTargets[item.id], fallbackTargets: fallbackTargets[item.id] || [], chapterId: chapter.id, priority: coreIds.has(item.id) ? 'core' : 'extension' })));
export const coreChapters = coreRoute.map(chapter => ({ id: chapter.id, title: chapter.title, steps: chapter.stepIds.map(id => flatSteps.find(item => item.id === id)) }));
export const coreSteps = coreChapters.flatMap(chapter => chapter.steps);
const extensionTitles = {
  setup: '学习偏好与保存位置', capture: '批量文件导入', process: '手工整理与联网核验', library: '知识管理进阶',
  study: '学习安排与多轮练习', review: '复习进阶与提示案例', mistakes: '错题与争议', topics: '主题学习',
  discover: '语义检索与联系发现', output: '更多输出方式与阶段建议', maintenance: '维护与备份', external: '外部工具与文件协作',
};
export const extensionChapters = chapters.map(chapter => ({ ...chapter, title: extensionTitles[chapter.id], steps: flatSteps.filter(item => item.chapterId === chapter.id && item.priority === 'extension') })).filter(chapter => chapter.steps.length);

const scenarioQueries = {
  course: ['移项', '把加号那一项搬到等号另一边，为什么要减掉？'],
  reading: ['批评', '能不能先看评论，又不把判断全交给别人？'],
  work: ['记录', '哪些消息应该留给所有成员查，哪些要私下处理？'],
  tech: ['finally', '为什么清理已经发生，程序还是失败？'],
  life: ['资产', '大家一起选图，却不该把所有资料给所有人，该先想什么？'],
  custom: ['', '怎样把这条知识用于不同于原文的问题？'],
};
const goalNames = { aware: '了解用途', find: '会查资料', explain: '讲清原理', apply: '换场景应用' };
const curriculumCache = new Map();
export function getCurriculum(materialId) {
  const material = getMaterial(materialId);
  if (!material) return { chapters, flatSteps, coreChapters, coreSteps, extensionChapters };
  if (curriculumCache.has(materialId)) return curriculumCache.get(materialId);
  const [keyword, semantic] = scenarioQueries[materialId];
  const overrides = {
    'setup-welcome': { instruction: '这里是“今日”首页，集中查看学习安排和处理进度。左上角菜单可以打开导航，前往收集、知识库、学习和输出等页面。先按下面的介绍看看首页各块内容。' },
    'capture-save': { sample: materialSample(materialId), expected: materialId === 'custom' ? '资料列表中出现你保存的材料，打开后可以查看原文、心得和出处。' : `资料列表中出现“${material.source.title}”，打开后可以查看原文摘录、心得示例和来源。` },
    'capture-source': { expected: '能读到完整选段、明确的省略标记、作者、链接和许可；模拟心得单独标明。' },
    'process-ai': { instruction: '对刚保存的原文点击“AI 拆解”，等待结果。完成后，看看原文被整理成了哪些候选知识。', expected: '当前原文下方出现拆解出的候选知识，可以逐条打开查看。' },
    'process-group': { instruction: `对照原文检查候选知识，留意这些内容是否被拆开并保留条件：${material.focus.join(' ')} ${material.verification}` },
    'process-manual': { instruction: '对当前原文点击“手动整理为待选学”，填写标题、整理后的正文与出处，学习目标选“讲清原理”。按内容选择类型：数学、代码行为等选择事实，作者看法或个人选择使用对应的观点类型。事实条目保存后可继续联网核验。', sample: null, why: '手工整理适合保存你特别想学的一段内容，之后可以从知识详情回查出处。', expected: '原文下方出现你整理的候选知识，保留标题、正文与出处。' },
    'process-research': { instruction: `对原文主动运行联网加工，审阅返回正文、依据与限制。${material.verification}` },
    'library-filter': { instruction: `搜索“${keyword}”，切换类型、阶段和分组，找到本场景原文与真实拆解条目。` },
    'library-edit': { instruction: '编辑已选知识，补充你自己的观察并保存；保留 AI 整理与个人补充的身份。' },
    'library-explain': { instruction: `从这份原文的候选知识中选一条，练习目标：${material.goals[2][1]}。打开编辑页，将“学习目标”设为“讲清原理”并保存，再点击“加入学习”并填写理由。若条目显示“待核验”，先完成联网加工并查看依据，再加入学习。`, why: '接下来的学习和复习会围绕你选中的这条知识展开。', expected: '选中的知识进入正在学习，可以从详情开始练习。' },
    'study-source-permission': { instruction: '核对本场景原文的外发权限。之前已允许时无需重复授权；仅本地时由你决定是否允许。', expected: '选中知识关联的真实原文允许外发，未授权的其他资料保持本地。' },
    'study-permission': { instruction: '打开刚选中的解释知识，把隐私改为“允许云端”并保存；核对底层原文也已授权。' },
    'study-start': { instruction: `对已选的解释知识点击开始学习。主线问题：${material.recall}` },
    'study-answer': { instruction: `阅读学习会话中的题目，在回答框用自己的话作答：${material.recall} 写好后点击提交，等待反馈。` },
    'study-followup': { instruction: `回答实际 AI 反馈中的追问，保留你自己的表达。可继续思考：${material.followup} 若上轮已结束，重新开始同一知识的练习。` },
    'study-confirm': { instruction: `在“确认我的理解”中，结合刚才的练习和反馈，写下自己的解释。可以按这个顺序整理：${material.confirm} 写好后点击确认。`, sample: null },
    'review-finish': { instruction: `打开这条知识的到期复习，先隐藏材料，再回答本次会话中的新问题：${material.review} 查看反馈后结束练习，看看下一次复习时间。` },
    'topic-create': { title: '建立本场景的学习主题', instruction: '新建主题，选本原文的真实解释与应用知识作为成员，核对目的和顺序后保存。', sample: { title: material.label.slice(2), body: material.goals[2][1] + '\n\n' + material.goals[3][1] } },
    'topic-copy': { instruction: '复制当前主题，保留成员，另起一个符合你本次目标的名字后保存。' },
    'topic-split': { instruction: '复制或拆分当前主题，移除暂不需要的成员，用新的任务目标另存。' },
    'search-keyword': { instruction: `先用“${keyword}”检索，再尝试筛选并打开结果回到原文。${material.retrieval}`, sample: { query: keyword } },
    'search-semantic': { instruction: `清空筛选，允许本次查询外发，选择语义模式搜索“${semantic}”，核对诊断与来源。`, sample: { query: semantic } },
    'output-answer': { instruction: '选择回答问题，填入本场景的问题，亲自允许本次查询外发后生成；核对引用与限制。', sample: { question: material.recall } },
    'output-outline': { instruction: '选择组织提纲，用本场景的输出目标生成提纲；核对哪些部分有原文依据。', sample: { question: `为以下任务组织提纲，不写成已经实践有效的总结：${material.output}` } },
    'output-draft': { instruction: `${material.output} 选择草稿，亲自允许本次查询外发后生成。`, sample: { question: material.output + '\n\n需要应用的练习情境：' + material.transfer + (material.transferCode ? '\n\n' + material.transferCode : '') } },
    'output-edit': { instruction: '打开主线刚生成的草稿，按本场景的用途改写，核对引用、假设与限制后保存。' },
    'output-use': { instruction: '用草稿检查或完善本次练习方案，再勾选这次用到的知识并保存。之后可以在知识详情查看采用记录。' },
    'capture-download': { instruction: '下载本场景的“伴读原文.md”和“应用练习.txt”。原文保留署名与许可，练习问题单独存放，不含参考答案。', downloads: [{ title: '伴读原文.md', material: materialId, companion: true }, { title: '应用练习.txt', material: materialId, exercise: true }] },
    'capture-batch': { instruction: '批量导入刚下载的伴读原文与练习问题文件，保持仅本地，再核对每份来源。主线仍使用之前选中的原文。' },
    'relation-local': { instruction: `对解释知识本地寻找联系。${material.companion?.proposal || '可以另存一份相关原文，核对哪些内容构成补充、条件或对照；相似不等于支持。'}` },
    'relation-ai': { instruction: `仅为参与比较的原文与知识亲自允许外发，再请求 AI 细查联系。${material.companion?.proposal || '核对双方摘录、关系类型与适用边界。'} 返回结果只是待审阅建议。` },
  };
  if (materialId === 'custom') {
    overrides['capture-save'].instruction = '点击“填入示例”，检查之前粘贴的原文和出处。需要时继续修改，保持“仅本地”，亲自保存。';
    overrides['capture-source'].expected = '能读到自己粘贴的完整原文、所填出处和单独的个人心得。';
    overrides['capture-download'] = { instruction: '准备自己的一份补充材料 .md 和一份应用问题 .txt；不含密码或不愿外发的敏感信息。', downloads: [] };
    overrides['capture-batch'].instruction = '批量导入自己准备的两份练习文件，保持仅本地；主线仍使用之前保存的原文。';
    overrides['search-keyword'] = { instruction: material.retrieval, sample: null };
    overrides['library-filter'].instruction = '用自己原文中的核心术语检索，再切换类型、阶段和分组，找到实际原文与拆解条目。';
  }
  ['aware', 'find', 'apply'].forEach((role, index) => {
    const goalIndex = role === 'apply' ? 3 : index;
    overrides[`library-${role}`] = { title: `设置“${goalNames[role]}”目标`, instruction: `在这份原文下另选一条知识，目标：${material.goals[goalIndex][1]}。将“学习目标”设为“${goalNames[role]}”后保存，再${role === 'apply' ? '加入学习' : '设为仅供查阅'}并写下理由。三个扩展目标可以依次用同一条知识体验；没有其他条目时，先手动整理一项内容。事实条目需完成核验后再学习。`, expected: '这条知识显示所选目标，之后可以继续体验其他目标；核心流程仍围绕之前选中的知识。' };
  });
  const rows = flatSteps.map(item => {
    if (item.caseId) return item;
    const row = { ...item, ...overrides[item.id] };
    for (const field of ['title', 'instruction', 'expected']) if (row[field]) row[field] = row[field].replaceAll('学习深度', '学习目标').replaceAll('能够迁移应用', '换场景应用').replaceAll('能够解释', '讲清原理').replaceAll('解释示例', '选中的解释知识').replaceAll('应用示例', '选中的应用知识');
    if (row.chapterId === 'study' && !['study-defer', 'study-plan', 'study-reason'].includes(row.id)) row.noteRole ||= 'explain';
    if (['output-edit', 'output-use', 'output-unuse', 'output-capture'].includes(row.id)) row.noteRole = 'draft';
    return row;
  });
  const mapped = chapters.map(chapter => ({ ...chapter, steps: rows.filter(row => row.chapterId === chapter.id) }));
  const core = coreRoute.map(chapter => ({ id: chapter.id, title: chapter.title, steps: chapter.stepIds.map(id => rows.find(row => row.id === id)) }));
  const result = { chapters: mapped, flatSteps: rows, coreChapters: core, coreSteps: core.flatMap(chapter => chapter.steps), extensionChapters: mapped.map(chapter => ({ ...chapter, title: extensionTitles[chapter.id], steps: chapter.steps.filter(row => row.priority === 'extension') })).filter(chapter => chapter.steps.length) };
  curriculumCache.set(materialId, result);
  return result;
}
