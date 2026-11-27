import { noteKindNames, learningStageNames, learningDepthNames, unknownClassificationFields } from './note-classification.mjs';

const fields = {
  kind: ['资料类别', noteKindNames],
  stage: ['学习阶段', learningStageNames],
  depth: ['学习目标', learningDepthNames],
};

// Both readers submit only the fields that were unknown in the displayed version.
export function classificationInputs(note) {
  const controls = document.createDocumentFragment();
  for (const key of unknownClassificationFields(note)) {
    const [name, options] = fields[key];
    const raw = key === 'kind' ? note.kind : note.meta?.[key];
    const label = document.createElement('label');
    label.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = name + '（原值 ' + JSON.stringify(raw) + '）';
    const select = document.createElement('select');
    select.name = key;
    select.required = true;
    select.add(new Option('请选择', ''));
    for (const [value, text] of Object.entries(options)) select.add(new Option(text, value));
    label.append(caption, select);
    controls.append(label);
  }
  return controls;
}
