import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function records(now, generatedAt, asOf) {
  const clock = Date.parse(now);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const context = vm.createContext({ Date:Clock, CONFIG:{}, console });
  for (const file of ['market-calendar.js', 'data.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../../js/${file}`, import.meta.url), 'utf8'), context);
  }
  context.envelope = { generatedAt, data:[{ symbol:'0050.TW', price:112.8, asOf }] };
  return vm.runInContext('DataService.snapshotRecords(envelope)', context);
}

test('weekend snapshot keeps the latest closing session and labels it cached', () => {
  const result = records('2026-10-04T02:00:00Z', '2026-10-02T06:00:00Z', '2026-10-02T05:30:00Z');
  assert.equal(result.length, 1);
  assert.equal(result[0].deliveryMode, 'cache');
});

test('new envelope cannot revive an old session or stale intraday quote', () => {
  assert.equal(records('2026-10-04T02:00:00Z', '2026-10-04T02:00:00Z', '2026-10-01T05:30:00Z').length, 0);
  assert.equal(records('2026-10-05T02:00:00Z', '2026-10-05T02:00:00Z', '2026-10-02T05:30:00Z').length, 0);
  assert.equal(records('2026-10-05T02:00:00Z', '2026-10-05T02:00:00Z', '2026-10-05T01:50:00Z').length, 0);
  assert.equal(records('2026-10-05T02:00:00Z', '2026-10-05T02:00:00Z', '2026-10-05T01:59:00Z').length, 1);
});

test('a fresh timestamp on a closed Sunday cannot become a valid Taiwan quote', () => {
  assert.equal(records('2026-10-04T02:35:00Z', '2026-10-04T02:34:00Z', '2026-10-04T02:33:50Z').length, 0);
});
