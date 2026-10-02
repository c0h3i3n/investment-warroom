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
  assert.equal(isFreshTimestamp(now - 5 * 60 * 1000, 'TW', now), true);
  assert.equal(isFreshTimestamp(now - 10 * 60 * 1000, 'TW', now), false);
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
            regularMarketTime: yahooSymbol.includes('.TW') || yahooSymbol.startsWith('^TW')
              ? nowSeconds : Date.parse('2026-07-30T20:00:00Z') / 1000,
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

test('API serves KV data with CORS and avoids an upstream refresh', async t => {
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-07-31T02:00:00Z');
  t.after(() => { Date.now = originalNow; });
  const generatedAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date(Date.now()).toISOString(),
    indexes: [],
    quotes: [{ symbol: '0050.TW', price: 100, asOf: Date.now(), region: 'TW' }],
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

test('a cached market snapshot refreshes Taiwan quotes from MIS during trading', async t => {
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  const now = Date.parse('2026-07-31T02:00:00Z');
  Date.now = () => now;
  globalThis.fetch = async url => {
    assert.match(String(url), /mis\.twse\.com\.tw/);
    return new Response(JSON.stringify({ msgArray:[{
      c:'0050', d:'20260731', t:'09:59:30', z:'101', y:'100',
      tlong:String(now - 30000),
    }] }), { status:200 });
  };
  t.after(() => { Date.now = originalNow; globalThis.fetch = originalFetch; });
  const snapshot = {
    schemaVersion:1,
    generatedAt:new Date(now - 3 * 60 * 1000).toISOString(),
    indexes:[],
    quotes:[{
      symbol:'0050.TW', price:100, asOf:now - 3 * 60 * 1000,
      region:'TW', source:'TWSE MIS', priceType:'trade',
    }],
  };
  const env = { MARKET_CACHE:{
    get:async () => snapshot,
    put:async () => assert.fail('read-time MIS refresh must not rewrite KV'),
  } };
  const response = await handleRequest(new Request('https://worker.example/api/market'), env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.delivery, 'kv+live-mis');
  assert.equal(payload.quotes.find(item => item.symbol === '0050.TW').price, 101);
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

test('official Taiwan index change wins over a later Yahoo timestamp', () => {
  const now = Date.parse('2026-09-23T13:45:00Z');
  const official = {
    id: 'tai', symbol: '^TWII', region: 'TW', source: 'TWSE MIS',
    price: 48157.29, prevClose: 47800.17, change: 357.12,
    changePct: 357.12 / 47800.17 * 100,
    asOf: Date.parse('2026-09-23T05:33:00Z'),
  };
  const yahoo = {
    ...official, source: 'Yahoo Finance', prevClose: 47718.8,
    change: 438.49, changePct: 438.49 / 47718.8 * 100,
    asOf: official.asOf + 15000,
  };
  const merged = mergeSnapshotWithCache({ indexes: [official], quotes: [] }, {
    indexes: [yahoo], quotes: [],
  }, now);
  assert.equal(merged.indexes[0].source, 'TWSE MIS');
  assert.equal(merged.indexes[0].prevClose, 47800.17);
});

test('history API serves a cached 0050 series without an upstream request', async () => {
  const history = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceAsOf: Date.now(),
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
        assert.equal(key, 'market:history:v2:0050.TW:6mo:1d');
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

test('daily history fetched before the close is refreshed after the session finishes', async t => {
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  const now = Date.parse('2026-10-01T06:00:00Z'); // 14:00 Taipei
  Date.now = () => now;
  globalThis.fetch = async url => {
    assert.match(String(url), /\/chart\/0050\.TW\?/);
    return new Response(JSON.stringify({ chart:{ result:[{
      meta:{ regularMarketTime:Date.parse('2026-10-01T05:30:00Z') / 1000 },
      timestamp:[
        Date.parse('2026-09-30T01:00:00Z') / 1000,
        Date.parse('2026-10-01T01:00:00Z') / 1000,
      ],
      indicators:{ quote:[{
        open:[100,101], high:[102,103], low:[99,100],
        close:[101,102], volume:[1000,2000],
      }] },
    }] } }), { status:200 });
  };
  t.after(() => { Date.now = originalNow; globalThis.fetch = originalFetch; });
  const cached = {
    schemaVersion:1, generatedAt:'2026-10-01T02:30:00Z',
    symbol:'0050.TW', range:'6mo', interval:'1d', data:[{ time:1 }, { time:2 }],
  };
  const env = { MARKET_CACHE:{ get:async () => cached, put:async () => {} } };
  const response = await handleRequest(new Request(
    'https://worker.example/api/history?symbol=0050.TW&range=6mo&interval=1d',
  ), env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.delivery, 'live');
  assert.equal(payload.sourceAsOf, Date.parse('2026-10-01T05:30:00Z'));
  assert.equal(payload.data.at(-1).close, 102);
});

test('quote API supports a user-added US symbol', async t => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const now = Date.parse('2026-09-23T02:00:00Z');
  Date.now = () => now;
  globalThis.fetch = async url => {
    assert.match(String(url), /\/chart\/AAPL\?/);
    return new Response(JSON.stringify({ chart:{ result:[{ meta:{
      symbol:'AAPL', shortName:'Apple', regularMarketPrice:240,
      previousClose:238, regularMarketTime:Date.parse('2026-09-22T20:00:00Z') / 1000,
      currency:'USD',
    } }] } }), { status:200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });

  const response = await handleRequest(new Request('https://worker.example/api/quote?symbol=AAPL'), {});
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.quote.symbol, 'AAPL');
  assert.equal(payload.quote.price, 240);
});

test('Taiwan quote uses the latest trade field before the bid/ask midpoint', async t => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-10-01T02:30:30Z');
  const row = {
    c:'2330', d:'20261001', t:'10:30:00', z:'-', y:'2480',
    b:'2495_2490_', a:'2500_2505_', trade:{ z:'2500', t:'10:29:19' },
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ msgArray:[row] }), { status:200 });
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });

  const request = new Request('https://worker.example/api/quote?symbol=2330.TW');
  const traded = await (await handleRequest(request, {})).json();
  assert.equal(traded.quote.price, 2500);
  assert.equal(traded.quote.priceType, 'trade');
  assert.equal(traded.quote.asOf, Date.parse('2026-10-01T10:29:19+08:00'));

  row.trade.t = '10:10:00';
  const indicative = await (await handleRequest(request, {})).json();
  assert.equal(indicative.quote.price, 2497.5);
  assert.equal(indicative.quote.priceType, 'indicative');
  assert.equal(indicative.quote.asOf, Date.parse('2026-10-01T10:30:00+08:00'));
});

test('fresh traded price wins over a newer indicative cached quote', () => {
  const now = Date.parse('2026-10-01T02:30:30Z');
  const quote = (price, priceType, time) => ({
    symbol:'2330.TW', region:'TW', source:'TWSE MIS', price, priceType,
    asOf:Date.parse(`2026-10-01T${time}+08:00`),
  });
  const snapshot = { indexes:[], quotes:[quote(2500, 'trade', '10:29:19')] };
  const cached = { indexes:[], quotes:[quote(2497.5, 'indicative', '10:30:00')] };
  assert.equal(mergeSnapshotWithCache(snapshot, cached, now).quotes[0].price, 2500);
});

test('history API permits a valid user-added symbol but rejects path-like input', async () => {
  const history = {
    schemaVersion:1, generatedAt:new Date().toISOString(), symbol:'AAPL', range:'6mo', interval:'1d',
    data:[{time:Date.now()-86400000,close:100},{time:Date.now(),close:101}], source:'Yahoo Finance',
  };
  const env = { MARKET_CACHE:{ get:async key => key.includes(':AAPL:') ? history : null } };
  const valid = await handleRequest(new Request('https://worker.example/api/history?symbol=AAPL&range=6mo&interval=1d'), env);
  assert.equal(valid.status, 200);
  const invalid = await handleRequest(new Request('https://worker.example/api/history?symbol=..%2Fsecret&range=6mo&interval=1d'), env);
  assert.equal(invalid.status, 400);
});
