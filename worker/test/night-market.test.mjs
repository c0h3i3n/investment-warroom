import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleRequest,
  expectedNightTradingDay,
  isNightSessionOpen,
  nightTradingDayForTimestamp,
  parseTaifexNightQuotes,
} from '../src/index.mjs';

function payload(time = '214856', date = '20260921') {
  return { RtCode:'0', RtData:{ QuoteList:[
    { SymbolID:'TXF-P', CRefPrice:'47718.84', CDate:date },
    { SymbolID:'TXFK6-M', CLastPrice:'48509', CRefPrice:'48240', CDate:date, CTime:'214823' },
    { SymbolID:'TXFJ6-M', CLastPrice:'48330', CRefPrice:'48053', COpenPrice:'48121',
      CHighPrice:'48358', CLowPrice:'48105', CTotalVolume:'9684', CDiff:'277', CDiffRate:'0.58',
      CBidPrice1:'48331', CAskPrice1:'48333', CDate:date, CTime:time },
  ] } };
}

test('night session calendar handles the cross-midnight trading day', () => {
  assert.equal(isNightSessionOpen(Date.parse('2026-09-21T07:00:00Z')), true); // Mon 15:00
  assert.equal(isNightSessionOpen(Date.parse('2026-09-18T18:00:00Z')), true); // Sat 02:00, Friday session
  assert.equal(isNightSessionOpen(Date.parse('2026-09-20T18:00:00Z')), false); // Mon 02:00, no Sunday session
  assert.equal(isNightSessionOpen(Date.parse('2026-09-21T05:00:00Z')), false); // Mon 13:00
});

test('night trading date follows the session rather than the calendar date', () => {
  assert.equal(
    new Date(nightTradingDayForTimestamp(Date.parse('2026-09-18T18:00:00Z'))).toISOString().slice(0, 10),
    '2026-09-21',
  ); // Saturday 02:00 belongs to Friday night and Monday's trading day
  assert.equal(
    new Date(expectedNightTradingDay(Date.parse('2026-09-20T18:00:00Z'))).toISOString().slice(0, 10),
    '2026-09-21',
  ); // Monday 02:00 still expects the latest Friday session
});

test('TAIFEX parser selects the nearest active TX contract and checks freshness', () => {
  const now = Date.parse('2026-09-21T13:49:00Z');
  const quote = parseTaifexNightQuotes(payload(), now);
  assert.equal(quote.contract, '202610');
  assert.equal(quote.price, 48330);
  assert.equal(Number(quote.basis.toFixed(2)), 611.16);
  assert.equal(quote.status, 'open');
  assert.equal(quote.stale, false);
  assert.equal(quote.delayed, false);
  const delayed = parseTaifexNightQuotes(payload('214500'), now);
  assert.equal(delayed.delayed, true);
  assert.equal(delayed.stale, false);
  assert.equal(parseTaifexNightQuotes(payload('214200'), now).stale, true);
});

test('closed-session quote is rejected when it belongs to the previous trading day', () => {
  const quoteTime = payload('050000', '20260921');
  const currentSession = parseTaifexNightQuotes(quoteTime, Date.parse('2026-09-22T02:00:00Z'));
  assert.equal(currentSession.asOf, Date.parse('2026-09-22T05:00:00+08:00'));
  assert.equal(currentSession.sessionTradingDay, '2026-09-22');
  assert.equal(currentSession.expectedTradingDay, '2026-09-22');
  assert.equal(currentSession.stale, false);

  const nextDay = parseTaifexNightQuotes(quoteTime, Date.parse('2026-09-23T02:00:00Z'));
  assert.equal(nextDay.sessionTradingDay, '2026-09-22');
  assert.equal(nextDay.expectedTradingDay, '2026-09-23');
  assert.equal(nextDay.stale, true);
});

test('TAIFEX session date rolls forward after midnight instead of reviving an old KV quote', () => {
  const now = Date.parse('2026-10-01T02:30:00Z'); // 10:30 Taipei
  const quote = parseTaifexNightQuotes(payload('045958', '20260930'), now);
  assert.equal(quote.asOf, Date.parse('2026-10-01T04:59:58+08:00'));
  assert.equal(quote.sessionTradingDay, '2026-10-01');
  assert.equal(quote.expectedTradingDay, '2026-10-01');
  assert.equal(quote.stale, false);
  assert.equal(quote.status, 'closed');
});

test('Friday night after midnight still belongs to the next Taiwan trading day', () => {
  const quote = parseTaifexNightQuotes(
    payload('045958', '20260918'), Date.parse('2026-09-21T02:00:00Z'),
  );
  assert.equal(quote.asOf, Date.parse('2026-09-19T04:59:58+08:00'));
  assert.equal(quote.sessionTradingDay, '2026-09-21');
  assert.equal(quote.stale, false);
});

test('expired daytime contract rolls forward when the next month is trading at night', () => {
  const data = payload();
  data.RtData.QuoteList.push({
    ...data.RtData.QuoteList[2], SymbolID:'TXFI6-M', CLastPrice:'48000', CTime:'133000',
  });
  const quote = parseTaifexNightQuotes(data, Date.parse('2026-09-21T13:49:00Z'));
  assert.equal(quote.contract, '202610');
});

test('night-market API stores a fresh official quote', async t => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-09-21T13:49:00Z');
  let stored = null;
  globalThis.fetch = async () => new Response(JSON.stringify(payload()), { status:200 });
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  const env = { MARKET_CACHE:{ get:async () => null, put:async (_key,value) => { stored = JSON.parse(value); } } };
  const response = await handleRequest(new Request('https://worker.example/api/night-market'), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.delivery, 'live');
  assert.equal(data.contract, '202610');
  assert.equal(stored.price, 48330);
});

test('night close saves the final minutes even inside the five-minute write interval', async t => {
  const oldFetch = globalThis.fetch, oldNow = Date.now;
  const now = Date.parse('2026-10-03T01:00:00Z');
  Date.now = () => now;
  t.after(() => { globalThis.fetch = oldFetch; Date.now = oldNow; });
  const cached = parseTaifexNightQuotes(payload('045619','20261002'),now);
  let saved;
  globalThis.fetch = async () => Response.json(payload('045958','20261002'));
  const result = await (await handleRequest(new Request('https://worker.example/api/night-market'),{
    MARKET_CACHE:{ get:async()=>cached, put:async(_key,value)=>{ saved=JSON.parse(value); } },
  })).json();
  assert.ok(result.asOf > cached.asOf);
  assert.equal(result.status,'closed');
  assert.equal(saved.asOf,result.asOf);
});

test('an older upstream night response cannot replace a newer saved quote', async t => {
  const oldFetch = globalThis.fetch, oldNow = Date.now;
  const now = Date.parse('2026-10-03T01:00:00Z');
  Date.now = () => now;
  t.after(() => { globalThis.fetch = oldFetch; Date.now = oldNow; });
  const cached = parseTaifexNightQuotes(payload('045958','20261002'),now);
  globalThis.fetch = async () => Response.json(payload('045619','20261002'));
  const result = await (await handleRequest(new Request('https://worker.example/api/night-market'),{
    MARKET_CACHE:{ get:async()=>cached, put:async()=>assert.fail('must not save older data') },
  })).json();
  assert.equal(result.asOf,cached.asOf);
  assert.equal(result.stale,false);
  assert.equal(result.delivery,'kv');
});

test('new cross-midnight TAIFEX data replaces an obsolete night KV entry', async t => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-10-01T02:30:00Z');
  const previous = parseTaifexNightQuotes(
    payload('235635', '20260924'), Date.parse('2026-09-24T15:57:00Z'),
  );
  let stored = null;
  globalThis.fetch = async () => new Response(JSON.stringify(payload('045958', '20260930')), { status:200 });
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  const env = { MARKET_CACHE:{
    get:async () => previous,
    put:async (_key,value) => { stored = JSON.parse(value); },
  } };
  const response = await handleRequest(new Request('https://worker.example/api/night-market'), env);
  const result = await response.json();
  assert.equal(result.delivery, 'live');
  assert.equal(result.stale, false);
  assert.equal(result.sessionTradingDay, '2026-10-01');
  assert.equal(stored.asOf, Date.parse('2026-10-01T04:59:58+08:00'));
});

test('fresh night quote remains live when KV write quota is exhausted', async t => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-09-21T13:49:00Z');
  globalThis.fetch = async () => new Response(JSON.stringify(payload()), { status:200 });
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  const env = { MARKET_CACHE:{
    get:async () => null,
    put:async () => { throw new Error('KV put() limit exceeded for the day.'); },
  } };
  const response = await handleRequest(new Request('https://worker.example/api/night-market'), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.delivery, 'live');
  assert.equal(data.stale, false);
  assert.equal(data.price, 48330);
});
