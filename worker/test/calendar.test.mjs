import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isFreshTimestamp, handleRequest } from '../src/index.mjs';

const cases = [
  ['Labor Day', 'US', '2026-09-04T20:00:00Z', '2026-09-07T15:00:00Z', true],
  ['Tuesday premarket', 'US', '2026-09-04T20:00:00Z', '2026-09-08T06:00:00Z', true],
  ['Tuesday open', 'US', '2026-09-04T20:00:00Z', '2026-09-08T14:00:00Z', false],
  ['old TW close', 'TW', '2026-09-07T05:30:00Z', '2026-09-08T06:00:00Z', false],
  ['current TW close', 'TW', '2026-09-08T05:30:00Z', '2026-09-08T06:00:00Z', true],
  ['Spring Festival', 'TW', '2026-02-11T05:30:00Z', '2026-02-20T06:00:00Z', true],
  ['early US close', 'US', '2026-11-27T18:00:00Z', '2026-11-27T19:00:00Z', true],
];
for (const [name, region, source, now, expected] of cases) {
  test(name, () => assert.equal(isFreshTimestamp(source, region, Date.parse(now)), expected));
}
test('browser agrees with Worker on all calendar cases', () => {
  for (const [, region, source, now, expected] of cases) {
    class Clock extends Date { static now() { return Date.parse(now); } }
    const context = vm.createContext({ Date: Clock, Intl, console, CONFIG: {} });
    vm.runInContext(fs.readFileSync(new URL('../../js/market-calendar.js', import.meta.url), 'utf8'), context);
    vm.runInContext(fs.readFileSync(new URL('../../js/data.js', import.meta.url), 'utf8'), context);
    assert.equal(vm.runInContext('DataService.isFreshRecord(' + JSON.stringify({price:100,asOf:source,region}) + ')', context), expected);
  }
});
test('health rejects stale envelope and recomputes valid counts', async () => {
  const env = { MARKET_CACHE: { get: async () => ({
    generatedAt:'2026-01-01T00:00:00Z', indexes:[], quotes:[],
    valid:{indexes:5,quotes:11}
  }) }};
  const response = await handleRequest(new Request('https://test/health'), env);
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.valid.quotes, 0);
});
test('fresh Taiwan data is published when all US requests fail', async t => {
  const originalNow = Date.now, originalFetch = globalThis.fetch;
  Date.now = () => Date.parse('2026-09-08T06:00:00Z');
  t.after(() => { Date.now = originalNow; globalThis.fetch = originalFetch; });
  globalThis.fetch = async url => {
    if (!String(url).includes('mis.twse')) throw new Error('US unavailable');
    return Response.json({msgArray:[{c:'0050',z:'110',y:'109',tlong:Date.parse('2026-09-08T05:30:00Z')}]});
  };
  let stored;
  const env = {MARKET_CACHE:{get:async()=>null,put:async(key,value)=>{stored=JSON.parse(value);}}};
  const response = await handleRequest(new Request('https://test/api/market'), env);
  assert.equal(response.status,200);
  assert.equal(stored.quotes[0].symbol,'0050.TW');
  assert.equal(stored.valid.indexes,0);
});
