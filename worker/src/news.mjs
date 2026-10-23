export const NEWS_KEY = 'market:news:v1';
export const NEWS_MAX_AGE = 72 * 3600000;
export const NEWS_FEEDS = [
  {name:'鉅亨頭條',category:'headline',region:'INTL'},
  {name:'鉅亨台股',category:'tw_stock',region:'TW'},
  {name:'鉅亨美股',category:'wd_stock',region:'US'},
];
const decode = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/<[^>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,key)=>{
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
    const k=key.toLowerCase();
    if (k in named) return named[k];
    const code=k.startsWith('#x')?parseInt(k.slice(2),16):Number(k.slice(1));
    return code>=32&&code<=0x10ffff?String.fromCodePoint(code):all;
  }).replace(/\s+/g,' ').trim();
const tag = (item,name) => decode(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,'i'))?.[1]);

export function validNews(items, now = Date.now()) {
  const seen=new Set();
  return (Array.isArray(items)?items:[]).filter(item=>{
    if (!item || typeof item.headline!=='string' || !item.headline.trim()
      || !Number.isFinite(item.publishedAt) || item.publishedAt>now+300000
      || now-item.publishedAt>NEWS_MAX_AGE) return false;
    try {
      const url=new URL(item.link);
      if (url.origin!=='https://news.cnyes.com' || !/^\/news\/id\/\d+$/.test(url.pathname)) return false;
      if (seen.has(url.href)) return false;
      seen.add(url.href); return true;
    } catch { return false; }
  }).sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,40);
}

export function parseNewsRss(xml, feed, now = Date.now()) {
  if (xml.length>2000000 || !/<rss\b/.test(xml) || !/<\/rss>/.test(xml)) throw new Error('Invalid news RSS');
  const items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([,item])=>({
    headline:tag(item,'title').slice(0,200),link:tag(item,'link'),
    publishedAt:Date.parse(tag(item,'pubDate')), source:feed.name,
    region:feed.region,feedRegion:feed.region,
    categories:[...item.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map(m=>decode(m[1])),
    fetchedAt:now,
  }));
  const result=validNews(items,now);
  if (!result.length) throw new Error('News source has no dated, recent items');
  return result;
}

async function fetchFeed(feed,now) {
  const response=await fetch(`https://news.cnyes.com/rss/v1/news/category/${feed.category}`,{
    signal:AbortSignal.timeout(5000),headers:{Accept:'application/rss+xml, application/xml'},cache:'no-store',
  });
  if (!response.ok) throw new Error(`News source HTTP ${response.status}`);
  return parseNewsRss(await response.text(),feed,now);
}

export async function getNewsSnapshot(env, force = false, now = Date.now()) {
  let cached=await env?.MARKET_CACHE?.get(NEWS_KEY,{type:'json'}).catch(()=>null);
  if (cached?.schemaVersion!==1) cached=null;
  const saved=validNews(cached?.data,now);
  const age=now-Date.parse(cached?.generatedAt || '');
  if (!force && saved.length && age>=0 && age<300000) return {...cached,data:saved,delivery:'kv'};
  const results=await Promise.allSettled(NEWS_FEEDS.map(feed=>fetchFeed(feed,now)));
  const current=results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
  const failedSources=NEWS_FEEDS.filter((_,i)=>results[i].status==='rejected').map(feed=>feed.name);
  // Retain a recent source's items during a partial outage, with per-item times.
  const data=validNews([...current,...saved],now);
  if (!data.length) return {schemaVersion:1,generatedAt:null,checkedAt:now,data:[],failedSources,delivery:'unavailable'};
  const payload={schemaVersion:1,generatedAt:current.length?new Date(now).toISOString():cached.generatedAt,
    checkedAt:now,data,failedSources,delivery:current.length?'live':'stale-kv'};
  if (env?.MARKET_CACHE && current.length) {
    await env.MARKET_CACHE.put(NEWS_KEY,JSON.stringify(payload),{expirationTtl:604800}).catch(()=>{});
  }
  return payload;
}
