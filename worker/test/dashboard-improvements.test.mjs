import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function load(file, name) {
  const context = vm.createContext({ console, CONFIG:{} });
  vm.runInContext(fs.readFileSync(new URL(`../../js/${file}`, import.meta.url), 'utf8'), context);
  return vm.runInContext(name, context);
}

test('MACD reports a new cross only when the histogram changes side', () => {
  const service = load('indicators.js', 'IndicatorsService');
  const flat = Array(60).fill(100);
  assert.equal(service.calcMACD(flat).cross, null);
  assert.equal(service.calcMACD([...flat,110]).cross, 'bullish');
  assert.equal(service.calcMACD([...flat,110,111]).cross, null);
  assert.equal(service.calcMACD([...flat,90]).cross, 'bearish');
  assert.equal(service.calcMACD([...flat,90,89]).cross, null);
  assert.equal(service.calcMACD([...flat,110,111,80]).cross, 'bearish');
});

test('night data cannot move backwards within a session or leak into the next session', () => {
  const service = load('data.js', 'DataService');
  const current = { asOf:200, price:49346, contract:'202610', sessionTradingDay:'2026-10-05', expectedTradingDay:'2026-10-05', status:'closed', stale:false };
  const old = { ...current, asOf:100, price:49345, warning:'Live refresh failed' };
  assert.equal(service.preferNightQuote(current,old).price,49346);
  assert.equal(service.preferNightQuote(current,old).delivery,'memory');
  assert.equal(service.preferNightQuote(current,{ ...old,stale:true }).stale,true);
  assert.equal(service.preferNightQuote(current,{ ...old,sessionTradingDay:'2026-10-06' }).price,49345);
  assert.equal(service.preferNightQuote(current,{ ...old,contract:'202611' }).price,49345);
});

test('news prioritizes watchlist matches, labels crypto and consolidates repeat bulletins', () => {
  const service = load('news.js', 'NewsService');
  const result = service.prepareNews([
    { headline:'盤中速報 - FET大漲8.25%，報0.2479美元',region:'TW',publishedAt:10 },
    { headline:'盤中速報 - FET大漲8.67%，報0.2483美元',region:'TW',publishedAt:20 },
    { headline:'台積電公布營收',region:'TW',publishedAt:5 },
    { headline:'美股半導體族群',region:'TW',publishedAt:15 },
    { headline:'國際外交會議',region:'TW',publishedAt:30 },
  ], [{symbol:'2330.TW',name:'台積電'}]);
  assert.equal(result.length,4);
  assert.equal(result[0].headline,'台積電公布營收');
  assert.equal(result[0].related,true);
  assert.equal(result.find(n=>n.headline.includes('美股')).region,'US');
  assert.equal(result.find(n=>n.headline.includes('外交')).region,'INTL');
  assert.equal(result.at(-1).region,'CRYPTO');
  assert.match(result.at(-1).headline,/8.67/);
});

test('news symbol matching does not confuse short tickers with parts of words', () => {
  const service = load('news.js', 'NewsService');
  assert.equal(service.prepareNews([{headline:'NASDAQ market update'}],[{symbol:'D',name:'D'}])[0].related,false);
  assert.equal(service.prepareNews([{headline:'NVDA公布營收'}],[{symbol:'NVDA',name:'輝達'}])[0].related,true);
});

test('watchlist backup validation rejects malformed and duplicate entries', () => {
  const service = load('watchlist-tools.js', 'WatchlistTools');
  const wrap = items => ({type:'warroom-watchlist',version:1,items});
  const item = {symbol:'0050.TW',name:'元大台灣50',region:'US',price:999};
  const restored = service.validateBackup(wrap([item]));
  assert.equal(restored[0].region,'TW');
  assert.equal(restored[0].price,undefined);
  assert.throws(()=>service.validateBackup(wrap([item,item])));
  assert.throws(()=>service.validateBackup(wrap([{symbol:'<script>',name:'bad'}])));
  assert.throws(()=>service.validateBackup({type:'other',version:1,items:[]}));
  assert.equal(service.validateBackup(wrap([])).length,0);
});

test('backup merge, replace and undo preserve unrelated edits and enforce the limit', () => {
  const service = load('watchlist-tools.js', 'WatchlistTools');
  const first = {symbol:'0050.TW',name:'元大台灣50'};
  const second = {symbol:'TSLA',name:'特斯拉'};
  assert.equal(service.combine([first],[first,second]).length,2);
  assert.equal(service.combine([first],[],true).length,0);
  const result = service.restoreRemoved([second],{item:first,index:0});
  assert.equal(result[0].symbol,first.symbol);
  assert.equal(result[1].symbol,second.symbol);
  assert.equal(service.restoreRemoved(result,{item:first,index:0}).length,2);
  assert.throws(()=>service.combine(Array.from({length:25},(_,i)=>({symbol:`A${i}`})),[first]));
});
