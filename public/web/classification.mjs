import { noteKinds, noteKindNames, learningStages, learningStageNames, learningDepths } from '../note-classification.mjs';

export const kind = value => typeof value === 'string' && Object.hasOwn(noteKindNames, value) ? noteKindNames[value] : '资料';
export const stage = value => typeof value === 'string' && Object.hasOwn(learningStageNames, value) ? learningStageNames[value] : '尚未分类';
const kindOption = id => [id, noteKindNames[id]];
// The full web filter places mistakes last; the quick filter shows only these three kinds.
export const kindOptions = [['', '全部类别'], ...[...noteKinds].sort((a, b) => Number(a === 'mistake') - Number(b === 'mistake')).map(kindOption)];
export const quickKindOptions = [['', '全部'], ...['source', 'knowledge', 'mistake'].map(kindOption)];
export const stageOptions = [['', '全部学习状态'], ...learningStages.map(id => [id, learningStageNames[id]])];

const purposes = { reference: '先留作查阅', candidate: '放进待选学', learning: '加入学习',
  integrated: '已整理个人理解', core: '重点知识', retired: '暂时不再使用' };
const depthLabels = { aware: '知道它是什么', find: '需要时能找回', explain: '能用自己的话解释', apply: '能在情境中应用' };
export const purposeOptions = learningStages.map(id => [id, purposes[id]]);
export const depthOptions = learningDepths.map(id => [id, depthLabels[id]]);
