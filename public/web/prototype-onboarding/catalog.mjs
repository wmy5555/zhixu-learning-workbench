// Throwaway UI prototype: three guide structures on the new web shell.
// Old curriculum IDs retained; presentation and anchors are independently designed.
const s = (id,chapter,view,target,title,instruction,expected,evidence=null,requires=[]) =>
  ({id,chapter,view,target,title,instruction,expected,evidence,requires,fallbackTargets:id==='study-hide'?['answer-form']:[],kind:evidence?'action':'read',version:1});
export const chapters = ['初识与准备','收集与加工','把知识变成理解','让理解留下来','从理解到表达','回顾与继续'];
export const steps = [
  s('setup-welcome',0,'today','first-step','从一个小小的起点开始','今日页把需要关注的事情放在一起。我们会用同一份练习材料，走完从收集到表达的过程。','认识今日页与收集入口。'),
  s('setup-model',0,'settings','model-choice','先认识 AI 的工作方式','选择本次体验的模拟模型。真实使用时，这里才会填写供应商与模型信息。','已选择演示能力。','model'),
  s('setup-save',0,'settings','save-model','保存这次能力设置','点击页面中的“保存演示配置”。引导只负责指路，由你完成实际操作。','演示配置已保存。','config',['model']),
  s('setup-test',0,'settings','test-model','确认它已经准备好','点击“模拟测试连接”。失败会留在当前步骤，并给你重试的入口。','模拟连接返回成功。','connected',['config']),
  s('setup-budget',0,'settings','budget','先知道边界，再放心开始','练习与正式使用会共用真实服务预算。这份原型没有连接模型，不产生调用费用。','知道外发与费用需要单独确认。'),
  s('capture-save',1,'capture','capture-form','把第一份材料放到书桌上','填入示例，也可以改写它，再点击“保存到练习空间”。先留下原文，稍后再加工。','当前练习材料已保存。','source',['connected']),
  s('capture-source',1,'read','original','先看一眼完整的原文','原始资料始终保留。加工出的知识和自己的理解，会有各自的位置。','能找到原文和它的来源。',null,['source']),
  s('capture-permission',1,'read','source-consent','授权只属于这一份材料','亲自勾选这份示例的外发许可。本地保存不会替你开启它。原型仅记录模拟许可。','这份练习原文已获模拟许可。','sourceConsent',['source']),
  s('process-ai',1,'read','process','让材料长出第一条知识','点击“模拟拆解”。完成后可以看到与原文相连的知识卡；示例内容不是实际 AI 生成。','模拟加工完成，出现知识卡。','processed',['connected','sourceConsent']),
  s('process-group',1,'library','knowledge-card','原文和知识，保持相连','每条知识都可以回到来源。先看一眼这张卡片，我们继续用它练习。','能区分原文与知识。',null,['processed']),
  s('library-explain',1,'library','select-knowledge','挑一条真正想弄明白的','点击知识卡上的“用这条练习”，把注意力放在一个问题上。','已选定本次练习知识。','selected',['processed']),
  s('study-source-permission',2,'read','source-consent','确认原文的使用范围','检查这份原文的模拟外发许可；未开启时请亲自选择。已有许可继续生效，助手不会替你授权。','原文有模拟外发许可。','sourceConsent',['source']),
  s('study-permission',2,'study','knowledge-consent','知识也有自己的许可','这条知识与原文分别控制外发。勾选知识的模拟外发许可后，再继续。','练习知识已获模拟许可。','knowledgeConsent',['selected']),
  s('study-plan',2,'study','add-plan','给这次理解留一个位置','点击“加入今日学习”。主动选择要学什么，收藏本身不会自动变成学习任务。','这条知识已经加入练习清单。','planned',['selected','knowledgeConsent']),
  s('study-start',2,'study','start-study','开始一次小小的练习','点击“开始本轮练习”。先读，再用自己的话解释。','本轮模拟练习已开始。','started',['planned']),
  s('study-hide',2,'study','hide-material','先合上材料，再想一想','读完材料后，点击“合上材料”。不必背出原句，留下此刻真实的理解就好。','材料已收起，回答区域出现。','hidden',['started']),
  s('study-answer',2,'study','answer-form','用自己的话说清楚','写下你的解释并保存。回答会留在这次浏览器内存中，刷新后清空。','已保存你的练习回答。','answered',['hidden']),
  s('study-feedback',2,'study','feedback','把反馈当作继续思考的线索','这里展示预设反馈，供你体验阅读动线。它不是对你的回答做出的真实评价。','知道自己的回答与建议分别保留。',null,['answered']),
  s('study-finish',2,'study','finish-study','亲自结束这一轮','看完反馈后，点击“结束本轮练习”。提交回答与结束一轮是两个动作。','这轮模拟练习已结束。','finished',['answered']),
  s('study-confirm',2,'study','confirm-understanding','最后，把理解写成自己的','写下一句自己确认的理解，再点击“保存我的理解”。示例建议不会自动成为你的结论。','保存了自己确认的理解。','understood',['finished']),
  s('review-clock-due',3,'review','review-clock','让复习来到眼前','点击“跳到下次复习”。这里只调整模拟学习时钟，不改变电脑时间或正式安排。','模拟复习任务已经到期。','due',['understood']),
  s('review-finish',3,'review','review-form','过一段时间，再试着想起来','重新解释这个想法并提交。原型不判断掌握程度，只让你走通复习操作。','本次模拟复习已经提交。','reviewed',['due']),
  s('search-keyword',4,'search','search-form','需要时，把想法找回来','输入练习材料中的词，例如“问题”，点击检索。结果会带你回到同一份来源。','找到了本次练习材料。','searched',['source']),
  s('output-draft',4,'output','make-draft','把理解组织成一段表达','点击“生成示例草稿”。这份预设文本展示引用与编辑方式，不代替你的判断。','示例草稿已展开。','draft',['searched','understood']),
  s('output-citations',4,'output','citations','每一个引用，都找得到出处','看看引用卡片中的原文与位置。输出中的建议和原始材料仍然可区分。','能查看这段表达的来源。',null,['draft']),
  s('output-edit',4,'output','edit-draft','再改成自己的表达','调整草稿后，点击“保存草稿”。这一步保留你亲自编辑的版本。','草稿修改已保存。','edited',['draft']),
  s('output-use',4,'output','use-draft','由你决定，什么时候采用','确认这段文字适合本次用途后，点击“标记已采用”。助手不能替你完成这个决定。','已亲自标记采用。','adopted',['edited']),
  s('complete-review',5,'complete','journey-complete','一条完整的思考路径，走通了','从原文到知识，从回答到自己的表达。接下来可以结束引导，也可以按需要探索扩展功能。','完成本次核心体验。'),
];
export const materials = {
  reading:{label:'读书与思考',title:'同一段文字，不同的问题',body:'【原创虚构练习】小岚读到一段文字：书店将同一本书分别放在“寻找答案”和“提出问题”两个书架。她决定先写清自己的问题，再决定引用哪一段。\n\n她把摘录与自己的理解分开保存，也记下章节位置，方便下次回到原文。',knowledge:'先明确自己的问题，再选择支撑观点的摘录。'},
  work:{label:'工作与协作',title:'把一次讨论变成共同理解',body:'【原创虚构练习】小岚和同事讨论一个新方案。他们先写下各自想解决的问题，再区分事实、假设与个人建议。\n\n会议结束时，大家记录决定的理由和下一步，并保留原始讨论的位置。',knowledge:'讨论方案前，先区分共同问题、已知事实与个人建议。'},
  code:{label:'自学与技能',title:'理解一个小程序',body:'【原创虚构练习】小岚学习列表与循环。她先用一句话写出程序要解决的问题，再逐行解释输入怎样变成输出。\n\n她保留代码原文，将自己的解释单独写下，第二天合上材料再复述。',knowledge:'先说明程序解决的问题，再追踪输入到输出的过程。'},
};
export const goalSpecs = {
  capture:{label:'把一份材料变成知识',end:10,match:/文章|资料|收集|导入|拆解|加工/},
  study:{label:'开始学习并确认理解',end:19,match:/学习|开始学|怎么学|学会|解释|理解|回答|掌握/},
  review:{label:'找到并完成到期复习',end:21,match:/复习|记不住|忘|到期/},
  output:{label:'找到知识，写出有来源的表达',end:26,match:/检索|搜索|输出|引用|草稿|写作|表达/},
  setup:{label:'检查能力设置与连接',end:4,match:/连接|配置|模型|服务|失败|出错|不能用|ai/i},
};
export const evidenceOwner = Object.fromEntries(steps.filter(x=>x.evidence).map(x=>[x.evidence,x.id]));
evidenceOwner.sourceConsent='capture-permission';
