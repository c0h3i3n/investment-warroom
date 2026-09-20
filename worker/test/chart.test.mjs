import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('chart provides actual date and OHLC labels with a single keyboard entry point', () => {
  const context = vm.createContext({console, Date});
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js',import.meta.url),'utf8'),context);
  const result = vm.runInContext(`UI.renderSVGChart([
    {time:Date.parse('2026-09-17T01:00:00Z'),open:100,high:103,low:99,close:102},
    {time:Date.parse('2026-09-18T01:00:00Z'),open:102,high:105,low:101,close:104}
  ],340,90)`,context);
  assert.match(result,/2026\/9\/18 · 還原價格 開 102.00 高 105.00 低 101.00 收 104.00/);
  assert.equal((result.match(/tabindex="0"/g)||[]).length,1);
  assert.equal((result.match(/data-chart-detail=/g)||[]).length,2);
});
