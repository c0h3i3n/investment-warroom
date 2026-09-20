import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.mjs';

test('index series uses official data, normalizes seconds and reuses fresh cache', async t => {
  const oldFetch = globalThis.fetch, oldNow = Date.now;
  const now = Date.parse('2026-09-18T05:30:00Z');
  Date.now = () => now;
  t.after(() => { globalThis.fetch = oldFetch; Date.now = oldNow; });
  let saved = null, requests = 0;
  const env = { MARKET_CACHE: {
    get: async () => saved,
    put: async (key, value) => { saved = JSON.parse(value); },
  }};
  globalThis.fetch = async url => {
    requests++;
    assert.match(String(url), /mis\.twse\.com\.tw/);
    return Response.json({ohlcArray:[{t:(now-60000)/1000,c:47000},{t:now/1000,c:47100}]});
  };
  const request = new Request('https://example.com/api/index-series?symbol=%5ETWII');
  const response = await handleRequest(request,env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).data.at(-1).time,now);
  assert.equal((await handleRequest(request,env)).status,200);
  assert.equal(requests,1);
  assert.equal((await handleRequest(new Request('https://example.com/api/index-series?symbol=INVALID'),env)).status,400);
});
