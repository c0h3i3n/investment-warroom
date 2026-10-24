import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {repairTwseHistory,applyOfficialVolumes,OFFICIAL_VOLUME_SOURCE} from '../src/history-repair.mjs';
import {nightQuoteFreshness,handleRequest} from '../src/index.mjs';
const now=Date.parse('2026-10-24T02:00:00Z');
const closures=[{date:'2026-10-23',scope:'TW'},{date:'2026-10-23',scope:'TAIFEX'}];
MarketCalendar.applyOfficial({schemaVersion:1,attemptedAt:now,date:'2026-10-24',closures,checks:{}});
const rows=[];
for(let day=Date.parse('2026-09-01');day<=Date.parse('2026-10-22');day+=86400000) {
  if(MarketCalendar.tradingDay('TW',day)) rows.push({time:day+3600000,open:100,high:101,low:99,close:100,volume:1000,change:0,note:''});
}
const history={schemaVersion:1,symbol:'0050.TW',interval:'1d',range:'6mo',source:'Yahoo Finance',
  sourceAsOf:Date.parse('2026-10-22T05:30:00Z'),data:rows.map(row=>({...row,volume:10}))};
const payload=month=>({stat:'OK',title:'115年10月 0050 元大台灣50 各日成交資訊',
  fields:['日期','成交股數','開盤價','最高價','最低價','收盤價','漲跌價差','註記'],
  data:rows.filter(row=>new Date(row.time).toISOString().startsWith(month)).map(row=>[
    new Date(row.time).toISOString().slice(0,10).replace('2026-','115/').replace('-','/'),
    '1,000','100','101','99','100','0',''])});

test('official volume stays identical before and after Yahoo fills the missing candle',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async url=>Response.json(payload(String(url).includes('date=202610')?'2026-10':'2026-09'));
  const repaired=await repairTwseHistory({...history,data:history.data.slice(0,-1)},null,now);
  const recovered=await repairTwseHistory(history,null,now);
  assert.equal(recovered.volumeSource,OFFICIAL_VOLUME_SOURCE);
  assert.equal(recovered.volumeStatus,'verified');
  assert.deepEqual(recovered.data.map(row=>row.volume),repaired.data.map(row=>row.volume));
  assert.equal(recovered.data.at(-1).volume,1000);
  assert.equal(recovered.data.at(-1).close,history.data.at(-1).close);
  assert.equal(recovered.repairedDates,undefined);
});

test('official volume outage leaves volume unavailable instead of substituting Yahoo counts',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>{throw new Error('offline');};
  const result=await repairTwseHistory(history,null,now);
  assert.equal(result.volumeSource,OFFICIAL_VOLUME_SOURCE);
  assert.equal(result.volumeStatus,'unavailable');
  assert.ok(result.data.every(row=>row.volume===null));
  assert.equal(result.data.at(-1).close,100);
  assert.match(result.volumeWarning,/量能指標暫停/);
});

test('incomplete official baseline is not mixed with other-source volumes',()=>{
  const result=applyOfficialVolumes(history,rows.slice(-10),now);
  assert.equal(result.volumeStatus,'unavailable');
  assert.ok(result.data.every(row=>row.volume===null));
});

test('browser history fallback cannot silently restore Yahoo volume for featured stocks',async()=>{
  const result={timestamp:rows.slice(-3).map(row=>row.time/1000),meta:{regularMarketTime:history.sourceAsOf/1000},
    indicators:{quote:[{open:[100,100,100],high:[101,101,101],low:[99,99,99],close:[100,100,100],volume:[10,10,10]}]}};
  const ctx=vm.createContext({CONFIG:{MARKET_API:'https://worker.example',CORS_PROXIES:[]},
    requestTimeoutSignal:()=>undefined,console:{warn(){}},fetch:async url=>String(url).includes('/api/history')
      ? {ok:false,status:503} : {ok:true,text:async()=>JSON.stringify({chart:{result:[result]}})}});
  for(const file of ['market-calendar','history-validation','data']) {
    vm.runInContext(fs.readFileSync(new URL(`../../js/${file}.js`,import.meta.url),'utf8'),ctx);
  }
  const data=await vm.runInContext('DataService.fetchHistorical("0050.TW","6mo","1d")',ctx);
  assert.ok(data.length>0);
  assert.ok(data.every(row=>row.volume===null));
  assert.equal(data.meta.volumeSource,OFFICIAL_VOLUME_SOURCE);
  assert.equal(data.meta.volumeStatus,'unavailable');
});

test('dated official monthly cache can preserve the same volume definition during an outage',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>{throw new Error('offline');};
  const env={MARKET_CACHE:{get:async key=>{
    const month=key.slice(-7);return {code:'0050',month,fetchedAt:now-3600000,payload:payload(month)};
  },put:async()=>assert.fail('offline cache must not be re-dated')}};
  const result=await repairTwseHistory(history,env,now);
  assert.equal(result.volumeStatus,'verified');
  assert.equal(result.data.at(-1).volume,1000);
});

const lastClose=Date.parse('2026-10-23T04:59:59+08:00');
test('holiday night close remains a historical reference until the next actual session opens',()=>{
  const before=nightQuoteFreshness(lastClose,Date.parse('2026-10-27T14:59:00+08:00'));
  assert.equal(before.stale,false);
  assert.equal(before.status,'closed');
  assert.equal(before.nextSessionAt,Date.parse('2026-10-27T15:00:00+08:00'));
  const after=nightQuoteFreshness(lastClose,Date.parse('2026-10-27T15:00:00+08:00'));
  assert.equal(after.stale,true);
  assert.equal(after.status,'open');
});

test('a long Lunar New Year closure also preserves only the last final night close',()=>{
  const final=Date.parse('2026-02-12T04:59:59+08:00');
  const before=nightQuoteFreshness(final,Date.parse('2026-02-23T10:00:00+08:00'));
  assert.equal(before.stale,false);
  assert.equal(before.nextSessionAt,Date.parse('2026-02-23T15:00:00+08:00'));
  assert.equal(nightQuoteFreshness(final,Date.parse('2026-02-23T15:00:00+08:00')).stale,true);
});

test('a mid-session quote, a future quote and an older session never qualify as a night close',()=>{
  const at=Date.parse('2026-10-27T10:00:00+08:00');
  for(const quote of ['2026-10-22T23:30:00+08:00','2026-10-22T04:59:59+08:00','2026-10-28T04:59:59+08:00']) {
    assert.equal(nightQuoteFreshness(Date.parse(quote),at).stale,true);
  }
});

test('night API cache fallback uses the same calendar-aware closure rule',async t=>{
  const oldNow=Date.now,oldFetch=globalThis.fetch;
  Date.now=()=>Date.parse('2026-10-27T10:00:00+08:00');
  globalThis.fetch=async()=>{throw new Error('source unavailable');};
  t.after(()=>{Date.now=oldNow;globalThis.fetch=oldFetch;});
  const cached={schemaVersion:1,session:'after-hours',asOf:lastClose,price:45654,changePct:-1};
  const calendar={schemaVersion:1,date:'2026-10-27',attemptedAt:Date.now(),closures,checks:{}};
  const env={MARKET_CACHE:{get:async key=>key==='market:official-calendar:v1'?calendar:cached,put:async()=>{}}};
  const response=await handleRequest(new Request('https://worker.example/api/night-market'),env);
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.stale,false);
  assert.equal(result.status,'closed');
  assert.equal(result.asOf,lastClose);
  assert.equal(result.nextSessionAt,Date.parse('2026-10-27T15:00:00+08:00'));
});
