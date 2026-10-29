import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseTaifexEmergency} from '../src/official-calendar.mjs';
import {historyHealth,handleRequest,INDEXES,QUOTE_SYMBOLS} from '../src/index.mjs';
import {OFFICIAL_VOLUME_SOURCE} from '../src/history-repair.mjs';

const now=Date.parse('2026-10-29T05:00:00Z');
const rows=[];
for(let day=Date.parse('2026-05-01');day<=Date.parse('2026-10-28');day+=86400000) {
  if(MarketCalendar.tradingDay('TW',day)) rows.push({time:day+3600000,open:100,high:101,low:99,close:100,volume:1000});
}
const history={schemaVersion:1,symbol:'0050.TW',range:'6mo',interval:'1d',data:rows,
  generatedAt:'2026-10-29T04:00:00Z',sourceAsOf:Date.parse('2026-10-28T05:30:00Z'),
  delivery:'live',source:'Yahoo Finance＋TWSE 官方補值',volumeSource:OFFICIAL_VOLUME_SOURCE,volumeStatus:'verified'};
const storage=()=>{
  const data=new Map();
  return {data,getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
};
function browser(fetch,localStorage=storage()) {
  class Clock extends Date {static now(){return now;}}
  const ctx=vm.createContext({Date:Clock,Intl,URLSearchParams,console:{log(){},warn(){}},
    CONFIG:{MARKET_API:'https://worker.example',CORS_PROXIES:[]},fetch,localStorage,
    requestTimeoutSignal:()=>undefined});
  for(const file of ['market-calendar','history-validation','data','indicators'])
    vm.runInContext(fs.readFileSync(new URL(`../../js/${file}.js`,import.meta.url),'utf8'),ctx);
  return {run:code=>vm.runInContext(code,ctx),localStorage};
}
const historyCall='DataService.fetchHistorical("0050.TW","6mo","1d")';
const indicatorCall='IndicatorsService.calculateFor("0050.TW")';

test('withdrawn TAIFEX announcement comments are inert; visible layout changes still fail',()=>{
  const wrap=body=>`<html><header>臺灣期貨交易所</header>${body}</html>`;
  for(const body of ['<!--小網 緊急公告 ann--><div class="pagesize"></div>',
    '<script>const title="緊急公告";</script><template><span>緊急公告</span></template>']) {
    assert.deepEqual(parseTaifexEmergency(wrap(body)),{closures:[],unresolved:[]});
  }
  assert.throws(()=>parseTaifexEmergency(wrap('<span>緊急公告</span><div class="new">休市</div>')),/layout changed/);
  assert.throws(()=>parseTaifexEmergency('<!--<html><header>臺灣期貨交易所</header></html>-->'),/Invalid/);
});

test('transient backend failure retries once and recovers without proxy requests',async()=>{
  let calls=0;
  const b=browser(async url=>{
    assert.match(url,/\/api\/history/);
    if(++calls===1) throw new Error('Failed to fetch');
    return Response.json(history);
  });
  const result=await b.run(historyCall);
  assert.equal(calls,2);
  assert.equal(result.meta.historical,false);
  assert.equal(b.localStorage.data.size,1);
});

test('reload/offline preserves dated history and suppresses all signals; refresh does not erase it',async()=>{
  const saved=storage();
  await browser(async()=>Response.json(history),saved).run(indicatorCall);
  let calls=0;
  const offline=browser(async()=>{calls++;throw new Error('offline');},saved);
  const result=await offline.run(indicatorCall);
  assert.equal(calls,2);
  assert.equal(result.historyMeta.delivery,'local-history');
  assert.equal(result.historyMeta.historical,true);
  assert.equal(result.historyMeta.generatedAt,history.generatedAt);
  assert.equal(result.historyMeta.volumeSource,OFFICIAL_VOLUME_SOURCE);
  assert.equal(result.asOf,rows.at(-1).time);
  offline.run('DataService.clearCache()');
  assert.equal((await offline.run(indicatorCall)).historyMeta.historical,true);
  const other=await offline.run('IndicatorsService.calculateFor("2330.TW")');
  assert.match(other.error,/暫時無法取得/);
  assert.doesNotMatch(other.error,/保留最後/);
});

test('corrupt, wrong-symbol, future, expired and gapped saved histories are rejected',async()=>{
  for(const mutate of [s=>{s.symbol='2330.TW';},s=>{s.meta.generatedAt='2027-01-01';},
    s=>{s.meta.generatedAt='2026-10-01';},s=>{s.data.at(-1).close=-1;},
    s=>{s.data.splice(-5,1);},s=>{s.meta.generatedAt='invalid';}]) {
    const saved=storage();
    await browser(async()=>Response.json(history),saved).run(historyCall);
    const key=[...saved.data.keys()][0], snapshot=JSON.parse(saved.getItem(key));
    mutate(snapshot);saved.setItem(key,JSON.stringify(snapshot));
    const result=await browser(async()=>{throw new Error('offline');},saved).run(historyCall);
    assert.equal(result,null);
  }
});

test('stale backend history is explicitly historical and never replaces durable good data',async()=>{
  const b=browser(async()=>Response.json({...history,delivery:'stale-kv'}));
  const result=await b.run(indicatorCall);
  assert.equal(result.historyMeta.historical,true);
  assert.equal(b.localStorage.data.size,0);
});

test('storage access denial does not block a live result or automatic recovery',async()=>{
  const denied={getItem(){throw new Error('denied');},setItem(){throw new Error('quota');}};
  let calls=0;
  const b=browser(async()=>++calls===1?new Response('',{status:503}):Response.json(history),denied);
  const result=await b.run(indicatorCall);
  assert.equal(calls,2);
  assert.equal(result.historyMeta.historical,false);
});

test('indicator health validates completed session, continuity, age and official volume',()=>{
  assert.equal(historyHealth(history,'0050.TW',now).status,'ok');
  assert.equal(historyHealth(null,'0050.TW',now).status,'unknown');
  for(const changed of [{volumeStatus:'unavailable'}, {data:rows.slice(0,-1)},
    {data:rows.filter((_,i)=>i!==rows.length-5)}, {generatedAt:'2026-10-20'},
    {generatedAt:'2026-10-29T10:00:00Z'}, {sourceAsOf:Date.parse('2026-10-28T04:00:00Z')}]) {
    assert.notEqual(historyHealth({...history,...changed},'0050.TW',now).status,'ok');
  }
});

test('health cannot report ok for 16/16 quotes with failed official checks or absent history',async t=>{
  const originalNow=Date.now;Date.now=()=>now;t.after(()=>{Date.now=originalNow;});
  let futuresOk=false,includeHistory=true;
  const calendar=()=>({schemaVersion:1,date:'2026-10-29',attemptedAt:now,annuals:{},preload:{year:2027},
    closures:[],checks:{annual:{ok:true,checkedAt:now},notices:{ok:true,checkedAt:now},futures:{ok:futuresOk,checkedAt:now}}});
  const quote=(symbol,region)=>({symbol,region,price:100,asOf:region==='TW'?now:Date.parse('2026-10-28T20:00:00Z')});
  const snapshot={generatedAt:new Date(now).toISOString(),indexes:INDEXES.map(i=>({...i,...quote(i.symbol,i.region)})),
    quotes:QUOTE_SYMBOLS.map(s=>quote(s,s.endsWith('.TW')?'TW':'US'))};
  const env={MARKET_CACHE:{get:async key=>key.includes('calendar')?calendar()
    :key.includes('history')?(includeHistory?{...history,symbol:key.split(':')[3]}:null):snapshot}};
  const check=async()=>{
    const response=await handleRequest(new Request('https://worker.example/health'),env,{waitUntil(){}});
    return {status:response.status,...await response.json()};
  };
  const failed=await check();
  assert.equal(failed.valid.quotes,11);assert.equal(failed.valid.indexes,5);
  assert.equal(failed.ok,false);assert.equal(failed.components.calendar.status,'unverified');
  futuresOk=true;
  assert.equal((await check()).ok,true);
  includeHistory=false;
  const absent=await check();
  assert.equal(absent.ok,false);assert.equal(absent.components.indicators['0050.TW'].status,'unknown');
});
