import { parentPort, workerData } from 'node:worker_threads';
import mammoth from 'mammoth';
import yauzl from 'yauzl';

// No office process, HTML conversion, external links, macros or embedded code run.
async function inspectZip(bytes) {
  await new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
    if (error) return reject(error);
    let entries = 0, total = 0, main = false;
    const names = new Set();
    zip.on('error', reject);
    zip.on('entry', entry => {
      const name = entry.fileName;
      if (++entries > 2000 || names.has(name) || name.includes('..') || name.startsWith('/') || /vbaProject|ActiveX/i.test(name) || entry.generalPurposeBitFlag & 1 || (total += entry.uncompressedSize) > 30 * 1024 * 1024 || entry.uncompressedSize > 10 * 1024 * 1024) { zip.close(); return reject(new Error('Unsafe archive')); }
      names.add(name); if (name === 'word/document.xml') main = true;
      // Drain every entry with actual expanded-byte limits before the converter sees it.
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError) { zip.close(); return reject(streamError); }
        let count = 0;
        stream.on('data', chunk => { count += chunk.length; if (count > entry.uncompressedSize || count > 10 * 1024 * 1024) stream.destroy(new Error('Oversize entry')); });
        stream.once('error', error => { zip.close(); reject(error); });
        stream.once('end', () => zip.readEntry());
      });
    });
    zip.on('end', () => main ? resolve() : reject(new Error('Not DOCX')));
    zip.readEntry();
  }));
}
try {
  const bytes = Buffer.from(workerData.bytes);
  if (workerData.format === 'docx') await inspectZip(bytes);
  // Raw-text API takes only a buffer; it neither enables externalFileAccess nor
  // converts images/HTML. Never supply a path or invoke Mammoth's CLI.
  const result = await mammoth.extractRawText({ buffer: bytes });
  let text = result.value;
  if (!text.trim()) text = '';
  const warnings = ['仅提取可读取文字；图片、图表、公式、修订、页眉页脚、嵌入对象及版式不保证覆盖，不代表完整文档。请核对后再主动提交AI。', ...result.messages.slice(0, 20).map(item => String(item.message).slice(0, 300))];
  if (text.length > 500000) { text = text.slice(0, 500000); warnings.push('提取文字超过 500000 字符，已截断；AI只处理可见提取部分。'); }
  parentPort.postMessage({ status: text.trim() ? 'partial' : 'empty', text, warnings: text.trim() ? warnings : ['未提取到文字；文件可能仅包含图片或不支持的对象。原文件保留，不能提交AI。'], tool: 'mammoth@1.13.0' });
} catch {
  parentPort.postMessage({ status: 'failed', text: '', warnings: ['无法安全转换：可能为损坏、加密、宏内容或超限的Word文件。原文件保留，不会运行其中代码。'], tool: 'mammoth@1.13.0' });
}
