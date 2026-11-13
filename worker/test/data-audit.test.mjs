import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {inspectData,makeReport} from '../../scripts/lib/data-consistency.mjs';
import {readJson,collectData} from '../../scripts/run-data-audit.mjs';
const S=globalThis.UsMarketSessions;
const now=Date.parse('2026-11-13T02:00:00Z');
const scope={quotes:[{symbol:'ORCL',region:'US'}],indexes:[]};
function fixture(at=now) {
  const regularTime=S.at('2026-11-12',964)+3000;
  const quote={symbol:'ORCL',region:'US',source:'Yahoo Finance',price:127.11,prevClose:128.38,
    change:-1.27,changePct:(127.11/128.38-1)*100,asOf:regularTime};
  const annual={year:2026,source:'https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json',
    closed:['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-12-25'],checkedAt:at};
  return {scope,market:{schemaVersion:1,generatedAt:new Date(at).toISOString(),quotes:[quote],indexes:[]},
    calendar:{calendar:{schemaVersion:1,date:'2026-11-13',attemptedAt:at,annual,closures:[],
      checks:Object.fromEntries(['annual','notices','futures'].map(k=>[k,{ok:true,checkedAt:at}]))}},
    sessions:{ORCL:{schemaVersion:1,symbol:'ORCL',sessionDay:'2026-11-12',source:'Yahoo Finance',interval:'5m',generatedAt:new Date(at).toISOString(),
      sessions:{pre:{price:122.39,asOf:S.at('2026-11-12',560),kind:'5m-close',reference:128.38},
        regular:{price:127.11,asOf:regularTime,kind:'regular-quote',reference:128.38},
        post:{price:128.2141,asOf:S.at('2026-11-12',1199),kind:'5m-close',reference:127.11}}}}};
}
const issues=data=>inspectData(data,now).filter(c=>c.status==='issue');

test('healthy delivered data passes, including ORCL closing reports four minutes late',()=>{
  const checks=inspectData(fixture(),now);
  assert.deepEqual(checks.filter(c=>c.status!=='pass'),[]);
  assert.equal(makeReport(checks,scope,null,now).status,'ok');
});
test('same-time price mismatch, missing post baseline and incorrect change math are detected',()=>{
  const f=fixture();f.sessions.ORCL.sessions.regular.price=127.15;
  f.sessions.ORCL.sessions.post.reference=null;f.market.quotes[0].changePct=5;
  const ids=issues(f).map(c=>c.id);
  for(const key of ['sessions:ORCL:compare','sessions:ORCL:baseline','quote:ORCL:change']) assert.ok(ids.includes(key),key);
});
test('different source times are not falsely treated as contradictory prices',()=>{
  const f=fixture();f.market.quotes[0].asOf-=1000;
  const result=inspectData(f,now).find(c=>c.id==='sessions:ORCL:compare');
  assert.equal(result.status,'skip');
  assert.equal(makeReport(inspectData(f,now),scope,null,now).status,'partial');
});
test('incorrect premarket or regular previous-close references are detected independently',()=>{
  for(const key of ['pre','regular']) {
    const f=fixture();f.sessions.ORCL.sessions[key].reference=99;
    assert.ok(issues(f).some(c=>c.id==='sessions:ORCL:previous-close'));
  }
});
test('wrong calendar year and individually expired notices cannot pass',()=>{
  const f=fixture();f.calendar.calendar.annual.year=2027;
  f.calendar.calendar.checks.notices.checkedAt=now-11*60000;
  const ids=issues(f).map(c=>c.id);
  assert.ok(ids.includes('calendar:annual'));assert.ok(ids.includes('calendar:notices'));
  assert.ok(!ids.includes('calendar:futures'));
});
test('future, cross-day and after-hours candles masquerading as normal quotes fail',()=>{
  for(const mutate of [
    f=>{f.sessions.ORCL.sessions.regular.asOf=now+1000;},
    f=>{f.sessions.ORCL.sessionDay='2026-11-11';},
    f=>{f.sessions.ORCL.sessions.regular.kind='5m-close';},
    f=>{f.market.quotes[0].asOf=now+2*60000;},
  ]) {const f=fixture();mutate(f);assert.ok(issues(f).length>0);}
});
test('normal weekend closing data is valid; prior-day data at the next regular open is stale',()=>{
  const friday=fixture();const fridayAt=S.at('2026-11-13',960);
  friday.market.quotes[0].asOf=fridayAt;
  const saturday=Date.parse('2026-11-14T18:00Z');
  assert.equal(inspectData(friday,saturday).find(c=>c.id==='quote:ORCL:time').status,'pass');
  const monday=S.at('2026-11-16',600);
  assert.equal(inspectData(friday,monday).find(c=>c.id==='quote:ORCL:time').status,'issue');
});
test('Taiwan open quotes expire while a valid latest close remains usable after hours',()=>{
  const f=fixture();f.scope={quotes:[{symbol:'2330.TW',region:'TW'}],indexes:[]};
  f.market.quotes=[{...f.market.quotes[0],symbol:'2330.TW',region:'TW',source:'TWSE MIS',asOf:now-2*60000}];
  const result=at=>inspectData(f,at).find(c=>c.id==='quote:2330.TW:time').status;
  assert.equal(result(now),'pass');
  f.market.quotes[0].asOf=now-15*60000;assert.equal(result(now),'issue');
  const after=Date.parse('2026-11-13T06:00Z');f.calendar.calendar.attemptedAt=after;
  f.market.quotes[0].asOf=Date.parse('2026-11-13T05:30Z');assert.equal(result(after),'pass');
  f.market.quotes[0].asOf=Date.parse('2026-11-12T05:30Z');assert.equal(result(after),'issue');
});
test('US early closing time is respected by quote freshness checks',()=>{
  const f=fixture(),at=S.at('2026-11-27',840);
  f.market.quotes[0].asOf=S.at('2026-11-27',784);
  assert.equal(inspectData(f,at).find(c=>c.id==='quote:ORCL:time').status,'pass');
});
test('premarket empty upcoming slots and missing extended data are not fabricated passes',()=>{
  const f=fixture(),at=S.at('2026-11-13',500);
  Object.assign(f.sessions.ORCL,{sessionDay:'2026-11-13',generatedAt:new Date(at).toISOString(),sessions:{pre:null,regular:null,post:null}});
  const checks=inspectData(f,at).filter(c=>c.id.startsWith('sessions:'));
  assert.ok(!checks.some(c=>c.status==='issue'));
  assert.equal(checks.find(c=>c.id==='sessions:ORCL:pre').status,'skip');
  assert.equal(checks.find(c=>c.id==='sessions:ORCL:post'),undefined);
});
test('network failures are explicit and unrelated checks continue',()=>{
  const f=fixture();delete f.sessions.ORCL;f.errors={ORCL:'ORCL 連線失敗'};
  const checks=inspectData(f,now);
  assert.equal(checks.find(c=>c.id==='sessions:ORCL').status,'issue');
  assert.equal(checks.find(c=>c.id==='calendar:annual').status,'pass');
  assert.equal(checks.find(c=>c.id==='sessions:ORCL').message,'ORCL 連線失敗');
});
test('only repeated recent issues escalate; recovered and expired streaks reset',()=>{
  const bad=[{id:'same',status:'issue',message:'報價矛盾'}];
  const a=makeReport(bad,scope,null,now);assert.equal(a.status,'pending');
  const immediate=makeReport(bad,scope,a,now+1000);assert.equal(immediate.status,'pending');
  const b=makeReport(bad,scope,a,now+15*60000);assert.equal(b.status,'warning');
  const recovered=makeReport([{...bad[0],status:'pass'}],scope,b,now+30*60000);assert.equal(recovered.status,'ok');
  assert.equal(makeReport(bad,scope,recovered,now+40*60000).status,'pending');
  assert.equal(makeReport(bad,scope,b,now+70*60000).status,'pending');
});
test('request retries transient failures but not permanent rejection, and caps concurrency',async()=>{
  let calls=0;
  const result=await readJson('https://example.test',async()=>++calls===1?new Response('',{status:503}):Response.json({ok:true}),async()=>{});
  assert.deepEqual(result,{ok:true});assert.equal(calls,2);
  calls=0;await assert.rejects(readJson('https://example.test',async()=>{calls++;return new Response('',{status:403});},async()=>{}));
  assert.equal(calls,1);
  let active=0,peak=0;
  const large={quotes:['A','B','C','D','E','F'].map(symbol=>({symbol,region:'US'})),indexes:[]};
  const data=await collectData('https://example.test',large,async()=>{
    peak=Math.max(peak,++active);await new Promise(setImmediate);active--;return Response.json({ok:true});
  });
  assert.ok(peak<=3);assert.equal(Object.keys(data.sessions).length,6);
});
test('browser turns a stale report into unknown instead of showing an old pass, and rejects malformed counts',()=>{
  const ctx=vm.createContext({Date,Intl,document:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync(new URL('../../js/data-audit.js',import.meta.url),'utf8'),ctx);
  ctx.now=now;ctx.report=makeReport(inspectData(fixture(),now),scope,null,now);
  assert.equal(vm.runInContext('DataAudit.view(report,now).state',ctx),'ok');
  assert.equal(vm.runInContext('DataAudit.view(report,now+46*60000).state',ctx),'stale');
  assert.equal(vm.runInContext('DataAudit.view({...report,counts:{pass:999}},now).state',ctx),'unavailable');
  assert.equal(vm.runInContext('DataAudit.view({...report,checkedAt:new Date(now+120000).toISOString()},now).state',ctx),'unavailable');
});
