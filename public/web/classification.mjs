// Web labels and option order. Purpose-specific choices stay separate from learning eligibility.
const kinds = [
  ['source', '原始资料', true],
  ['knowledge', '知识', true],
  ['topic', '主题学习包', false],
  ['report', 'AI 整理建议', false],
  ['mistake', '错题', true],
];
const stages = [
  ['reference', '仅供查阅', '先留作查阅'],
  ['candidate', '待选学', '放进待选学'],
  ['learning', '正在学习', '加入学习'],
  ['integrated', '个人理解', '已整理个人理解'],
  ['core', '重点知识', '重点知识'],
  ['retired', '不再使用', '暂时不再使用'],
];
const kindLabels = new Map(kinds.map(([value, label]) => [value, label]));
const stageLabels = new Map(stages.map(([value, label]) => [value, label]));
export const kind = value => kindLabels.get(value) || '资料';
export const stage = value => stageLabels.get(value) || '尚未分类';
export const kindOptions = [['', '全部类别'], ...kinds.map(([value, label]) => [value, label])];
export const stageOptions = [['', '全部学习状态'], ...stages.map(([value, label]) => [value, label])];
export const quickKindOptions = [['', '全部'], ...kinds.filter(([, , quick]) => quick).map(([value, label]) => [value, label])];
export const purposeOptions = stages.map(([value, , label]) => [value, label]);
