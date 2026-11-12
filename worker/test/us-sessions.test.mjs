import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUsSessions,createUsSessionService} from '../src/us-sessions.mjs';
import {handleRequest} from '../src/index.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
const S=globalThis.UsMarketSessions;
const stamp=Date.parse;
function fixture(day='2026-11-11') {
  const at=m=>S.at(day,m)/1000;
  return {chart:{result:[{meta:{symbol:'NVDA',currency:'USD',instrumentType:'EQUITY',exchangeTimezoneName:'America/New_York',dataGranularity:'5m',hasPrePostMarketData:true,
    regularMarketTime:at(960),regularMarketPrice:110,previousClose:100,chartPreviousClose:80},
    timestamp:[at(240),at(565),at(570),at(955),at(960),at(1195),at(1200)],
    indicators:{quote:[{close:[101,105,106,109,111,112,999]}]}}],error:null}};
}

test('US phases follow New York DST, holidays, weekends and early closes',()=>{
  for(const [iso,phase] of [
    ['2026-07-06T08:00Z','pre'],['2026-07-06T13:30Z','regular'],['2026-07-06T20:00Z','post'],['2026-07-07T00:00Z','closed'],
    ['2026-11-11T09:00Z','pre'],['2026-11-11T14:30Z','regular'],['2026-11-11T21:00Z','post'],['2026-11-12T01:00Z','closed'],
    ['2026-11-26T15:00Z','closed'],['2026-11-14T15:00Z','closed'],['2026-11-27T18:00Z','post'],['2026-11-27T22:00Z','closed'],
  ]) assert.equal(S.context(stamp(iso)).phase,phase,iso);
  assert.equal(S.context(stamp('2026-11-12T08:59Z')).sessionDay,'2026-11-11');
  assert.equal(S.context(stamp('2026-11-12T09:00Z')).sessionDay,'2026-11-12');
  assert.equal(S.context(stamp('2026-11-30T08:59Z')).sessionDay,'2026-11-27');
  assert.equal(S.context(stamp('2026-11-26T15:00Z')).sessionDay,'2026-11-25');
  assert.equal(new Date(S.schedule('2026-07-06').regular.start).toISOString(),'2026-07-06T13:30:00.000Z');
  assert.equal(new Date(S.schedule('2026-11-11').regular.start).toISOString(),'2026-11-11T14:30:00.000Z');
});

test('sessions have distinct source times and correct change baselines; 20:00 sentinel is excluded',()=>{
  const now=stamp('2026-11-12T02:00Z'),data=parseUsSessions(fixture(),'NVDA',now),v=S.view(data,now);
  assert.equal(data.sessions.pre.price,105);assert.equal(data.sessions.regular.price,110);assert.equal(data.sessions.post.price,112);
  assert.equal(data.sessions.pre.reference,100);assert.equal(data.sessions.regular.reference,100);assert.equal(data.sessions.post.reference,110);
  assert.equal(v.slots.pre.changePct,5.000000000000004);assert.ok(Math.abs(v.slots.post.changePct-100*2/110)<1e-10);
  assert.equal(data.sessions.post.kind,'5m-close');assert.equal(v.slots.post.state,'ended');
});

test('premarket uses the last completed regular close and never fills upcoming sessions with yesterday quotes',()=>{
  const day='2026-11-12',f=fixture(day),meta=f.chart.result[0].meta;
  meta.regularMarketTime=S.at('2026-11-11',960)/1000;meta.regularMarketPrice=100;
  const now=S.at(day,500),data=parseUsSessions(f,'NVDA',now),v=S.view(data,now);
  assert.equal(data.sessions.pre.price,101);assert.equal(data.sessions.pre.reference,100);
  assert.equal(data.sessions.regular,null);assert.equal(data.sessions.post,null);
  assert.equal(v.slots.regular.state,'upcoming');assert.equal(v.slots.regular.quote,null);
});

test('a multi-day chart start price is never substituted for a missing previous close',()=>{
  const f=fixture();delete f.chart.result[0].meta.previousClose;
  const data=parseUsSessions(f,'NVDA',stamp('2026-11-12T02:00Z'));
  assert.equal(data.sessions.pre.reference,null);assert.equal(data.sessions.regular.reference,null);
  assert.equal(S.view(data,stamp('2026-11-12T02:00Z')).slots.pre.changePct,null);
});

test('invalid prices and future bars are omitted, and mismatched symbols, currencies and instruments are rejected',()=>{
  const now=stamp('2026-11-11T14:00Z'),f=fixture();
  f.chart.result[0].indicators.quote[0].close[0]=null;
  assert.equal(parseUsSessions(f,'NVDA',now).sessions.pre,null);
  for(const change of [{symbol:'TSLA'},{currency:'TWD'},{instrumentType:'INDEX'},{exchangeTimezoneName:'Asia/Taipei'}]) {
    const changed=fixture();Object.assign(changed.chart.result[0].meta,change);
    assert.throws(()=>parseUsSessions(changed,'NVDA',now),/Invalid/);
  }
  assert.equal(S.validSymbol('../NVDA'),false);assert.equal(S.validSymbol('2330.TW'),false);
});

test('normal closing prints up to one minute after the boundary remain regular quotes, not aftermarket candles',()=>{
  const f=fixture();f.chart.result[0].meta.regularMarketTime+=1;
  const now=stamp('2026-11-12T02:00Z'),data=parseUsSessions(f,'NVDA',now);
  assert.equal(S.view(data,now).slots.regular.quote.price,110);
  assert.equal(data.sessions.post.reference,110);
});

test('previous-day data disappears at the next premarket; delayed active bars are not called live',()=>{
  const data=parseUsSessions(fixture(),'NVDA',stamp('2026-11-12T02:00Z'));
  const next=S.view(data,stamp('2026-11-12T09:00Z'));
  assert.equal(next.slots.pre.quote,null);assert.equal(next.slots.regular.quote,null);
  const pre=parseUsSessions(fixture(),'NVDA',stamp('2026-11-11T10:00Z'));
  assert.equal(S.view(pre,stamp('2026-11-11T10:00Z')).slots.pre.state,'delayed');
});

test('service shares requests, tolerates cache write failure, and keeps the original timestamp on outage fallback',async()=>{
  let calls=0,fail=false;
  const service=createUsSessionService(async()=>{calls++;if(fail) throw new Error('offline');return Response.json(fixture());});
  const env={MARKET_CACHE:{get:async()=>null,put:async()=>{throw new Error('quota');}}};
  const now=stamp('2026-11-12T02:00Z');
  const [a,b]=await Promise.all([service('NVDA',env,now),service('NVDA',env,now)]);
  assert.equal(calls,1);assert.equal(a.generatedAt,b.generatedAt);
  await service('NVDA',env,now+60000);assert.equal(calls,1);
  fail=true;const fallback=await service('NVDA',env,now+360000);
  assert.equal(fallback.delivery,'stale-cache');assert.equal(fallback.generatedAt,a.generatedAt);
  await assert.rejects(service('NVDA',env,stamp('2026-11-12T09:00Z')),/offline/);
});

test('API rejects non-US symbols without upstream requests and has its own CORS response',async()=>{
  const r=await handleRequest(new Request('https://worker.example/api/us-sessions?symbol=2330.TW'),{});
  assert.equal(r.status,400);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');
});

test('a provider without extended-hours support cannot create a post-market quote from its closing sentinel',()=>{
  const f=fixture();f.chart.result[0].meta.hasPrePostMarketData=false;
  const data=parseUsSessions(f,'NVDA',stamp('2026-11-12T02:00Z'));
  assert.equal(data.sessions.pre,null);assert.equal(data.sessions.post,null);
  assert.equal(data.sessions.regular.price,110);
});

test('a slower prior symbol request cannot overwrite the currently selected symbol',async()=>{
  const now=stamp('2026-11-12T02:00Z'),listeners={},resolvers=[];
  const nodes=new Map();
  const node=id=>nodes.get(id)||nodes.set(id,{id,dataset:{},textContent:'',innerHTML:'',value:'',
    addEventListener(type,handler){this[type]=handler;},replaceChildren(...options){this.options=options;}}).get(id);
  class Clock extends Date {static now(){return now;}}
  const ctx=vm.createContext({Date:Clock,Intl,console,setInterval(){},
    window:{_watchlistQuotes:[{symbol:'NVDA',name:'Nvidia',region:'US'},{symbol:'TSLA',name:'Tesla',region:'US'}]},
    document:{getElementById:node,createElement:()=>({}),addEventListener:(type,handler)=>listeners[type]=handler},
    CONFIG:{MARKET_API:'https://worker.example'},requestTimeoutSignal:()=>undefined,
    fetch:()=>new Promise(resolve=>resolvers.push(resolve))});
  for(const file of ['market-calendar','us-market-sessions','us-sessions-ui'])
    vm.runInContext(fs.readFileSync(new URL(`../../js/${file}.js`,import.meta.url),'utf8'),ctx);
  listeners.DOMContentLoaded();
  node('us-session-symbol').value='TSLA';node('us-session-symbol').change({target:node('us-session-symbol')});
  const data=parseUsSessions(fixture(),'NVDA',now);
  resolvers[1](Response.json({...data,symbol:'TSLA'}));
  await new Promise(setImmediate);
  assert.match(node('us-session-status').textContent,/^TSLA/);
  resolvers[0](Response.json(data));await new Promise(setImmediate);
  assert.match(node('us-session-status').textContent,/^TSLA/);
  assert.equal(node('us-session-refresh').disabled,false);
});
