import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { historyNeedsRepair, handleRequest } from '../src/index.mjs';

const ms = s => Date.parse(s);
const row = date => ({time:ms(`${date}T01:00:00Z`),open:100,high:101,low:99,close:100,volume:1000});
const context = vm.createContext({console});
for (const file of ['market-calendar','history-validation','indicators','news']) {
  vm.runInContext(fs.readFileSync(new URL(`../../js/${file}.js`,import.meta.url),'utf8'),context);
}

test('RSS timestamps are UTC without a timezone, while explicit offsets are respected',()=>{
  const parse = vm.runInContext('NewsService.parsePublishedAt',context);
  const expected = ms('2026-10-15T17:59:28+08:00');
  assert.equal(parse('2026-10-15 09:59:28'),expected);
  assert.equal(parse('2026-10-15T09:59:28'),expected);
  assert.equal(parse('2026-10-15T17:59:28+08:00'),expected);
  assert.equal(parse('Thu, 15 Oct 2026 17:59:28 +0800'),expected);
  assert.equal(parse(null),null);
  assert.equal(parse('bad date'),null);
});

test('daily gap detection skips official holidays and weekends, handles US dates',()=>{
  assert.deepEqual(HistoryValidation.missingSessions([row('2026-10-08'),row('2026-10-12')],'0050.TW'),[]);
  assert.deepEqual(HistoryValidation.missingSessions([row('2026-10-13'),row('2026-10-15')],'0050.TW'),['2026-10-14']);
  const us = ['2026-11-25T14:30:00Z','2026-11-27T14:30:00Z'].map(time=>({...row('2026-10-15'),time:ms(time)}));
  assert.deepEqual(HistoryValidation.missingSessions(us,'NVDA'),[]);
});

test('post-close fetch with pre-close source is retried, finalized history remains cacheable',()=>{
  const now = ms('2026-10-15T10:00:00Z');
  const data = [row('2026-10-14'),row('2026-10-15')];
  assert.equal(historyNeedsRepair({data,sourceAsOf:ms('2026-10-15T05:25:00Z')},'0050.TW','1d',now),true);
  assert.equal(historyNeedsRepair({data,sourceAsOf:ms('2026-10-15T05:30:00Z')},'0050.TW','1d',now),false);
  assert.equal(historyNeedsRepair({data:[row('2026-10-13'),row('2026-10-15')],sourceAsOf:now},'0050.TW','1d',now),true);
  assert.equal(historyNeedsRepair({data:[row('2026-10-13'),row('2026-10-14')],sourceAsOf:now},'0050.TW','1d',now),true);
  assert.equal(historyNeedsRepair({},'0050.TW','5m',now),false);
});

test('actual history route refreshes a 13:45 cache whose source was still 13:25',async t=>{
  const originalNow = Date.now, originalFetch = globalThis.fetch;
  Date.now = ()=>ms('2026-10-15T10:00:00Z');
  t.after(()=>{Date.now=originalNow;globalThis.fetch=originalFetch;});
  let requests = 0;
  globalThis.fetch = async ()=>{
    requests++;
    return new Response(JSON.stringify({chart:{result:[{
      meta:{regularMarketTime:ms('2026-10-15T05:30:00Z')/1000},
      timestamp:[ms('2026-10-14T01:00:00Z')/1000,ms('2026-10-15T01:00:00Z')/1000],
      indicators:{quote:[{open:[100,100],high:[101,101],low:[99,99],close:[100,100],volume:[100,100]}]},
    }]}}));
  };
  const cached = {generatedAt:'2026-10-15T05:45:07Z',sourceAsOf:ms('2026-10-15T05:25:00Z'),data:[row('2026-10-14'),row('2026-10-15')]};
  const response = await handleRequest(new Request('https://worker.example/api/history?symbol=0050.TW&range=6mo&interval=1d'),{MARKET_CACHE:{get:async()=>cached,put:async()=>{}}});
  assert.equal((await response.json()).delivery,'live');
  assert.equal(requests,1);
});

test('indicator calculation refuses missing trading days rather than compressing the series',async()=>{
  context.DataService = {fetchHistorical:async()=>{
    const data=[row('2026-10-13'),row('2026-10-15')];
    data.meta={generatedAt:'2026-10-15T10:00:00Z',sourceAsOf:ms('2026-10-15T05:30:00Z')};
    return data;
  }};
  const result=await vm.runInContext('IndicatorsService.calculateFor("0050.TW")',context);
  assert.match(result.error,/2026-10-14/);
  assert.equal(result.indicators,undefined);
});

test('unavailable indicators clear the previous chart and expose an accessible explanation',()=>{
  const elements=Object.fromEntries(['ind-grid','ind-chart','chart-detail','ind-label'].map(id=>[id,{innerHTML:'old chart'}]));
  const ctx=vm.createContext({document:{getElementById:id=>elements[id]}});
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js',import.meta.url),'utf8'),ctx);
  vm.runInContext('UI.showIndicatorPrompt("0050.TW","日線缺漏 <test>")',ctx);
  assert.equal(elements['ind-chart'].innerHTML,'');
  assert.match(elements['ind-grid'].innerHTML,/role="status"/);
  assert.match(elements['ind-grid'].innerHTML,/&lt;test&gt;/);
});
