import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleRequest,
  isNightSessionOpen,
  parseTaifexNightQuotes,
} from '../src/index.mjs';

function payload(time = '214856') {
  return { RtCode:'0', RtData:{ QuoteList:[
    { SymbolID:'TXF-P', CRefPrice:'47718.84', CDate:'20260921' },
    { SymbolID:'TXFK6-M', CLastPrice:'48509', CRefPrice:'48240', CDate:'20260921', CTime:'214823' },
    { SymbolID:'TXFJ6-M', CLastPrice:'48330', CRefPrice:'48053', COpenPrice:'48121',
      CHighPrice:'48358', CLowPrice:'48105', CTotalVolume:'9684', CDiff:'277', CDiffRate:'0.58',
      CBidPrice1:'48331', CAskPrice1:'48333', CDate:'20260921', CTime:time },
  ] } };
}

test('night session calendar handles the cross-midnight trading day', () => {
  assert.equal(isNightSessionOpen(Date.parse('2026-09-21T07:00:00Z')), true); // Mon 15:00
  assert.equal(isNightSessionOpen(Date.parse('2026-09-18T18:00:00Z')), true); // Sat 02:00, Friday session
  assert.equal(isNightSessionOpen(Date.parse('2026-09-20T18:00:00Z')), false); // Mon 02:00, no Sunday session
  assert.equal(isNightSessionOpen(Date.parse('2026-09-21T05:00:00Z')), false); // Mon 13:00
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
