// Native wording changes presentation only. Completion still comes from the
// frozen curriculum's real operation evidence; a page visit never passes a step.
const instructions = {
  "setup-welcome":
    "底部依次是今日、收集、知识库、学习和输出。设置与任务在今日页进入。",
  "setup-model":
    "在设置的外部服务中打开模型配置，填写 HTTPS 地址、模型和密钥，再启用。密钥只填在服务配置中。",
  "setup-save":
    "轻触测试并保存。使用当前表单测试成功后保存连接，练习库与正式库共用此配置。",
  "setup-test":
    "核对测试并保存的成功回执。测试会真实调用服务并可能计费；失败保留输入，不连续重试。",
  "setup-budget":
    "在用量与费用查看请求上限、预算和已知费用。未知费用须进入调用恢复核对。",
  "capture-save":
    "复制本步材料，进入收集页粘贴原文并填写标题与出处。先关闭 AI 拆解，再保存原文。",
  "capture-source":
    "在知识库打开刚保存的原文，核对完整内容、来源与依据；长文使用继续阅读。",
  "capture-permission":
    "保存原文只留在本机。主动使用 AI 拆解才会发送所需内容并可能计费。",
  "process-ai":
    "在原文详情轻触 AI 拆解，亲自确认外发与费用，随后到任务查看进度。",
  "process-group":
    "在原文详情打开拆解后的知识，核对来源；资料结构可查看和编辑单元、维度与联系。",
  "library-explain":
    "打开适合解释的知识，在学习目标与阶段中选择能够解释、加入学习，保存决定。",
  "study-source-permission":
    "学习使用已有原始材料，主动作答和请求反馈才会调用所配置的模型。",
  "study-permission":
    "先核对材料和学习目标。AI 反馈是建议，你的回答、个人理解和最终确认分别保留。",
  "study-plan": "回到今日，生成计划。未列入的知识可在未安排知识中检查原因。",
  "study-start":
    "从今日计划或知识详情开始练习。继续已有学习记录时不要另建会话。",
  "study-hide":
    "读完材料后合上原文再作答；需要重读时使用再看原文，系统会保留提示使用记录。",
  "study-answer":
    "用自己的话作答并提交。回答会保存，等待模型反馈期间不要重复创建请求。",
  "study-feedback":
    "阅读真实反馈，核对原文与限制；需要时继续回答。等待和失败不表示学习完成。",
  "study-finish":
    "完成本轮回答与反馈后，使用结束本次学习。完成条件由学习记录核验。",
  "study-confirm":
    "打开我的理解，写下自己的解释、条件和例子后保存；不直接把 AI 建议当作个人理解。",
  "review-clock-due":
    "回到新手引导，轻触跳到下次复习；它只推进独立练习日期，不改变设备时间。",
  "review-finish": "从今日的到期安排开始复习，作答、核对反馈，再结束本次学习。",
  "search-keyword":
    "复制本步关键词，打开检索；可按类型、阶段、主题和日期筛选，再打开来源。",
  "output-draft":
    "复制本步任务，进入输出，选择草稿与取材范围，亲自允许本次使用外部模型后生成。",
  "output-citations":
    "打开输出中的引用，回到原文核对支持范围；本地材料不会标为 AI 草稿。",
  "output-edit":
    "打开编辑与确认采用，修改正文。阅读预览与 Markdown 编辑共用当前输入，不自动覆盖原文。",
  "output-use":
    "仅勾选实际采用的引用后保存。取消采用也会保留对应记录，不等于知识晋级。",
  "complete-review":
    "回顾收集、整理、学习、理解和输出。回正式库前保存草稿；练习结果留在独立练习库。",
};
export function nativeInstruction(step) {
  return (
    instructions[step.id] || step.instruction.replace(/点击|单击/g, "轻触")
  );
}
