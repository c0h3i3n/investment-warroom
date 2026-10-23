import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseNewsRss,getNewsSnapshot,NEWS_FEEDS,validNews} from '../src/news.mjs';
import {parseTwseMonth,reconcileDailyHistory} from '../src/history-repair.mjs';
import {handleRequest} from '../src/index.mjs';
const now=Date.parse('2026-10-23T03:00:00Z');
const article={headline:'台積電 &amp; 晶片',publishedAt:now-60000,link:'https://news.cnyes.com/news/id/123',source:'鉅亨'};
const rss=`<rss><channel><item><title><![CDATA[${article.headline}]]></title><link>${article.link}</link>
  <pubDate>Fri, 23 Oct 2026 10:59:00 +0800</pubDate><category>台股</category></item></channel></rss>`;

test('original RSS retains publication timezone, decodes title and rejects bad dates/links/HTML',()=>{
  const [parsed]=parseNewsRss(rss,NEWS_FEEDS[0],now);
  assert.equal(parsed.publishedAt,article.publishedAt);
  assert.equal(parsed.headline,'台積電 & 晶片');
  for (const xml of ['<html>blocked</html>',rss.replace('Fri, 23 Oct 2026 10:59:00 +0800','invalid'),
    rss.replace(article.link,'javascript:alert(1)'),rss.replace('2026 10:59','2027 10:59')]) {
    assert.throws(()=>parseNewsRss(xml,NEWS_FEEDS[0],now));
  }
  assert.equal(validNews([{...article,publishedAt:now-73*3600000}],now).length,0);
});

test('news outage retains dated backup without advancing its fetch time, then expires it',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>{throw new Error('offline');};
  const cached={schemaVersion:1,generatedAt:new Date(now-3600000).toISOString(),data:[article]};
  let writes=0;
  const env={MARKET_CACHE:{get:async()=>cached,put:async()=>{writes++;}}};
  const result=await getNewsSnapshot(env,false,now);
  assert.equal(result.delivery,'stale-kv');
  assert.equal(result.generatedAt,cached.generatedAt);
  assert.equal(result.data[0].publishedAt,article.publishedAt);
  assert.equal(writes,0);
  const expired=await getNewsSnapshot(env,false,now+73*3600000);
  assert.equal(expired.data.length,0);
  assert.equal(expired.delivery,'unavailable');
});

test('news API serves original RSS via CORS, deduplicates and marks partial source failure',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const realNow=Date.now;Date.now=()=>now;t.after(()=>{Date.now=realNow;});
  let saved;
  globalThis.fetch=async url=>String(url).includes('wd_stock')?new Response('blocked',{status:503}):new Response(rss);
  const response=await handleRequest(new Request('https://example.com/api/news',{headers:{Origin:'https://c0h3i3n.github.io'}}),
    {MARKET_CACHE:{get:async()=>null,put:async(_,data)=>{saved=JSON.parse(data);}}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://c0h3i3n.github.io');
  const payload=await response.json();
  assert.equal(payload.data.length,1);
  assert.deepEqual(payload.failedSources,['鉅亨美股']);
  assert.equal(saved.data[0].headline,'台積電 & 晶片');
});

test('browser news falls back to dated static items and never revives expired memory',async()=>{
  let clock=now;
  class Clock extends Date { static now(){return clock;} }
  const requests=[];
  const ctx=vm.createContext({Date:Clock,console:{warn(){}},CONFIG:{MARKET_API:'https://worker.example',REFRESH_NEWS:300000},
    requestTimeoutSignal:()=>undefined,fetch:async url=>{
      requests.push(url);
      return url.startsWith('data/') ? {ok:true,json:async()=>({generatedAt:new Date(now-3600000).toISOString(),data:[article]})}
        : {ok:false,status:503};
    }});
  vm.runInContext(fs.readFileSync(new URL('../../js/news.js',import.meta.url),'utf8'),ctx);
  const fallback=await vm.runInContext('NewsService.getNews(true)',ctx);
  assert.equal(fallback.length,1);
  assert.equal(fallback.meta.delivery,'static');
  assert.equal(fallback.meta.generatedAt,new Date(now-3600000).toISOString());
  assert.equal(requests.length,2);
  clock+=73*3600000;
  const expired=await vm.runInContext('NewsService.getNews(true)',ctx);
  assert.equal(expired.length,0);
});

test('featured cards settle independently after missing/partial responses and label valid closes',()=>{
  const element={innerHTML:'',querySelector:()=>null};
  const ctx=vm.createContext({Intl,setTimeout:()=>{},window:{_featuredQuotes:[]},
    DataService:{isFreshRecord:q=>q.asOf===now,isMarketOpen:()=>false},
    document:{getElementById:()=>element}});
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js',import.meta.url),'utf8'),ctx);
  vm.runInContext('UI.renderFeatured({loading:true})',ctx);
  assert.equal((element.innerHTML.match(/載入中/g)||[]).length,2);
  vm.runInContext('UI.renderFeatured()',ctx);
  assert.equal((element.innerHTML.match(/暫時無法取得/g)||[]).length,2);
  assert.doesNotMatch(element.innerHTML,/載入中/);
  ctx.window._featuredQuotes=[{symbol:'0050.TW',name:'元大台灣50',price:106.9,changePct:-1.16,asOf:now,source:'TWSE MIS'}];
  vm.runInContext('UI.renderFeatured()',ctx);
  assert.match(element.innerHTML,/106.90/);
  assert.match(element.innerHTML,/最近收盤/);
  assert.match(element.innerHTML,/2330/);
  assert.equal((element.innerHTML.match(/暫時無法取得/g)||[]).length,1);
});

const official=[];
for(let day=Date.parse('2026-09-01');day<=Date.parse('2026-10-22');day+=86400000){
  if(MarketCalendar.tradingDay('TW',day)) official.push({time:day+3600000,open:100,high:101,low:99,close:100,volume:1000,change:0,note:''});
}
const history={symbol:'0050.TW',interval:'1d',data:official.slice(0,-1).map(row=>({...row,volume:10})),sourceAsOf:Date.parse('2026-10-22T05:30:00Z')};

test('daily repair fills the actual official session and uses one complete 21-day volume baseline',()=>{
  const repaired=reconcileDailyHistory(history,official,now);
  assert.deepEqual(repaired.repairedDates,['2026-10-22']);
  assert.equal(repaired.data.at(-1).time,Date.parse('2026-10-22T01:00:00Z'));
  assert.equal(repaired.data.at(-1).close,100);
  assert.ok(repaired.data.slice(-21).every(row=>row.volume===1000));
  assert.equal(repaired.sourceAsOf,Date.parse('2026-10-22T05:30:00Z'));
  assert.equal(repaired.volumeSource,'TWSE 全市場成交股數');
});

test('daily repair refuses adjusted-price mismatch, splits, ex-dividend reference changes and missing baselines',()=>{
  const adjusted={...history,data:history.data.map(row=>({...row,close:row.close*.9,open:row.open*.9,high:row.high*.9,low:row.low*.9}))};
  assert.throws(()=>reconcileDailyHistory(adjusted,official,now),/price bases/);
  for (const bad of [{note:'**'},{change:2}]) {
    assert.throws(()=>reconcileDailyHistory(history,[...official.slice(0,-1),{...official.at(-1),...bad}],now),/Corporate action/);
  }
  assert.throws(()=>reconcileDailyHistory(history,official.slice(-10),now),/baseline/);
  assert.throws(()=>reconcileDailyHistory(history,official.slice(0,-1),now),/missing sessions/);
});

test('daily repair replaces a partial provider candle only after official completion',()=>{
  const partial={...history,data:[...history.data,{...official.at(-1),close:88}],sourceAsOf:Date.parse('2026-10-22T05:25:00Z')};
  const repaired=reconcileDailyHistory(partial,official,now);
  assert.equal(repaired.data.at(-1).close,100);
});

test('official monthly parser validates identity, OHLC, split note and excludes incomplete current sessions',()=>{
  const payload={stat:'OK',title:'115年10月 0050 元大台灣50 各日成交資訊',
    fields:['日期','成交股數','開盤價','最高價','最低價','收盤價','漲跌價差','註記'],
    data:[['115/10/22','132,441,805','108.95','109.15','106.75','106.90','-1.25',''],
      ['115/10/23','100','100','101','99','100','0','']]};
  const rows=parseTwseMonth(payload,'0050','2026-10',now);
  assert.equal(rows.length,1);
  assert.equal(rows[0].volume,132441805);
  assert.equal(rows[0].change,-1.25);
  assert.throws(()=>parseTwseMonth(payload,'2330','2026-10',now));
});
