import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/market-calendar.js';
import '../../js/history-validation.js';
test('rejects Sunday, null OHLC, future and inconsistent prices', () => {
  const row = {time:Date.parse('2026-09-18T01:00:00Z'),open:100,high:110,low:90,close:105,volume:100};
  const rows = [row,{...row,time:Date.parse('2026-09-20T04:00:05Z')},
    {...row,open:null},{...row,low:109},{...row,time:Date.parse('2026-09-21T01:00:00Z')}];
  assert.deepEqual(HistoryValidation.normalize(rows,'0050.TW','1d',Date.parse('2026-09-20T12:00:00Z')),[row]);
});
test('adjusts every OHLC field with the same factor', () => {
  const result={timestamp:[Date.parse('2026-09-18T01:00:00Z')/1000],indicators:{
    quote:[{open:[100],high:[110],low:[90],close:[100],volume:[50]}],
    adjclose:[{adjclose:[50]}]}};
  const [row]=HistoryValidation.fromYahoo(result,'0050.TW','1d');
  assert.deepEqual([row.open,row.high,row.low,row.close],[50,55,45,50]);
});
