import test from 'node:test';
import assert from 'node:assert/strict';
import { searchGuide } from '../public/guide.mjs';
const entries = [
  { title: '保存与备份数据', text: 'JSON 备份不含 API 密钥', id: 'data' },
  { title: '遇到问题怎么办', text: '回答已保存，等待 AI 反馈', id: 'faq' },
  { title: '启用 AI', text: '配置 API 密钥', id: 'settings' },
];
test('guide searches Chinese body text and titles, including collapsed FAQ content', () => {
  assert.deepEqual(searchGuide(entries, '备份').map(x => x.id), ['data']);
  assert.deepEqual(searchGuide(entries, '等待').map(x => x.id), ['faq']);
  assert.deepEqual(searchGuide(entries, '启用').map(x => x.id), ['settings']);
});
test('guide matches all terms case-insensitively and handles empty or literal input', () => {
  assert.deepEqual(searchGuide(entries, ' api  密钥 ').map(x => x.id), ['data', 'settings']);
  for (const query of ['', '  ', '不存在', '[', '<script>']) assert.deepEqual(searchGuide(entries, query), []);
});
