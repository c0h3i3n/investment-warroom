import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INDEXES,
  QUOTE_SYMBOLS,
  buildSnapshot,
  handleRequest,
  isFreshTimestamp,
  mergeSnapshotWithCache,
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

test('a refresh keeps a missing cached symbol only while its source time is fresh', () => {
  const now = Date.parse('2026-07-31T02:00:00Z'); // Thu 10:00 Taipei
  const record = (symbol, minutesOld, price) => ({
    symbol,
    price,
    asOf: now - minutesOld * 60 * 1000,
    region: 'TW',
    source: 'TWSE MIS',
    priceType: 'indicative',
  });
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    indexes: [],
    quotes: [record('2330.TW', 1, 2400)],
    valid: { indexes: 0, quotes: 1, totalIndexes: 5, totalQuotes: 11 },
  };
  const cached = {
    indexes: [],
    quotes: [
      record('0050.TW', 5, 102.5),
      record('2330.TW', 10, 2390),
      record('00878.TW', 30, 32),
    ],
  };

  const merged = mergeSnapshotWithCache(snapshot, cached, now);
  assert.equal(merged.quotes.find(item => item.symbol === '0050.TW')?.price, 102.5);
  assert.equal(merged.quotes.find(item => item.symbol === '2330.TW')?.price, 2400);
  assert.equal(merged.quotes.some(item => item.symbol === '00878.TW'), false);
});

test('history API serves a cached 0050 series without an upstream request', async () => {
  const history = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    symbol: '0050.TW',
    range: '6mo',
    interval: '1d',
    data: [
      { time: Date.now() - 86400000, close: 100 },
      { time: Date.now(), close: 101 },
    ],
    source: 'Yahoo Finance',
  };
  const env = {
    MARKET_CACHE: {
      get: async key => {
        assert.equal(key, 'market:history:v1:0050.TW:6mo:1d');
        return history;
      },
      put: async () => assert.fail('fresh history KV should not be rewritten'),
    },
  };
  const response = await handleRequest(
    new Request('https://worker.example/api/history?symbol=0050.TW&range=6mo&interval=1d'),
    env,
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.delivery, 'kv');
  assert.equal(payload.data.length, 2);
});
