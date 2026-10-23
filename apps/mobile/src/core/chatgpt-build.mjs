// Frozen desktop business rules; platform import adaptation only unless documented.

export const chatgptToolNames = Object.freeze([
  'get_zhixu_status', 'save_chatgpt_conversation', 'import_chatgpt_history_snapshot',
  'import_chatgpt_history_batch', 'preview_chatgpt_capture_undo', 'preview_chatgpt_capture_restore',
  'search_knowledge', 'read_note', 'read_source', 'read_source_structure', 'related_knowledge',
]);
export const chatgptBuild = Object.freeze({version:'0.1.0-mobile',sha256:'7aa1d780c4f8af1de3e53699c1395b775f9a2557'});
export const chatgptProtocol = Object.freeze({ historySnapshot: 1, historyBatch: 1, captureUndo: 1, structured: 2, saveVerification: 1 });
export const chatgptLimits = Object.freeze({ maxCharacters: 500000, maxMessages: 200,
  maxMessageCharacters: 120000, maxSummaryCharacters: 30000, maxStructuredItems: 100,
  maxReadCharacters: 20000, maxPayloadJsonCharacters: 1000000, maxHttpBytes: 2 * 1024 * 1024 });
