import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { formatCalendarDate } from '../public/ui.mjs';

for (const timezone of ['America/Los_Angeles', 'Etc/GMT+12', 'UTC', 'Asia/Shanghai', 'Pacific/Kiritimati']) {
  test(`calendar days keep their date across timezone boundaries: ${timezone}`, () => {
    const moduleUrl = new URL('../public/ui.mjs', import.meta.url).href;
    const source = `
      import { formatCalendarDate, formatDate } from ${JSON.stringify(moduleUrl)};
      const days = ['2026-10-12', '2027-01-01', '2026-03-01', '2024-02-29'];
      console.log(JSON.stringify({
        days: days.map(formatCalendarDate),
        instant: formatDate('2026-10-12T00:00:00.000Z', true),
        expectedInstant: new Intl.DateTimeFormat('zh-CN', {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }).format(new Date('2026-10-12T00:00:00.000Z')),
        formerCard: formatDate('2026-10-12')
      }));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    }));
    assert.deepEqual(result.days, ['2026年10月12日', '2027年1月1日', '2026年3月1日', '2024年2月29日']);
    assert.equal(result.instant, result.expectedInstant);
    if (timezone === 'America/Los_Angeles' || timezone === 'Etc/GMT+12') {
      assert.equal(result.formerCard, '2026年10月11日', 'reproduces the original previous-day display');
    }
  });
}

test('calendar date formatter preserves missing and invalid inputs without inventing a time', () => {
  assert.equal(formatCalendarDate(null), '未记录');
  assert.equal(formatCalendarDate(''), '未记录');
  for (const value of ['invalid', '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-12T00:00:00.000Z']) {
    assert.equal(formatCalendarDate(value), value);
  }
});
