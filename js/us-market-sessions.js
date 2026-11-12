// Shared New York session clock. Dates are exchange dates; display times use Taipei.
globalThis.UsMarketSessions = (() => {
  const DAY = 86400000;
  const names = {pre:'盤前',regular:'盤中',post:'盤後',closed:'休市'};
  const formatter = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  function parts(time) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(time)).map(x=>[x.type,x.value]));
    return {day:`${p.year}-${p.month}-${p.day}`,minutes:Number(p.hour)*60+Number(p.minute),
      year:Number(p.year),month:Number(p.month),date:Number(p.day),hour:Number(p.hour),minute:Number(p.minute),second:Number(p.second)};
  }
  function at(day, minutes) {
    const noon = Date.parse(day+'T12:00:00Z');
    const p = parts(noon);
    const offset = Date.UTC(p.year,p.month-1,p.date,p.hour,p.minute,p.second)-noon;
    return Date.parse(day)+minutes*60000-offset;
  }
  function schedule(day) {
    const close = MarketCalendar.closeMinutes('US',Date.parse(day));
    const postClose = close < 960 ? 1020 : 1200;
    return {pre:{start:at(day,240),end:at(day,570)},
      regular:{start:at(day,570),end:at(day,close)},post:{start:at(day,close),end:at(day,postClose)}};
  }
  function context(now=Date.now()) {
    const p=parts(now), day=Date.parse(p.day);
    const trading=MarketCalendar.tradingDay('US',day);
    const hours=schedule(p.day);
    const phase=trading ? Object.keys(hours).find(key=>now>=hours[key].start&&now<hours[key].end)||'closed' : 'closed';
    let displayDay=day;
    if(!trading||p.minutes<240) displayDay-=DAY;
    for(let i=0;i<30&&!MarketCalendar.tradingDay('US',displayDay);i++) displayDay-=DAY;
    const sessionDay=new Date(displayDay).toISOString().slice(0,10);
    return {phase,sessionDay,today:p.day,schedule:schedule(sessionDay),earlyClose:MarketCalendar.closeMinutes('US',displayDay)<960};
  }
  const validSymbol = value => typeof value==='string'&&/^[A-Z][A-Z0-9.-]{0,14}$/.test(value)&&! /\.(TW|TWO)$/.test(value);
  const positive = value => typeof value==='number'&&Number.isFinite(value)&&value>0;
  function view(snapshot,now=Date.now()) {
    const clock=context(now);
    const usable=snapshot?.schemaVersion===1&&snapshot.sessionDay===clock.sessionDay;
    const slots={};
    for(const key of ['pre','regular','post']) {
      const bounds=clock.schedule[key], candidate=usable?snapshot.sessions?.[key]:null;
      const quote=candidate&&positive(candidate.price)&&Number.isFinite(candidate.asOf)
        &&candidate.asOf>=bounds.start&&candidate.asOf<=now
        &&(candidate.asOf<bounds.end||(key==='regular'&&candidate.kind==='regular-quote'&&candidate.asOf<=bounds.end+60000)) ? candidate:null;
      const reference=quote&&positive(quote.reference)?quote.reference:null;
      slots[key]={...bounds,quote,reference,
        change:quote&&reference?quote.price-reference:null,
        changePct:quote&&reference?(quote.price/reference-1)*100:null,
        state:now<bounds.start?'upcoming':!quote?'unavailable':now>=bounds.end?'ended':now-quote.asOf>20*60000?'delayed':'active'};
    }
    return {...clock,slots};
  }
  return {names,parts,at,schedule,context,validSymbol,positive,view};
})();
