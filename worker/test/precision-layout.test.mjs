import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function load(file, globals={}) {
  const ctx=vm.createContext({console,Date,...globals});
  vm.runInContext(fs.readFileSync(new URL(`../../js/${file}`,import.meta.url),'utf8'),ctx);
  return ctx;
}
const time=s=>Date.parse(s);

test('holiday-separated US session cannot change the TX score',()=>{
  const ctx=load('night-analysis.js');
  ctx.night={price:48705,changePct:-1.32,status:'closed',asOf:time('2026-10-09T04:59:53+08:00')};
  ctx.indexes=['^GSPC','^IXIC','^SOX'].map(symbol=>({symbol,changePct:2,asOf:time('2026-10-10T04:00:00+08:00')}));
  const r=vm.runInContext('NightAnalysis.evaluate(night,indexes)',ctx);
  assert.equal(r.score,-3); assert.equal(r.drivers.length,1); assert.equal(r.excluded.length,3);
});

test('live confirmation requires timestamps within 20 minutes; winter session uses NY date',()=>{
  const ctx=load('night-analysis.js');
  const check=vm.runInContext('NightAnalysis.sameSession',ctx);
  const night={status:'open',asOf:time('2026-12-08T04:59:00+08:00')};
  assert.equal(check(night,{asOf:night.asOf-20*60000}),true);
  assert.equal(check(night,{asOf:night.asOf-21*60000}),false);
  assert.equal(check(night,{}),false);
  assert.equal(check(night,{asOf:null}),false);
  assert.equal(check({...night,status:'closed'},{asOf:time('2026-12-08T05:00:00+08:00')}),true);
  assert.equal(check({...night,status:'closed'},{asOf:time('2026-12-09T05:00:00+08:00')}),false);
});

test('night closed summary retains real price and documents exclusions and volume scope',()=>{
  const element={innerHTML:''};
  const ctx=load('night-analysis.js',{document:{getElementById:id=>id==='night-market-content'?element:null}});
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(`UI.renderNightMarket({status:'closed',price:48705,change:-652,changePct:-1.32,volume:39302,spotReference:49313.44,basis:-608.44,asOf:${time('2026-10-09T04:59:53+08:00')}},[{symbol:'^GSPC',changePct:2,asOf:${time('2026-10-10T04:00:00+08:00')}}])`,ctx);
  assert.match(element.innerHTML,/最近夜盤收盤 · 48,705/);
  assert.match(element.innerHTML,/未納入評分/);
  assert.match(element.innerHTML,/非官方日報總量/);
  assert.match(element.innerHTML,/台指期單一訊號 -3/);
  assert.doesNotMatch(element.innerHTML,/<details class="night-details" open/);
});

test('chart adds price and date axes and respects US timezone',()=>{
  const ctx=load('ui.js'); const render=vm.runInContext('UI.renderSVGChart',ctx);
  const rows=[{time:time('2026-10-08T23:30:00Z'),close:100},{time:time('2026-10-09T23:30:00Z'),close:105}].map(r=>({...r,open:r.close,high:r.close,low:r.close}));
  const html=render(rows,340,150,'America/New_York');
  assert.match(html,/還原日線 · 價格刻度/); assert.match(html,/10\/09/);
  assert.doesNotMatch(html,/10\/10/); assert.match(html,/99\.50/);
});

test('news source categories override title guesses and crypto bulletins are not general news',()=>{
  const ctx=load('news.js'); const service=vm.runInContext('NewsService',ctx);
  const rows=service.prepareNews([{headline:'新幣公告',categories:['加密貨幣']},{headline:'盤中速報 - Mina大漲10%'},{headline:'盤中速報 - Pixels大漲11%'},{headline:'公司業績',categories:['台股']}]);
  assert.equal(rows.filter(r=>r.region==='CRYPTO').length,3);
  assert.equal(rows[0].region,'TW');
});

test('status distinguishes recent close from intraday and never promises all quotes are live',()=>{
  const elements=Object.fromEntries(['last-updated','sysOrb','sysLabel','ticker-mode-label'].map(id=>[id,{}]));
  const ctx=load('ui.js',{DataService:{isMarketOpen:()=>false},document:{getElementById:id=>elements[id]}});
  const status=vm.runInContext('UI.setDataStatus',ctx);
  status({fresh:2,total:2,twAsOf:time('2026-10-08T13:30:00+08:00'),usAsOf:time('2026-10-10T04:00:00+08:00')});
  assert.match(elements['last-updated'].textContent,/台股 最近收盤/);
  assert.match(elements['last-updated'].textContent,/美股 最近收盤/);
  assert.equal(elements.sysLabel.textContent,'行情齊全 ≠ 全部即時');
  status({fresh:1,total:2,twAsOf:time('2026-10-08T13:30:00+08:00'),mode:'cache'});
  assert.match(elements['last-updated'].textContent,/台股 最近收盤・快取/);
  status({fresh:2,total:2,twAsOf:time('2026-10-08T13:30:00+08:00'),usAsOf:time('2026-10-10T04:00:00+08:00'),mode:'cache',twCached:false,usCached:true});
  assert.doesNotMatch(elements['last-updated'].textContent,/台股 最近收盤・快取/);
  assert.match(elements['last-updated'].textContent,/美股 最近收盤・快取/);
});

test('index line color uses previous-close change and includes previous-close baseline',()=>{
  const wrap={dataset:{index:'otc'},innerHTML:''};
  const ctx=load('ui.js',{CONFIG:{INDEXES:[]},setTimeout:()=>{},document:{getElementById:()=>({innerHTML:''}),querySelectorAll:()=>[wrap]}});
  vm.runInContext(`UI.renderIndexCards([{id:'otc',price:99,changePct:-1,prevClose:100}]);UI.renderIndexSparklines({otc:{closes:[98,99],asOf:1791437580000,period:'1D',interval:'1m'}})`,ctx);
  assert.match(wrap.innerHTML,/昨收 100/);
  assert.match(wrap.innerHTML,/stroke="#ed527b"/);
});
