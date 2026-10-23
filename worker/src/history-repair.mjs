import '../../js/market-calendar.js';
import '../../js/history-validation.js';
const DAY=86400000;
const dayOf=time=>new Date(Number(time)+8*3600000).toISOString().slice(0,10);
const dayTime=date=>Date.parse(`${date}T09:00:00+08:00`);
const closeEnough=(a,b)=>Math.abs(a-b)<=Math.max(.011,Math.abs(b)*.00001);

export function completedTwSession(now = Date.now()) {
  const local=new Date(now+8*3600000);
  let day=Date.parse(local.toISOString().slice(0,10));
  if (local.getUTCHours()*60+local.getUTCMinutes()<825) day-=DAY;
  while (!MarketCalendar.tradingDay('TW',day)) day-=DAY;
  return new Date(day).toISOString().slice(0,10);
}

export function parseTwseMonth(payload,code,month,now=Date.now()) {
  if (payload?.stat!=='OK' || !String(payload.title).includes(` ${code} `)
    || !Array.isArray(payload.fields) || !Array.isArray(payload.data)) throw new Error('Invalid TWSE daily response');
  const fields=['日期','成交股數','開盤價','最高價','最低價','收盤價','漲跌價差','註記'];
  const indexes=Object.fromEntries(fields.map(field=>[field,payload.fields.indexOf(field)]));
  if (fields.some(field=>indexes[field]<0)) throw new Error('TWSE daily fields changed');
  const number=value=>/^[+-]?\d[\d,]*(?:\.\d+)?$/.test(String(value))?Number(String(value).replaceAll(',','')):null;
  const expected=completedTwSession(now);
  return payload.data.flatMap(row=>{
    const match=String(row[indexes['日期']]).match(/^(\d{3})\/(\d{2})\/(\d{2})$/);
    if (!match) return [];
    const date=`${Number(match[1])+1911}-${match[2]}-${match[3]}`;
    if (!date.startsWith(month) || date>expected || new Date(Date.parse(date)).toISOString().slice(0,10)!==date) return [];
    const data={time:dayTime(date),open:number(row[indexes['開盤價']]),high:number(row[indexes['最高價']]),
      low:number(row[indexes['最低價']]),close:number(row[indexes['收盤價']]),volume:number(row[indexes['成交股數']])};
    if (!HistoryValidation.normalize([data],`${code}.TW`,'1d',now).length || !(data.volume>0)) return [];
    return [{...data,change:number(row[indexes['漲跌價差']]),note:String(row[indexes['註記']] || '')}];
  });
}

export function reconcileDailyHistory(history, official, now = Date.now()) {
  const expected=completedTwSession(now);
  const rows=history.data.filter(row=>dayOf(row.time)<=expected);
  const source=Number(history.sourceAsOf);
  // A partial latest candle cannot serve as a price-basis anchor.
  if (rows.length && dayOf(rows.at(-1).time)===expected
    && (!(source>0) || source<Date.parse(`${expected}T13:29:00+08:00`))) rows.pop();
  if (rows.length<3) throw new Error('Insufficient history to verify price basis');
  const map=new Map(official.map(row=>[dayOf(row.time),row]));
  const latestDay=dayOf(rows.at(-1).time);
  if (latestDay>=expected) return history;
  const additions=[];
  for(let day=Date.parse(latestDay)+DAY;day<=Date.parse(expected);day+=DAY){
    if (!MarketCalendar.tradingDay('TW',day)) continue;
    const row=map.get(new Date(day).toISOString().slice(0,10));
    if (!row || additions.length>=5) throw new Error('Official daily series still has missing sessions');
    additions.push(row);
  }
  // Confirm three preceding candles use the same current price basis. This
  // intentionally refuses a splice across an unverified dividend/split.
  for (const anchor of rows.slice(-3)) {
    const reference=map.get(dayOf(anchor.time));
    if (!reference || !['open','high','low','close'].every(key=>closeEnough(anchor[key],reference[key]))) {
      throw new Error('Adjusted and official price bases do not match');
    }
  }
  let previous=rows.at(-1).close;
  for (const row of additions) {
    if (row.note.includes('**') || !Number.isFinite(row.change) || !closeEnough(row.close-row.change,previous)) {
      throw new Error('Corporate action or price-reference discontinuity requires validation');
    }
    previous=row.close;
  }
  // Use ONE volume source for both the comparison day and all 20 baseline days.
  const joined=[...rows,...additions];
  if (joined.slice(-21).some(row=>!map.has(dayOf(row.time)))) throw new Error('Official 21-session volume baseline incomplete');
  const data=joined.map(row=>({time:row.time,open:row.open,high:row.high,low:row.low,close:row.close,
    volume:map.get(dayOf(row.time))?.volume ?? null}));
  return {...history,data,source:'Yahoo Finance＋TWSE 官方補值',priceBasis:'adjusted-verified',
    volumeSource:'TWSE 全市場成交股數', repairedDates:additions.map(row=>dayOf(row.time)),
    sourceAsOf:Date.parse(`${expected}T13:30:00+08:00`),generatedAt:new Date(now).toISOString()};
}

export async function repairTwseHistory(history, env, now=Date.now()) {
  if (!['0050.TW','2330.TW'].includes(history.symbol) || history.interval!=='1d') return history;
  const latest=history.data.at(-1);
  const expected=completedTwSession(now);
  if (!latest || dayOf(latest.time)>expected) return history;
  if (dayOf(latest.time)===expected && Number(history.sourceAsOf)>=Date.parse(`${expected}T13:29:00+08:00`)) return history;
  const code=history.symbol.replace('.TW','');
  const date=new Date(expected);
  const months=[0,1].map(offset=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-offset,1)).toISOString().slice(0,7));
  const results=await Promise.all(months.map(async month=>{
    const key=`market:twse-month:v1:${code}:${month}`;
    const cached=await env?.MARKET_CACHE?.get(key,{type:'json'}).catch(()=>null);
    if (cached?.code===code && cached.month===month && now-cached.fetchedAt<300000 && now>=cached.fetchedAt) {
      return parseTwseMonth(cached.payload,code,month,now);
    }
    const response=await fetch(`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${month.replace('-','')}01&stockNo=${code}`,
      {signal:AbortSignal.timeout(5000),cache:'no-store',headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error(`TWSE daily HTTP ${response.status}`);
    const payload=await response.json();
    const rows=parseTwseMonth(payload,code,month,now);
    await env?.MARKET_CACHE?.put(key,JSON.stringify({code,month,fetchedAt:now,payload}),{expirationTtl:86400}).catch(()=>{});
    return rows;
  }));
  return reconcileDailyHistory(history,results.flat(),now);
}
