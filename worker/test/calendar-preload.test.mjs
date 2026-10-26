import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {refreshOfficialCalendar,SOURCES,validAnnualSnapshot} from '../src/official-calendar.mjs';
import {handleRequest} from '../src/index.mjs';
const now=Date.parse('2026-10-26T07:30:00Z');
// Synthetic calendar fixtures exercise the schema; never published as dates.
const annual=year=>({stat:'ok',queryYear:year,data:[
  [`${year}-01-02`,'開始交易日','開始交易'],[`${year}-12-31`,'最後交易日','最後交易'],
  ...['01-01','02-12','02-13','02-16','02-17','02-18','10-26','12-25'].map(day=>[`${year}-${day}`,'休市','依規定放假']),
]});
const rss=at=>`<rss><channel><title>TSEC FEED</title><item><title>市場消息</title>
  <link>/rwd/zh/news/newsDetail/today</link><pubDate>${new Date(at).toUTCString()}</pubDate></item></channel></rss>`;
const html='<html><header>臺灣期貨交易所</header></html>';
function sources(url,at=now) {
  const u=String(url);
  if(u.includes('holidaySchedule')) return Response.json(annual(Number(new URL(u).searchParams.get('queryYear'))));
  return new Response(u.includes('twse.com.tw')?rss(at):html);
}

test('transient official network failure is retried once and a permanent HTTP error is not hammered',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  let attempts=0;
  globalThis.fetch=async url=>{
    if(String(url)===SOURCES.futures && ++attempts===1) throw new TypeError('temporary network failure');
    return sources(url);
  };
  const recovered=await refreshOfficialCalendar(null,now,false);
  assert.equal(attempts,2);
  assert.equal(recovered.checks.futures.ok,true);
  attempts=0;
  globalThis.fetch=async url=>{
    if(String(url)===SOURCES.futures){attempts++;return new Response('forbidden',{status:403});}
    return sources(url);
  };
  const failed=await refreshOfficialCalendar(null,now,false);
  assert.equal(attempts,1);
  assert.equal(failed.checks.futures.ok,false);
});

test('independent backup starts before primary retries and keeps its original verification timestamp',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const calls=[];let attempts=0;
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes('github.io')) return Response.json({schemaVersion:1,closures:[],checks:{futures:{ok:true,checkedAt:now-60000}}});
    if(String(url)===SOURCES.futures){attempts++;throw new Error('timeout');}
    return sources(url);
  };
  const result=await refreshOfficialCalendar(null,now,true);
  assert.ok(calls[0].includes('github.io'));
  assert.equal(attempts,2);
  assert.equal(result.checks.futures.ok,true);
  assert.equal(result.checks.futures.checkedAt,now-60000);
  assert.equal(result.checks.futures.delivery,'github-official-check');
});

test('unpublished next-year response is recorded as pending without importing another year and is retried daily',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let futureRequests=0;
  globalThis.fetch=async url=>{
    if(String(url).includes('queryYear=2027')) {futureRequests++;return Response.json(annual(2026));}
    return sources(url);
  };
  const first=await refreshOfficialCalendar(null,now,false);
  assert.equal(first.preload.status,'pending-publication');
  assert.equal(first.preload.providerYear,2026);
  assert.equal(first.annuals[2027],undefined);
  assert.equal(first.annual.year,2026);
  const next=await refreshOfficialCalendar(first,now+300000,false);
  assert.equal(futureRequests,1);
  assert.equal(next.preload.attemptedAt,now);
  await refreshOfficialCalendar(next,now+86400001,false);
  assert.equal(futureRequests,2);
});

test('published next-year calendar is validated and shared with browser session calculations',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async url=>sources(url);
  const state=await refreshOfficialCalendar(null,now,false);
  assert.equal(state.preload.status,'ready');
  assert.ok(validAnnualSnapshot(state.annuals[2027],2027,now));
  const ctx=vm.createContext({Date,Intl});
  vm.runInContext(fs.readFileSync(new URL('../../js/market-calendar.js',import.meta.url),'utf8'),ctx);
  ctx.state=state;
  vm.runInContext('MarketCalendar.applyOfficial(state)',ctx);
  assert.equal(vm.runInContext('MarketCalendar.tradingDay("TW",Date.parse("2027-01-01"))',ctx),false);
  assert.equal(vm.runInContext('new Date(MarketCalendar.latestSession("TW",Date.parse("2027-01-01"),600)).toISOString().slice(0,10)',ctx),'2026-12-31');
});

test('year rollover uses verified prefetched dates when the current-year endpoint is unavailable',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const fetched=Date.parse('2026-12-31T12:00:00Z');
  globalThis.fetch=async url=>sources(url,fetched);
  const prior=await refreshOfficialCalendar(null,fetched,false);
  const rolled=Date.parse('2027-01-01T01:00:00Z');let currentRequests=0;
  globalThis.fetch=async url=>{
    if(String(url).includes('queryYear=2027')){currentRequests++;throw new Error('offline');}
    return sources(url,rolled);
  };
  const result=await refreshOfficialCalendar(prior,rolled,false);
  assert.equal(currentRequests,0);
  assert.equal(result.annual.year,2027);
  assert.equal(result.annual.checkedAt,fetched);
  assert.equal(result.checks.annual.ok,true);
  assert.ok(result.annuals[2026]);
});

test('bad future schemas are rejected and a later wrong-year response never overwrites verified dates',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async url=>String(url).includes('queryYear=2027')
    ? Response.json({...annual(2027),data:[['bad']]}) : sources(url);
  const bad=await refreshOfficialCalendar(null,now,false);
  assert.equal(bad.preload.status,'unavailable');
  assert.equal(bad.annuals[2027],undefined);
  globalThis.fetch=async url=>sources(url);
  const valid=await refreshOfficialCalendar(null,now,false);
  globalThis.fetch=async url=>String(url).includes('queryYear=2027')?Response.json(annual(2026)):sources(url,now+86400001);
  const later=await refreshOfficialCalendar(valid,now+86400001,false);
  assert.equal(later.preload.status,'ready');
  assert.deepEqual(later.annuals[2027],valid.annuals[2027]);
});

test('a fresh legacy snapshot can be returned while its preload upgrade runs in the request background',async t=>{
  const original=globalThis.fetch,oldNow=Date.now;
  t.after(()=>{globalThis.fetch=original;Date.now=oldNow;});Date.now=()=>now;
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  globalThis.fetch=async url=>String(url)===SOURCES.futures?gate:sources(url);
  const state={schemaVersion:1,date:'2026-10-26',attemptedAt:now,closures:[],
    annual:{year:2026,closed:['2026-10-26'],checkedAt:now,source:SOURCES.annual},
    checks:{annual:{ok:true},notices:{ok:true},futures:{ok:true}}};
  let writes=0;const pending=[];
  const env={MARKET_CACHE:{get:async()=>state,put:async()=>{writes++;}}};
  const response=await handleRequest(new Request('https://worker.example/api/market-calendar'),env,{waitUntil:work=>pending.push(work)});
  assert.equal(response.status,200);
  assert.equal(pending.length,1);
  assert.equal(writes,0);
  release(new Response(html));await Promise.all(pending);
  assert.equal(writes,1);
});

test('indicator details start folded, retain user expansion for the same stock, and keep warnings visible',()=>{
  let previous=null;
  const grid={innerHTML:'',querySelector:()=>previous,appendChild:node=>{grid.metadata=node.innerHTML;}};
  const ctx=vm.createContext({document:{getElementById:id=>id==='ind-grid'?grid:null,createElement:()=>({})},Intl});
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js',import.meta.url),'utf8'),ctx);
  ctx.data={symbol:'0050.TW',asOf:Date.parse('2026-10-22T01:00:00Z'),indicators:[],
    historyMeta:{source:'Yahoo <script>',generatedAt:new Date(now).toISOString(),delivery:'stale-kv',volumeWarning:'官方量能待更新'}};
  vm.runInContext('UI.renderIndicators(data)',ctx);
  const summary=grid.metadata.split('<details')[0];
  assert.match(summary,/2026\/10\/22 完整日線/);
  assert.match(summary,/更新失敗，使用快取/);
  assert.match(summary,/官方量能待更新/);
  assert.doesNotMatch(summary,/Yahoo/);
  assert.doesNotMatch(grid.metadata,/<details[^>]+\sopen/);
  assert.match(grid.metadata,/Yahoo &lt;script&gt;/);
  previous={dataset:{symbol:'0050.TW'},open:true};
  vm.runInContext('UI.renderIndicators(data)',ctx);
  assert.match(grid.metadata,/<details[^>]+\sopen/);
  ctx.data.symbol='2330.TW';vm.runInContext('UI.renderIndicators(data)',ctx);
  assert.doesNotMatch(grid.metadata,/<details[^>]+\sopen/);
});
