import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = file => fs.readFileSync(new URL(`../../js/${file}.js`,import.meta.url),'utf8');
const load = (files,globals={}) => {
  const ctx=vm.createContext({console:{log(){},warn(){}},...globals});
  files.forEach(file=>vm.runInContext(source(file),ctx));
  return ctx;
};

test('a missing session preserves indicators only from the contiguous history before the gap',async()=>{
  const rows=[];
  for(let day=Date.parse('2026-05-01');day<=Date.parse('2026-10-13');day+=86400000) {
    // The service returns normalized trading-day rows.
    rows.push({time:day+3600000,open:100,high:100,low:100,close:100,volume:100});
  }
  rows.push({time:Date.parse('2026-10-15T01:00:00Z'),open:200,high:200,low:200,close:200,volume:100});
  const ctx=load(['market-calendar','history-validation','indicators']);
  const clean=ctx.HistoryValidation.normalize(rows,'0050.TW','1d',Date.parse('2026-10-16'));
  clean.meta={generatedAt:'2026-10-15T10:00:00Z',sourceAsOf:Date.parse('2026-10-15T05:30:00Z')};
  ctx.DataService={fetchHistorical:async()=>clean};
  const result=await vm.runInContext('IndicatorsService.calculateFor("0050.TW")',ctx);
  assert.equal(result.asOf,Date.parse('2026-10-13T01:00:00Z'));
  assert.equal(result.historyMeta.historical,true);
  assert.match(result.historyMeta.historicalReason,/2026-10-14/);
  assert.equal(result.indicators.find(i=>i.name==='MA · 20').value,'100.0');
  assert.equal(result.chartData.at(-1).close,100);
  ctx.DataService.fetchHistorical=async()=>{throw new Error('offline');};
  const preserved=await vm.runInContext('IndicatorsService.calculateFor("0050.TW")',ctx);
  assert.equal(preserved.asOf,result.asOf);
  assert.equal(preserved.historyMeta.historical,true);
  const other=await vm.runInContext('IndicatorsService.calculateFor("2330.TW")',ctx);
  assert.ok(other.error);
  assert.equal(other.indicators,undefined);
});

test('historical indicators suppress signals even if the last session timestamp is current',()=>{
  const grid={innerHTML:'',appendChild(){}};
  const ctx=load(['ui'],{document:{getElementById:id=>id==='ind-grid'?grid:null,createElement:()=>({})}});
  ctx.result={symbol:'0050.TW',asOf:Date.parse('2026-10-13T01:00:00Z'),historyMeta:{historical:true,historicalReason:'更新失敗',lagSessions:0},indicators:[{name:'RSI',value:55,color:'up',signal:'偏多'}]};
  vm.runInContext('UI.renderIndicators(result)',ctx);
  assert.match(grid.innerHTML,/歷史數值 · 截至 2026\/10\/13/);
  assert.match(grid.innerHTML,/歷史數值 · 訊號暫停/);
  assert.doesNotMatch(grid.innerHTML,/偏多/);
});

test('related-news filter survives incoming news, has empty state and can be reversed',()=>{
  const feed={innerHTML:''};
  const ctx=load(['news','ui'],{window:{_watchlistQuotes:[{symbol:'2330.TW',name:'台積電'}]},document:{getElementById:id=>id==='news-feed'?feed:null}});
  ctx.news=[{headline:'台積電營收',publishedAt:1},{headline:'國際市場',publishedAt:2}];
  vm.runInContext('UI.renderNews(news); UI.setNewsRelatedOnly(true)',ctx);
  assert.match(feed.innerHTML,/台積電營收/);
  assert.doesNotMatch(feed.innerHTML,/國際市場/);
  vm.runInContext('UI.renderNews([{headline:"無關新聞",publishedAt:3}])',ctx);
  assert.match(feed.innerHTML,/目前沒有符合自選股/);
  vm.runInContext('UI.setNewsRelatedOnly(false)',ctx);
  assert.match(feed.innerHTML,/無關新聞/);
});

test('manual refresh reports complete, unchanged, partial, backup and failed states accessibly',()=>{
  const output={textContent:''};
  const ctx=load(['ui'],{setTimeout:()=>{},document:{getElementById:()=>output,querySelector:()=>null,createElement:()=>({setAttribute(){}}),body:{appendChild(){}}}});
  const report=vm.runInContext('UI.refreshResult',ctx);
  const valid={fresh:16,total:16,changed:true};
  assert.match(report(valid),/更新完成/);
  assert.match(report({...valid,changed:false,closed:true}),/台美股休市/);
  assert.match(report({...valid,changed:false,closed:false}),/暫無新的報價/);
  assert.match(report({...valid,fresh:12}),/部分更新完成/);
  assert.match(report({...valid,cached:true}),/備援/);
  assert.match(report({...valid,failed:true}),/部分更新完成/);
  assert.match(report({...valid,fresh:0}),/更新失敗/);
  assert.match(output.textContent,/更新失敗/);
});

test('night explanations identify cash reference time and preserve a user-collapsed session',()=>{
  const element={innerHTML:'',dataset:{sessionState:'open'},querySelector:()=>({open:false})};
  const ctx=load(['night-analysis','ui'],{document:{getElementById:id=>id==='night-market-content'?element:null}});
  ctx.night={status:'open',stale:false,price:47100,change:100,changePct:.2,spotReference:47000,basis:100,asOf:Date.parse('2026-10-15T10:00:00Z')};
  ctx.indexes=[{symbol:'^TWII',price:47000,asOf:Date.parse('2026-10-15T05:30:00Z')}];
  vm.runInContext('UI.renderNightMarket(night,indexes)',ctx);
  assert.match(element.innerHTML,/僅依台指期/);
  assert.match(element.innerHTML,/10\/15\s+13:30/);
  assert.doesNotMatch(element.innerHTML,/<details class="night-details" open/);
  ctx.night.status='closed';
  vm.runInContext('UI.renderNightMarket(night,indexes)',ctx);
  assert.match(element.innerHTML,/最近夜盤收盤，非目前即時方向/);
});
