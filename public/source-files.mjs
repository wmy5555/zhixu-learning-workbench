import { el, button, field } from './ui.mjs';
import { request, uploadAttachment, attachmentUrl } from './api.mjs';
import { MAX_FILE_BYTES } from './source-file-limits.mjs';

export const fileAccept = { 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp', 'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const fileFormatNames = { png: 'PNG 图片', jpg: 'JPEG 图片', jpeg: 'JPEG 图片', gif: 'GIF 图片', webp: 'WebP 图片', pdf: 'PDF 文档', doc: 'Word 文档', docx: 'Word 文档' };
function acceptedTypeLabels(acceptedTypes) {
  const groups = new Map();
  for (const [extension, mime] of Object.entries(fileAccept)) {
    if (!acceptedTypes.includes(mime)) continue;
    const group = groups.get(mime) || { name: fileFormatNames[extension], extensions: [] };
    group.extensions.push(extension);
    groups.set(mime, group);
  }
  return [...groups.values()].map(group => `${group.name}（.${group.extensions.join(' / .')}）`);
}
export function pickerFileType(file, detected) {
  const mime = String(detected || '').toLowerCase();
  // Some Windows installations report Office files as generic binary data.
  // The server still validates MIME, extension, signature and size on upload.
  return !mime || mime === 'application/octet-stream'
    ? fileAccept[file.name.split('.').at(-1).toLowerCase()] || mime
    : mime;
}
export const canProcessFile = note => !note.meta?.sourceFile || note.meta.sourceFile.format === 'docx' && Boolean(note.meta.textExtraction?.text?.trim());
export function sourceFileNotice(note) {
  const file = note.meta?.sourceFile, extraction = note.meta?.textExtraction;
  if (!file) return '';
  return file.format === 'docx'
    ? (extraction?.warnings || []).join(' ') + ' AI只接收首次提取的文字，不读取原件或后续补充说明。'
    : file.format === 'doc' ? '旧版 DOC 仅保存原件，暂不转换或提交AI。请自行另存为 DOCX 后导入。'
    : '图片和 PDF 暂仅保存在第一层，不进行 OCR、AI拆解或直接整理为知识。';
}
export function attachmentPanel(note) {
  const files = [note.meta?.sourceFile, ...(note.meta?.attachments || [])].filter(Boolean);
  if (!files.length) return null;
  return el('section', { class: 'panel soft source-attachments' }, [
    el('h3', { text: '原始附件' }),
    sourceFileNotice(note) ? el('p', { class: 'notice', text: sourceFileNotice(note) }) : null,
    note.meta?.textExtraction ? el('details', {}, [
      el('summary', { text: 'Word 提取文字（AI输入）· ' + ({partial:'部分覆盖',empty:'无文字',failed:'转换失败',unsupported:'暂不转换'}[note.meta.textExtraction.status] || '未确认') }),
      el('pre', { class: 'extracted-text', text: note.meta.textExtraction.text || '没有可供AI处理的提取文字。' }),
    ]) : null,
    ...files.map(file => el('div', { class: 'attachment-card' }, [
      el('p', { text: file.name + ' · ' + Math.ceil(file.size / 1024) + ' KB' }),
      file.kind === 'image' ? el('img', { src: attachmentUrl(note.id, file.id), alt: file.name, loading: 'lazy', class: 'source-image' }) : null,
      file.kind === 'pdf' ? el('a', { href: attachmentUrl(note.id, file.id), target: '_blank', rel: 'noopener noreferrer', text: '在浏览器中查看 PDF' }) : null,
      file.kind === 'pdf' ? el('p', { class: 'notice', text: 'PDF 由浏览器查看器显示，大文件加载可能需要更久。若出现空白、灰屏或加载失败，请点击“下载原件”，再用本机 PDF 阅读器打开；原件仍保留在资料库中。' }) : null,
      el('a', { href: attachmentUrl(note.id, file.id, true), download: file.name, text: '下载原件' }),
    ])),
  ]);
}
export const imageReference = file => '![' + file.name.replace(/[\[\]\\\r\n]/g, '') + '](../.zhixu-attachments/' + file.id + ')';

// Shared attachment contract for a future rich editor. No global paste handlers.
export async function createFilePicker(input, { imagesOnly = false, onChange = () => {}, onUploaded = () => {}, onRemoved = () => {} } = {}) {
  const [pond, type, size, preview] = await Promise.all([
    import('/vendor/filepond.esm.js'), import('/vendor/filepond-plugin-file-validate-type.esm.js'),
    import('/vendor/filepond-plugin-file-validate-size.esm.js'), import('/vendor/filepond-plugin-image-preview.esm.js'),
  ]);
  pond.registerPlugin(type.default, size.default, preview.default);
  const ids = new WeakMap();
  const errors = new Map();
  const uploadStatus = el('p', { class: 'notice', role: 'status', ariaLive: 'polite', hidden: true });
  const showErrors = () => { uploadStatus.textContent = [...errors.values()].join('；'); uploadStatus.hidden = !errors.size; };
  const acceptedTypes = [...new Set(Object.values(fileAccept).filter(mime => !imagesOnly || mime.startsWith('image/')))];
  // Keep format help outside FilePond's two-column, animated file status.
  const formatHelp = el('p', { class: 'file-picker-formats', text: '支持格式：' + acceptedTypeLabels(acceptedTypes).join('、') + '。' });
  input.accept = acceptedTypes.join(',');
  const instance = pond.create(input, {
    allowMultiple: true, maxFiles: 20, maxParallelUploads: 2, maxFileSize: MAX_FILE_BYTES, instantUpload: true,
    labelMaxFileSizeExceeded: '文件超过 50 MB', labelMaxFileSize: '每份最多 50 MB（50,000,000 字节）',
    allowPaste: false, allowDrop: true, dropOnPage: false, dropOnElement: true, allowDirectoriesOnly: false,
    allowImagePreview: true, imagePreviewMaxFileSize: '2MB', imagePreviewMaxHeight: 160,
    acceptedFileTypes: acceptedTypes,
    labelFileTypeNotAllowed: '不支持此文件格式',
    fileValidateTypeLabelExpectedTypes: '请按下方支持格式重新选择',
    labelButtonRemoveItem: '移除此文件',
    // Folder drops are expanded by FilePond; reject their nested paths before upload.
    beforeAddFile: item => typeof item.source !== 'string' && !String(item.relativePath || '').replace(/^\//, '').includes('/'),
    fileValidateTypeDetectType: (file, detected) => Promise.resolve(pickerFileType(file, detected)),
    labelIdle: '拖入文件或 <span class="filepond--label-action">选择文件</span>',
    labelFileProcessing: '上传到本机', labelFileProcessingComplete: '已暂存，尚未保存资料', labelFileProcessingError: '上传失败',
    labelTapToCancel: '点击取消此项', labelTapToRetry: '点击重试', labelTapToUndo: '移除临时上传',
    server: {
      process: (_name, file, _metadata, load, error, progress, abort) => {
        if (!ids.has(file)) ids.set(file, crypto.randomUUID());
        errors.delete(file); showErrors();
        return uploadAttachment(file, { uploadId: ids.get(file), load: (id, receipt) => { load(id); onUploaded(receipt); },
          error: message => { errors.set(file, file.name + '：' + message); showErrors(); error(message); }, progress, abort });
      },
      revert: (id, load, error) => { request('/api/uploads/' + encodeURIComponent(id), { method: 'DELETE' }).then(load).catch(cause => error(cause.message)); },
      fetch: null, restore: null, load: null,
    },
    onupdatefiles: onChange, onprocessfile: onChange, onprocessfileabort: onChange, onremovefile: (error, file) => {
      if (!error) { errors.delete(file.file); showErrors(); onRemoved(ids.get(file.file)); } onChange();
    },
  });
  // FilePond's generic error label hides the server's actionable quota message.
  // Keep the message as plain text outside its HTML-based status renderer.
  instance.element.after(formatHelp);
  formatHelp.after(uploadStatus);
  const observer = new MutationObserver(() => {
    if (!instance.element.isConnected) { observer.disconnect(); instance.destroy(); formatHelp.remove(); uploadStatus.remove(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return instance;
}
export function imageInsertControls(body, uploadIds, { getNote = () => null } = {}) {
  const input = el('input', { type: 'file', multiple: true, accept: '.png,.jpg,.jpeg,.gif,.webp' });
  const status = el('p', { role: 'status' });
  let started = false;
  const inserted = new Map();
  const staged = el('div', { class: 'page-stack' });
  const read = () => body.markdownEditor?.getValue() ?? body.value;
  const write = value => {
    if (body.markdownEditor) body.markdownEditor.setValue(value); else body.value = value;
    body.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const remember = receipt => {
    if (!uploadIds.includes(receipt.id)) uploadIds.push(receipt.id);
    status.textContent = '图片已暂存；保存正文后才会绑定。未保存的图片显示占位，原件只在本机保存。';
  };
  const remove = id => {
    const index = uploadIds.indexOf(id); if (index < 0) return;
    uploadIds.splice(index, 1);
    const snapshot = inserted.get(id);
    if (snapshot && read() === snapshot.after) {
      write(snapshot.before);
      status.textContent = '已撤销这次未保存的插图，原有正文保留。';
    } else status.textContent = '临时上传已撤销；正文已继续修改或尚未插入，未自动改写。若仍有对应图片引用，请手动移除。';
    inserted.delete(id);
  };
  const insert = receipt => {
    if (uploadIds.includes(receipt.id)) return;
    remember(receipt);
    const before = read(), markup = '\n' + imageReference(receipt.attachment) + '\n';
    if ((!body.markdownEditor || body.markdownEditor.getMode() === 'source') && typeof body.setRangeText === 'function') {
      body.setRangeText(markup, body.selectionStart, body.selectionEnd, 'end');
      write(body.value);
    } else write(before + markup);
    inserted.set(receipt.id, { before, after: read() });
  };
  const panel = el('section', { class: 'panel soft' }, [
    button('插入本地图片', { onClick: () => {
      if (started) return;
      started = true; panel.append(input);
      createFilePicker(input, { imagesOnly: true, onUploaded: insert, onRemoved: remove }).catch(error => { status.textContent = error.message; });
    } }),
    el('p', { text: '图片只保存到第一层；不会上传到第三方或作为AI输入。' }), status, staged,
  ]);
  panel.editorOptions = {
    assetResolver: target => {
      const note = getNote();
      const image = [note?.meta?.sourceFile, ...(note?.meta?.attachments || [])].find(file => file?.kind === 'image' && target === '../.zhixu-attachments/' + file.id);
      return image ? attachmentUrl(note.id, image.id) : '';
    },
    uploadImage: file => new Promise((resolve, reject) => {
      uploadAttachment(file, { uploadId: crypto.randomUUID(), progress() {}, abort: () => reject(new Error('图片上传已取消。')),
        error: message => reject(new Error(message)), load: (_id, receipt) => {
          remember(receipt);
          const undo = button('撤销暂存图片：' + receipt.attachment.name, { onClick: async () => {
            if (!uploadIds.includes(receipt.id)) { undo.remove(); return; }
            undo.disabled = true;
            try { await request('/api/uploads/' + encodeURIComponent(receipt.id), { method: 'DELETE' }); remove(receipt.id); undo.remove(); }
            catch (error) { status.textContent = error.message; undo.disabled = false; }
          } });
          staged.append(undo);
          resolve({ attachmentId: receipt.attachment.id, markdownUrl: '../.zhixu-attachments/' + receipt.attachment.id,
            onInserted: snapshot => inserted.set(receipt.id, snapshot) });
        } });
    }),
  };
  return panel;
}
export function createFileImportPanel({ onSaved, onError }) {
  const input = el('input', { type: 'file', multiple: true, accept: Object.keys(fileAccept).map(ext => '.' + ext).join(',') });
  const status = el('p', { role: 'status', ariaLive: 'polite' });
  let picker, saving = false;
  const save = button('保存已上传文件到第一层', { kind: 'primary', disabled: true, onClick: async () => {
    saving = true; save.disabled = true; picker.allowBrowse = false; picker.allowDrop = false;
    const completed = [], failures = [];
    for (const item of picker.getFiles()) {
      if (!item.serverId) continue;
      try {
        const result = await request('/api/file-import', { method: 'POST', body: { uploadId: item.serverId } });
        completed.push(result.note.id);
        await picker.removeFile(item.id, { revert: false });
      } catch (error) { failures.push(item.filename + '：' + error.message); }
    }
    status.textContent = '已保存 ' + completed.length + ' 份。' + failures.join('；');
    saving = false; picker.allowBrowse = true; picker.allowDrop = true; sync();
    if (completed.length) await onSaved(completed);
  } });
  const sync = () => { if (picker) save.disabled = saving || !picker.getFiles().some(item => item.serverId); };
  const panel = el('section', { class: 'panel' }, [
    el('h2', { text: '图片、PDF 和 Word' }),
    el('p', { text: '每份最多 50 MB（50,000,000 字节）。先上传到本机，再明确保存为第一层资料。保存不调用AI；DOCX转换后请先核对文字，再到资料详情主动提交AI。图片/PDF不OCR、不拆解，DOC仅保留原件。' }),
    field('选择附件', input), save, status,
  ]);
  const recovery = el('div', { class: 'page-stack' });
  panel.append(recovery);
  request('/api/uploads').then(({ uploads }) => {
    for (const upload of uploads || []) {
      const row = el('div', { class: 'attachment-card' });
      const recover = button('恢复保存：' + upload.attachment.name, { onClick: async () => {
        recover.disabled = true;
        try { const result = await request('/api/file-import', { method: 'POST', body: { uploadId: upload.id } }); row.remove(); await onSaved([result.note.id]); }
        catch (error) { onError(error); recover.disabled = false; }
      } });
      row.append(recover, button('撤销临时上传', { onClick: async () => {
        try { await request('/api/uploads/' + upload.id, { method: 'DELETE' }); row.remove(); } catch (error) { onError(error); }
      } }));
      recovery.append(row);
    }
  }).catch(onError);
  createFilePicker(input, { onChange: sync }).then(value => { picker = value; sync(); }).catch(onError);
  return panel;
}
