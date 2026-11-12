import '../../js/market-calendar.js';
import '../../js/us-market-sessions.js';
const S=globalThis.UsMarketSessions;

export function parseUsSessions(payload,symbol,now=Date.now()) {
  const result=payload?.chart?.result?.[0],meta=result?.meta;
  if(!S.validSymbol(symbol)||meta?.symbol!==symbol||meta.currency!=='USD'
    || !['EQUITY','ETF'].includes(meta.instrumentType)||meta.exchangeTimezoneName!=='America/New_York'
    ||meta.dataGranularity!=='5m'||!Array.isArray(result.timestamp)||!Array.isArray(result.indicators?.quote?.[0]?.close)
    ||result.timestamp.length!==result.indicators.quote[0].close.length)
    throw new Error('Invalid US session response');
  const clock=S.context(now),sessions={pre:null,regular:null,post:null};
  const values=result.indicators.quote[0].close;
  result.timestamp.forEach((seconds,i)=>{
    const asOf=Number(seconds)*1000,price=values[i];
    if(!Number.isFinite(asOf)||asOf>now||!S.positive(price)||S.parts(asOf).day!==clock.sessionDay) return;
    const key=Object.keys(clock.schedule).find(key=>asOf>=clock.schedule[key].start&&asOf<clock.schedule[key].end);
    if(key&&(key==='regular'||meta.hasPrePostMarketData===true)&&(!sessions[key]||asOf>sessions[key].asOf))
      sessions[key]={price,asOf,kind:'5m-close',reference:null};
  });
  const regularTime=Number(meta.regularMarketTime)*1000;
  const sameDay=Number.isFinite(regularTime)&&S.parts(regularTime).day===clock.sessionDay;
  if(sameDay&&S.positive(meta.regularMarketPrice)&&regularTime<=now
    &&regularTime>=clock.schedule.regular.start&&regularTime<=clock.schedule.regular.end+60000
    &&(!sessions.regular||regularTime>=sessions.regular.asOf)) {
    sessions.regular={price:meta.regularMarketPrice,asOf:regularTime,kind:'regular-quote',reference:null};
  }
  // chartPreviousClose belongs to the beginning of the multi-day chart, not yesterday.
  const previousDay=new Date(MarketCalendar.latestSession('US',Date.parse(clock.sessionDay)-86400000,1440)).toISOString().slice(0,10);
  const previousClose=sameDay&&S.positive(meta.previousClose)?meta.previousClose
    :Number.isFinite(regularTime)&&S.parts(regularTime).day===previousDay
      &&regularTime>=S.schedule(previousDay).regular.end-60000&&S.positive(meta.regularMarketPrice)?meta.regularMarketPrice:null;
  if(sessions.pre) sessions.pre.reference=previousClose;
  if(sessions.regular) sessions.regular.reference=previousClose;
  const finalRegular=sessions.regular?.kind==='regular-quote'
    &&sessions.regular.asOf>=clock.schedule.regular.end-60000 ? sessions.regular.price:null;
  if(sessions.post) sessions.post.reference=finalRegular;
  return {schemaVersion:1,symbol,sessionDay:clock.sessionDay,source:'Yahoo Finance',interval:'5m',
    generatedAt:new Date(now).toISOString(),sessions};
}

export function createUsSessionService(fetcher=(...args)=>globalThis.fetch(...args)) {
  const memory=new Map(),pending=new Map();
  async function upstream(symbol,now) {
    const path=`/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m&includePrePost=true`;
    let failure;
    for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']) {
      try {
        const response=await fetcher(`https://${host}${path}`,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},signal:AbortSignal.timeout(4500)});
        if(!response.ok) throw new Error(`US sessions HTTP ${response.status}`);
        return parseUsSessions(await response.json(),symbol,now);
      } catch(error) {failure=error;}
    }
    throw failure;
  }
  return async function get(symbol,env,now=Date.now()) {
    if(!S.validSymbol(symbol)) throw new Error('Unsupported US symbol');
    const key=`market:us-sessions:v1:${symbol}`,clock=S.context(now);
    const stored=memory.get(symbol)||await env?.MARKET_CACHE?.get(key,{type:'json'}).catch(()=>null);
    const age=now-Date.parse(stored?.generatedAt||'');
    const valid=stored?.schemaVersion===1&&stored.symbol===symbol&&stored.sessionDay===clock.sessionDay&&age>=0;
    const ttl=clock.phase==='closed'?300000:60000;
    if(valid&&age<ttl) return {...stored,delivery:'cache'};
    if(pending.has(symbol)) return pending.get(symbol);
    const task=(async()=>{
      try {
        const fresh=await upstream(symbol,now);
        memory.set(symbol,fresh);
        if(memory.size>32) memory.delete(memory.keys().next().value);
        // Persist at most every five minutes per symbol; memory still refreshes each minute.
        const persisted=await env?.MARKET_CACHE?.get(key,{type:'json'}).catch(()=>null);
        if(!persisted||persisted.sessionDay!==fresh.sessionDay||now-Date.parse(persisted.generatedAt)>=300000) {
          await env?.MARKET_CACHE?.put(key,JSON.stringify(fresh),{expirationTtl:604800}).catch(()=>{});
        }
        return {...fresh,delivery:'source'};
      } catch(error) {
        if(valid&&age<=(clock.phase==='closed'?4*86400000:15*60000))
          return {...stored,delivery:'stale-cache',warning:'來源更新失敗，保留已標示時間的資料'};
        throw error;
      }
    })().finally(()=>pending.delete(symbol));
    pending.set(symbol,task);
    return task;
  };
}
