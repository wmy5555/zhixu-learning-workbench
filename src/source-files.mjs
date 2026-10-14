import { randomUUID } from 'node:crypto';
import { decodeFile, readAttachment, writeAttachment, extractWord } from './attachments.mjs';
import { fail, now, hash } from './store.mjs';

export const sourceAttachments = note => [note.meta?.sourceFile, ...(note.meta?.attachments || [])].filter(Boolean);
export function createSourceFiles({ store, getNote }) {
  const receipt = id => {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) fail('上传回执无效。');
    const value = store.get('attachmentUploads', id);
    if (!value || value.state === 'reverted') fail('上传已撤销或不存在，请重新选择文件。', 'UPLOAD_MISSING', 409);
    return value;
  };
  function receive({ name, mime, bytes, uploadId }) {
    if (typeof uploadId !== 'string' || !/^[a-f0-9-]{36}$/.test(uploadId)) fail('上传身份无效。');
    const file = decodeFile({ name, mime, bytes }), previous = store.get('attachmentUploads', uploadId);
    if (previous) {
      if (previous.attachment.id !== file.descriptor.id || previous.attachment.name !== name || previous.state === 'reverted') fail('上传身份已被其他文件使用或已撤销。', 'UPLOAD_CONFLICT', 409);
      readAttachment(store.vaultDir, previous.attachment);
      return previous;
    }
    if (store.records('attachmentUploads').filter(item => item.state === 'pending').length >= 50) fail('最多暂存 50 份文件，请先保存或移除已有上传。', 'UPLOAD_LIMIT', 409);
    writeAttachment(store.vaultDir, file);
    return store.put('attachmentUploads', uploadId, { id: uploadId, state: 'pending', noteId: randomUUID(), attachment: file.descriptor, createdAt: now() });
  }
  function revert(id) {
    if (store.get('attachmentUploads', id)?.state === 'reverted') return { reverted: true, retained: true };
    const value = receipt(id);
    // Revert never deletes bytes, a bound file, a history reference, or other upload.
    if (value.state === 'bound') return { reverted: false, retained: true };
    store.put('attachmentUploads', id, { ...value, state: 'reverted' });
    return { reverted: true, retained: true };
  }
  const converting = new Set();
  async function commit({ uploadId, privacy = 'local', title = '' }) {
    const value = receipt(uploadId), file = readAttachment(store.vaultDir, value.attachment);
    store.scan();
    if (store.row(value.noteId)) {
      const note = store.read(value.noteId);
      if (note.meta.sourceFile?.id !== value.attachment.id) fail('资料身份冲突。', 'UPLOAD_CONFLICT', 409);
      store.put('attachmentUploads', uploadId, { ...value, state: 'bound' });
      return { note, duplicate: true };
    }
    if (value.state === 'bound') fail('已保存资料被移除；重试不会自动重建，请重新选择文件。', 'SOURCE_REMOVED', 409);
    const existing = store.list().find(note => note.kind === 'source' && note.meta.sourceFile?.id === file.descriptor.id);
    if (existing) {
      store.put('attachmentUploads', uploadId, { ...value, noteId: existing.id, state: 'bound' });
      return { note: existing, duplicate: true };
    }
    if (converting.has(file.descriptor.id)) fail('该文件正在保存，请稍后重试。', 'CONVERSION_BUSY', 409);
    converting.add(file.descriptor.id);
    try {
      const extraction = file.descriptor.kind === 'word' ? await extractWord(file) : null;
      // A concurrent revert may arrive while the worker runs.
      receipt(uploadId); store.scan();
      const note = store.create({ id: value.noteId, exclusive: true, kind: 'source', title: String(title || file.descriptor.name).slice(0, 180),
        body: extraction?.text || '此资料的原文件保存在附件中。请查看附件；此处不代表文件正文。',
        meta: { privacy: privacy === 'cloud' ? 'cloud' : 'local', stage: 'reference', sourceFile: file.descriptor,
          ...(extraction ? { textExtraction: { ...extraction, sourceSha256: file.descriptor.sha256, textSha256: hash(extraction.text), extractedAt: now() } } : {}) } });
      store.put('attachmentUploads', uploadId, { ...value, state: 'bound' });
      return { note, duplicate: false };
    } finally { converting.delete(file.descriptor.id); }
  }
  function bindImages(note, uploadIds) {
    if (!Array.isArray(uploadIds) || uploadIds.length > 20) fail('一次最多插入 20 张图片。');
    if (note.kind !== 'source') fail('图片附件只能插入第一层原始资料。', 'SOURCE_FILE_ONLY', 409);
    const values = uploadIds.map(receipt);
    const attachments = [...(note.meta.attachments || [])];
    for (const value of values) {
      if (value.state === 'bound' && value.noteId !== note.id) fail('上传已绑定其他资料，请重新上传。', 'UPLOAD_CONFLICT', 409);
      const file = readAttachment(store.vaultDir, value.attachment);
      if (file.descriptor.kind !== 'image') fail('原文插图仅支持 PNG/JPEG/GIF/WebP。');
      if (!attachments.some(a => a.id === file.descriptor.id)) attachments.push(file.descriptor);
    }
    if (attachments.length > 100) fail('每份原始资料最多关联 100 张插图。');
    return { attachments, complete: () => values.forEach(value => store.put('attachmentUploads', value.id, { ...value, noteId: note.id, state: 'bound' })) };
  }
  function read(noteId, assetId) {
    const note = getNote(noteId), descriptor = sourceAttachments(note).find(item => item.id === assetId);
    if (note.kind !== 'source' || !descriptor) fail('该原始资料没有此附件。', 'NOT_FOUND', 404);
    return readAttachment(store.vaultDir, descriptor);
  }
  const pending = () => store.records('attachmentUploads').filter(item => item.state === 'pending');
  return { receive, revert, commit, bindImages, read, pending };
}
