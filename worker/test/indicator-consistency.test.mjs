import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function indicatorContext(generatedAt, sourceAsOf = generatedAt) {
  const previous = Date.parse('2026-09-30T01:00:00Z');
  const current = Date.parse('2026-10-01T01:00:00Z');
  const rows = Array.from({ length:60 }, (_, index) => ({
    time:previous - (59 - index) * 86400000,
    open:100, high:101, low:99, close:100, volume:100000,
  }));
  rows.push({ time:current, open:200, high:201, low:199, close:200, volume:500000 });
  rows.meta = { source:'Yahoo Finance', generatedAt, sourceAsOf:Date.parse(sourceAsOf), delivery:'kv' };
  const context = vm.createContext({
    DataService:{ fetchHistorical:async () => rows },
    console:{ log:() => {}, warn:() => {} },
  });
  vm.runInContext(fs.readFileSync(new URL('../../js/market-calendar.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../../js/indicators.js', import.meta.url), 'utf8'), context);
  return { context, previous, current };
}

test('intraday daily candle is excluded from every technical indicator', async () => {
  const { context, previous } = indicatorContext('2026-10-01T02:30:00Z');
  const result = await vm.runInContext('IndicatorsService.calculateFor("0050.TW", 500)', context);
  assert.equal(result.asOf, previous);
  assert.equal(result.chartData.length, 60);
  assert.equal(result.historyMeta.excludedIncomplete, true);
  assert.equal(result.indicators.find(item => item.name === 'MA · 20').signal, 'BELOW ✗');
});

test('daily candle fetched after the market closes is included', async () => {
  const { context, current } = indicatorContext('2026-10-01T06:00:00Z', '2026-10-01T05:30:00Z');
  const result = await vm.runInContext('IndicatorsService.calculateFor("0050.TW")', context);
  assert.equal(result.asOf, current);
  assert.equal(result.historyMeta.excludedIncomplete, false);
});

test('a post-close fetch cannot finalize a stale intraday candle', async () => {
  const { context, previous } = indicatorContext('2026-10-01T06:00:00Z', '2026-10-01T02:30:00Z');
  const result = await vm.runInContext('IndicatorsService.calculateFor("0050.TW")', context);
  assert.equal(result.asOf, previous);
  assert.equal(result.historyMeta.excludedIncomplete, true);
});

test('history lag counts trading sessions, skipping weekends and exchange holidays', () => {
  const { context } = indicatorContext('2026-10-01T06:00:00Z');
  const check = (source, now, lag, expected, symbol = '0050.TW') => {
    const result = vm.runInContext(`IndicatorsService.historyFreshness(Date.parse('${source}'), '${symbol}', Date.parse('${now}'))`, context);
    assert.equal(result.lagSessions, lag);
    assert.equal(result.expectedSession, expected);
  };
  check('2026-10-01T01:00:00Z', '2026-10-04T02:00:00Z', 1, '2026-10-02');
  check('2026-10-02T01:00:00Z', '2026-10-05T02:00:00Z', 0, '2026-10-02');
  check('2026-10-02T01:00:00Z', '2026-10-05T05:40:00Z', 0, '2026-10-02');
  check('2026-10-02T01:00:00Z', '2026-10-05T05:46:00Z', 1, '2026-10-05');
  check('2026-10-08T01:00:00Z', '2026-10-11T02:00:00Z', 0, '2026-10-08');
  check('2026-11-25T14:30:00Z', '2026-11-27T18:16:00Z', 1, '2026-11-27', 'NVDA');
});
