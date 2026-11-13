import '../../js/market-calendar.js';
import '../../js/us-market-sessions.js';

const S=globalThis.UsMarketSessions, M=60000, DAY=86400000;
const time=value=>new Date(typeof value==='number'?value:Date.parse(value)).getTime();
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const closeEnough=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(.005,Math.abs(b)*1e-8);
const taipeiDay=now=>new Date(now+8*60*M).toISOString().slice(0,10);
const annualSource='https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json';

// Inspect delivered data independently of the UI's filtering. Never repair quotes.
export function inspectData({market,calendar,sessions={},scope,errors={}},now=Date.now()) {
  const checks=[];
  const add=(id,status,message)=>checks.push({id,status,message});
  const check=(id,ok,message)=>add(id,ok?'pass':'issue',message);
  const state=calendar?.calendar,day=taipeiDay(now),year=Number(day.slice(0,4));
  const annual=state?.annuals?.[year]||state?.annual;
  const calendarFresh=state?.schemaVersion===1&&state.date===day&&Number.isFinite(state?.attemptedAt)
    &&state.attemptedAt<=now+M&&now-state.attemptedAt<=10*M;
  const annualOk=annual?.year===year&&annual.source===annualSource&&Array.isArray(annual.closed)
    &&annual.closed.length>=5&&annual.closed.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)
      &&d.startsWith(`${year}-`)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)
    &&Number.isFinite(annual.checkedAt)&&annual.checkedAt<=now+M&&now-annual.checkedAt<=DAY
    &&Array.isArray(state.closures)&&calendarFresh&&state.checks?.annual?.ok===true;
  check('calendar:annual',annualOk,annualOk?`${year} 年官方日曆已確認`:`${year} 年官方日曆年份、格式或查核時間待確認`);
  for(const [key,label] of [['notices','證交所公告'],['futures','期交所公告']]) {
    const c=state?.checks?.[key];
    check(`calendar:${key}`,calendarFresh&&c?.ok===true&&Number.isFinite(c.checkedAt)
      &&c.checkedAt<=now+M&&now-c.checkedAt<=10*M,`${label}查核結果與時間`);
  }
  const twTrading=d=>![0,6].includes(new Date(d).getUTCDay())&&!annual?.closed?.includes(d)
    &&!state?.closures?.some(x=>x.scope==='TW'&&x.date===d);
  const usClock=S.context(now);
  function quoteFresh(q,region) {
    const stamp=time(q.asOf);
    if(!Number.isFinite(stamp)||stamp<=0||stamp>now+M) return false;
    if(region==='US') {
      const p=S.parts(now),todayHours=S.schedule(p.day);
      const trading=MarketCalendar.tradingDay('US',Date.parse(p.day));
      if(trading&&now>=todayHours.regular.start&&now<todayHours.regular.end)
        return S.parts(stamp).day===p.day&&stamp>=todayHours.regular.start&&now-stamp<=20*M;
      let expected=Date.parse(p.day);
      if(!trading||now<todayHours.regular.start) expected-=DAY;
      for(let i=0;i<30&&!MarketCalendar.tradingDay('US',expected);i++) expected-=DAY;
      const d=new Date(expected).toISOString().slice(0,10),hours=S.schedule(d);
      // Allow the final hour's valid delayed normal quote, as the dashboard does.
      return stamp>=hours.regular.end-60*M&&stamp<=hours.post.end;
    }
    const minutes=new Date(now+8*60*M).getUTCHours()*60+new Date(now+8*60*M).getUTCMinutes();
    if(twTrading(day)&&minutes>=540&&minutes<810)
      return taipeiDay(stamp)===day&&stamp>=Date.parse(day+'T09:00:00+08:00')&&now-stamp<=8*M;
    let expected=Date.parse(day);
    if(!twTrading(day)||minutes<540) expected-=DAY;
    for(let i=0;i<30&&!twTrading(new Date(expected).toISOString().slice(0,10));i++) expected-=DAY;
    const d=new Date(expected).toISOString().slice(0,10);
    return taipeiDay(stamp)===d&&stamp>=Date.parse(d+'T12:30:00+08:00');
  }
  const quotes=Array.isArray(market?.quotes)?market.quotes:[];
  const indexes=Array.isArray(market?.indexes)?market.indexes:[];
  check('market:response',market?.schemaVersion===1&&Array.isArray(market.quotes)&&Array.isArray(market.indexes)
    &&Number.isFinite(time(market.generatedAt))&&time(market.generatedAt)<=now+M&&now-time(market.generatedAt)<=30*M,
    errors.market||'整體行情回應格式與取得時間');
  for(const expected of [...scope.quotes,...scope.indexes]) {
    const rows=(scope.indexes.some(x=>x.symbol===expected.symbol)?indexes:quotes).filter(x=>x.symbol===expected.symbol);
    const q=rows[0],id=`quote:${expected.symbol}`;
    if(rows.length!==1||!positive(q?.price)||q.region!==expected.region) {
      add(id,'issue',`${expected.symbol} 報價缺失、重複或格式無效`);continue;
    }
    if(expected.region==='TW'&&!annualOk) add(`${id}:time`,'skip',`${expected.symbol}：年度日曆未確認，暫不判定交易日新鮮度`);
    else check(`${id}:time`,quoteFresh(q,expected.region),`${expected.symbol} 來源時間 ${Number.isFinite(time(q.asOf))?new Date(time(q.asOf)).toISOString():'無效'}／交易日檢查`);
    if(!positive(q.prevClose)) add(`${id}:change`,'skip',`${expected.symbol}：來源缺少前收，無法驗算漲跌`);
    else check(`${id}:change`,closeEnough(q.change,q.price-q.prevClose)
      &&Number.isFinite(q.changePct)&&Math.abs(q.changePct-(q.price/q.prevClose-1)*100)<=.011,
      `${expected.symbol} 漲跌金額與百分比驗算`);
  }
  for(const symbol of scope.quotes.filter(q=>q.region==='US').map(q=>q.symbol)) {
    const data=sessions[symbol],id=`sessions:${symbol}`,hours=usClock.schedule;
    const generated=time(data?.generatedAt),age=now-generated;
    const valid=data?.schemaVersion===1&&data.symbol===symbol&&data.sessionDay===usClock.sessionDay
      &&data.source==='Yahoo Finance'&&data.interval==='5m'&&data.sessions&&Number.isFinite(generated)
      &&age>=-M&&age<=(usClock.phase==='closed'?4*DAY:15*M);
    check(id,Boolean(valid),errors[symbol]||`${symbol} 三時段交易日與資料取得時間`);
    if(!valid) continue;
    const slots=data.sessions;
    for(const key of ['pre','regular','post']) {
      const q=slots[key],bounds=hours[key],name=S.names[key];
      if(!q) {
        if(now<bounds.start) continue;
        if(key==='regular'&&now>bounds.start+30*M) add(`${id}:${key}`,'issue',`${symbol} 正常盤已開始逾 30 分鐘但沒有報價`);
        else add(`${id}:${key}`,'skip',`${symbol} ${name}來源未提供資料，未驗證此時段`);
        continue;
      }
      const stamp=q.asOf;
      const inBounds=typeof stamp==='number'&&stamp<=now&&stamp>=bounds.start
        &&(key==='regular'&&q.kind==='regular-quote'?stamp<=hours.post.end:stamp<bounds.end);
      check(`${id}:${key}`,positive(q.price)&&inBounds&&['regular-quote','5m-close'].includes(q.kind)
        &&(key==='regular'||q.kind==='5m-close')
        &&(!(now>=bounds.start&&now<bounds.end)||now-stamp<=20*M),
        `${symbol} ${name}報價類型、時間與時段邊界`);
    }
    const regular=slots.regular,post=slots.post;
    const closing=regular?.kind==='regular-quote'&&positive(regular.price)
      &&regular.asOf>=hours.regular.end-M&&regular.asOf<=hours.post.end&&regular.asOf<=now;
    if(post) {
      if(closing) check(`${id}:baseline`,closeEnough(post.reference,regular.price),`${symbol} 盤後基準應為正常盤 ${regular.price}，實際 ${post.reference??'缺值'}`);
      else if(post.reference!=null) add(`${id}:baseline`,'issue',`${symbol} 缺少有效正常盤收盤，盤後卻有漲跌基準`);
      else add(`${id}:baseline`,'skip',`${symbol} 正常盤收盤尚缺，盤後漲跌未驗算`);
    }
    const q=quotes.find(q=>q.symbol===symbol);
    if(regular?.kind==='regular-quote'&&q?.source===data.source&&time(q.asOf)===regular.asOf) {
      check(`${id}:compare`,closeEnough(q.price,regular.price),`${symbol} 同來源時間：自選股 ${q.price}／正常盤 ${regular.price}`);
      if(positive(q.prevClose)) check(`${id}:previous-close`,closeEnough(regular.reference,q.prevClose)
        &&(!slots.pre||closeEnough(slots.pre.reference,q.prevClose)),`${symbol} 盤前及正常盤漲跌基準應為前收 ${q.prevClose}`);
      else add(`${id}:previous-close`,'skip',`${symbol} 前收缺值，盤前及正常盤基準未比對`);
    }
    else add(`${id}:compare`,'skip',`${symbol} 報價時間或類型不同，未直接比價`);
  }
  return checks;
}

export function makeReport(checks,scope,previous=null,now=Date.now()) {
  const age=now-time(previous?.checkedAt),recent=previous?.schemaVersion===1&&age>=0&&age<=45*M;
  const results=checks.map(c=>{
    if(c.status!=='issue') return c;
    const prior=recent&&Array.isArray(previous.checks)&&previous.checks.find(p=>p.id===c.id&&['pending','warning'].includes(p.status)&&Number.isInteger(p.occurrences)&&p.occurrences>0);
    const count=prior?Math.min(99,prior.occurrences+(age>=M?1:0)):1;
    return {...c,status:count>=2?'warning':'pending',occurrences:count};
  });
  const counts=Object.fromEntries(['pass','skip','pending','warning'].map(s=>[s,results.filter(c=>c.status===s).length]));
  return {schemaVersion:1,checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+45*M).toISOString(),
    status:counts.warning?'warning':counts.pending?'pending':counts.skip?'partial':'ok',
    scope:{quotes:scope.quotes.map(q=>q.symbol),indexes:scope.indexes.map(q=>q.symbol)},counts,checks:results};
}
