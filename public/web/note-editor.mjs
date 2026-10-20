import { createMarkdownEditor } from '../markdown-editor.mjs';

// Reuse the established draft/parser/image guards without loading the old UI skin.
export function mountNoteEditor(form, note, onChange) {
  const textarea = form.querySelector('[name="body"]');
  const editor = createMarkdownEditor(textarea, { value: note.body || '', onChange });
  form.querySelector('#note-body-editor').append(editor);
  editor.mount(document.querySelector('#main'));
  return editor;
}

export function noteEditSession(note, { read, write }) {
  let expectedHash = note.hash;
  return {
    async save() {
      const snapshot = { ...read() };
      if (!snapshot.body.trim()) throw new Error('请先写下正文，再保存修改。');
      const updated = await write(note.id, { ...snapshot, expectedHash });
      expectedHash = updated.hash;
      const current = read();
      return { updated, snapshot, hasNewInput: current.title !== snapshot.title || current.body !== snapshot.body };
    },
  };
}
