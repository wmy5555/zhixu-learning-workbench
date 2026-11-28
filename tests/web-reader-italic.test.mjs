import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown } from '../public/web/markdown.mjs';

test('reader renders the single-star emphasis saved by the visual editor', () => {
  assert.equal(markdown('这是一条合成资料。*青石在窗边*，微光来自清晨。').html,
    '<p>这是一条合成资料。<em>青石在窗边</em>，微光来自清晨。</p>');
  assert.equal(markdown('*字* 与 **粗体**').html, '<p><em>字</em> 与 <strong>粗体</strong></p>');
});

test('italic rendering keeps escaped markers, code, links and HTML safe', () => {
  assert.equal(markdown(String.raw`\*原文\* 和 ` + '`*代码*`').html,
    '<p>*原文* 和 <code>*代码*</code></p>');
  assert.equal(markdown('*<img src=x onerror=alert(1)>*').html,
    '<p><em>&lt;img src=x onerror=alert(1)&gt;</em></p>');
  assert.equal(markdown('[*标签*](https://example.com/a*b) [危险](javascript:alert)').html,
    '<p><a href="https://example.com/a*b" target="_blank" rel="noopener noreferrer">*标签* ↗</a> 危险</p>');
  assert.equal(markdown(String.raw`*保留\*星号*`).html, '<p><em>保留*星号</em></p>');
  assert.equal(markdown('# * 空格 *').html, '<h1 id="section-0" tabindex="-1">* 空格 *</h1>');
  assert.equal(markdown('未闭合*文本 与 * 空格 *').html, '<p>未闭合*文本 与 * 空格 *</p>');
});
