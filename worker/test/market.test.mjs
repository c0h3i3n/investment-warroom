import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INDEXES,
  QUOTE_SYMBOLS,
  buildSnapshot,
  handleRequest,
  isFreshTimestamp,
} from '../src/index.mjs';

test('freshness rejects an old open-market quote and accepts the current one', () => {
  const now = Date.parse('2026-07-31T02:00:00Z'); // Thu 10:00 Taipei
  assert.equal(isFreshTimestamp(now - 10 * 60 * 1000, 'TW', now), true);
  assert.equal(isFreshTimestamp(now - 30 * 60 * 1000, 'TW', now), false);
});

test('buildSnapshot prefers MIS for Taiwan and Yahoo for US records', async t => {
  const originalFetch = globalThis.fetch;
  const nowSeconds = Math.floor(Date.parse('2026-07-31T02:00:00Z') / 1000);
  const originalNow = Date.now;
  Date.now = () => nowSeconds * 1000;
  globalThis.fetch = async urlValue => {
    const url = String(urlValue);
    if (url.includes('mis.twse.com.tw')) {
      const rows = [
        { c: 't00', ch: 't00.tw', z: '24500', y: '24400', tlong: String(nowSeconds * 1000) },
        { c: 'o00', ch: 'o00.tw', z: '280', y: '278', tlong: String(nowSeconds * 1000) },
        ...QUOTE_SYMBOLS.filter(symbol => symbol.endsWith('.TW')).map((symbol, index) => ({
          c: symbol.replace('.TW', ''),
          z: String(100 + index),
          y: String(99 + index),
          tlong: String(nowSeconds * 1000),
        })),
      ];
      return new Response(JSON.stringify({ msgArray: rows }), { status: 200 });
    }
    const encoded = url.split('/chart/')[1].split('?')[0];
    const yahooSymbol = decodeURIComponent(encoded);
    return new Response(JSON.stringify({
      chart: {
        result: [{
          meta: {
            symbol: yahooSymbol,
            regularMarketPrice: 500,
            previousClose: 490,
            regularMarketTime: nowSeconds,
            currency: yahooSymbol.includes('.TW') || yahooSymbol.includes('.TWO') ? 'TWD' : 'USD',
          },
        }],
      },
    }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  });

  const snapshot = await buildSnapshot();
  assert.equal(snapshot.indexes.length, INDEXES.length);
  assert.equal(snapshot.quotes.length, QUOTE_SYMBOLS.length);
  assert.equal(snapshot.indexes[0].source, 'TWSE MIS');
  assert.equal(snapshot.indexes[2].source, 'Yahoo Finance');
  assert.equal(snapshot.quotes.find(item => item.symbol === '2330.TW').source, 'TWSE MIS');
  assert.equal(snapshot.quotes.find(item => item.symbol === 'NVDA').source, 'Yahoo Finance');
});

test('API serves KV data with CORS and avoids an upstream refresh', async () => {
  const generatedAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    generatedAt,
    indexes: [],
    quotes: [],
    valid: { indexes: 5, quotes: 11, totalIndexes: 5, totalQuotes: 11 },
  };
  const env = {
    MARKET_CACHE: {
      get: async () => snapshot,
      put: async () => assert.fail('fresh KV should not be rewritten'),
    },
  };
  const request = new Request('https://worker.example/api/market', {
    headers: { Origin: 'https://c0h3i3n.github.io' },
  });
  const response = await handleRequest(request, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://c0h3i3n.github.io');
  assert.equal((await response.json()).delivery, 'kv');
});
