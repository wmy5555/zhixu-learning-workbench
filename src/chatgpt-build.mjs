import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const chatgptToolNames = Object.freeze([
  'get_zhixu_status', 'save_chatgpt_conversation', 'import_chatgpt_history_snapshot',
  'import_chatgpt_history_batch', 'preview_chatgpt_capture_undo', 'preview_chatgpt_capture_restore',
  'search_knowledge', 'read_note', 'read_source', 'read_source_structure', 'related_knowledge',
]);
const files = ['src/chatgpt-structure.mjs', 'src/source-structure.mjs', 'src/knowledge-structure.mjs', 'src/chatgpt-source-metadata.mjs', 'package.json', 'src/chatgpt-build.mjs', 'src/chatgpt-integrity.mjs', 'src/chatgpt.mjs',
  'src/chatgpt-sync.mjs', 'src/chatgpt-history-snapshot.mjs', 'src/chatgpt-history-auth.mjs',
  'src/mcp-chatgpt.mjs', 'src/mcp.mjs', 'src/store.mjs', 'src/server.mjs', 'src/service.mjs',
  'src/chatgpt-history-batch.mjs', 'src/chatgpt-history-batch-store.mjs', 'src/chatgpt-undo.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Only public code inputs enter this identity; never read settings, Vault or credentials.
export const chatgptBuild = Object.freeze({ version: packageInfo.version,
  sha256: digest(JSON.stringify(files.map(file => [file, digest(readFileSync(new URL('../' + file, import.meta.url)))]))) });
export const chatgptProtocol = Object.freeze({ historySnapshot: 1, historyBatch: 1, captureUndo: 1, structured: 2, saveVerification: 1 });
export const chatgptLimits = Object.freeze({ maxCharacters: 500000, maxMessages: 200,
  maxMessageCharacters: 120000, maxSummaryCharacters: 30000, maxStructuredItems: 100,
  maxReadCharacters: 20000, maxPayloadJsonCharacters: 1000000, maxHttpBytes: 2 * 1024 * 1024 });
