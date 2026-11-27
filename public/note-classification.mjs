// Persisted identifiers and their established names in the Vault.
const kinds = [
  ['source', '原始资料', '01 原始资料'],
  ['knowledge', '知识', '02 知识'],
  ['mistake', '错题', '03 错题修正'],
  ['topic', '主题学习包', '04 主题'],
  ['report', 'AI 整理建议', '05 发现'],
];
export const noteKinds = Object.freeze(kinds.map(([id]) => id));
export const noteKindNames = Object.freeze(Object.fromEntries(kinds.map(([id, name]) => [id, name])));
export const noteFolders = Object.freeze(Object.fromEntries(kinds.map(([id, , folder]) => [id, folder])));

const stages = [
  ['reference', '仅供查阅', false],
  ['candidate', '待选学', false],
  ['learning', '正在学习', true],
  ['integrated', '个人理解', true],
  ['core', '重点知识', true],
  ['retired', '不再使用', false],
];
export const learningStages = Object.freeze(stages.map(([id]) => id));
export const learningStageNames = Object.freeze(Object.fromEntries(stages.map(([id, name]) => [id, name])));
const studyStages = new Set(stages.filter(([, , allowsStudy]) => allowsStudy).map(([id]) => id));
export const isStudyStage = id => studyStages.has(id);

export const learningDepthNames = Object.freeze({ aware: '了解用途', find: '会查资料', explain: '讲清原理', apply: '换场景应用' });
export const learningDepths = Object.freeze(Object.keys(learningDepthNames));
