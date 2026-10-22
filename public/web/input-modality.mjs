// Focus rings follow the current input method, including programmatic focus.
export function installInputModality(root, events) {
  root.dataset.inputModality = 'pointer';
  const pointer = () => { root.dataset.inputModality = 'pointer'; };
  const keyboard = event => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    root.dataset.inputModality = 'keyboard';
  };
  events.addEventListener('pointerdown', pointer, true);
  events.addEventListener('keydown', keyboard, true);
  return () => {
    events.removeEventListener('pointerdown', pointer, true);
    events.removeEventListener('keydown', keyboard, true);
    delete root.dataset.inputModality;
  };
}
