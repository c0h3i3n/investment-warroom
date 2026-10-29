// Only exchange-owned sources can change the trading calendar.
export const CALENDAR_KEY = 'market:official-calendar:v1';
export const SOURCES = {
  annual: 'https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json',
  notices: 'https://www.twse.com.tw/rwd/zh/news/feed?type=rss',
  futures: 'https://www.taifex.com.tw/cht/index',
};
const DAY = 86400000;
const BACKUP_URL='https://c0h3i3n.github.io/investment-warroom/data/calendar.json';
const text = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => text(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1]);
const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

export function parseAnnualCalendar(payload, year) {
  if (payload?.stat !== 'ok' || Number(payload.queryYear) !== year || !Array.isArray(payload.data)
    || payload.data.length < 10) throw new Error('Official calendar year/shape mismatch');
  const closed = [];
  for (const row of payload.data) {
    if (!Array.isArray(row) || !validDate(row[0]) || !row[0].startsWith(`${year}-`)) {
      throw new Error('Invalid official calendar date');
    }
    const description = row.slice(1).join(' ');
    if (/開始交易|最後交易/.test(description) && !/無交易|休市/.test(description)) continue;
    if (!/放假|補假|無交易|休市/.test(description)) throw new Error('Unrecognized calendar row');
    closed.push(row[0]);
  }
  return { year, closed: [...new Set(closed)].sort() };
}

// Deliberately narrow: a dated, unconditional, full-market one-day closure.
// Conditional typhoon guidance and individual security suspensions are NOT closures.
export function closureDate(value) {
  const body = text(value);
  if (/如[果遇]?|若|假設|可能|視情況|取消休市|照常交易|正常交易/.test(body)) return null;
  const match = body.match(/(\d{3,4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:[（(][^）)]{0,12}[）)])?\s*(?:臺灣(?:證券|期貨)交易所)?\s*集中交易市場\s*(?:全日休市|休市(?:一|1)天|休市(?:一|1)日)/)
    || body.match(/臺灣證券交易所集中交易市場\s*(\d{3,4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(?:全日休市|休市(?:一|1)天|休市(?:一|1)日)/);
  if (!match) return null;
  const year = Number(match[1]) + (match[1].length === 3 ? 1911 : 0);
  const date = `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return validDate(date) ? date : null;
}

export function parseTwseNotices(xml, now = Date.now()) {
  if (!/<rss\b/.test(xml) || !/<\/rss>/.test(xml) || !/<title>TSEC FEED<\/title>/.test(xml)) {
    throw new Error('Invalid official RSS');
  }
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  if (!items.length) throw new Error('Empty official RSS');
  let latest = 0;
  const closures = [], unresolved = [];
  for (const [, item] of items) {
    const publishedAt = Date.parse(tag(item, 'pubDate'));
    if (!Number.isFinite(publishedAt) || publishedAt > now + 300000) throw new Error('Invalid announcement time');
    latest = Math.max(latest, publishedAt);
    const title = tag(item, 'title');
    const body = tag(item, 'content:encoded');
    const url = new URL(tag(item, 'link'), SOURCES.notices);
    if (url.origin !== 'https://www.twse.com.tw' || !url.pathname.startsWith('/rwd/zh/news/newsDetail/')) {
      throw new Error('Non-exchange announcement URL');
    }
    const date = closureDate(`${title} ${body}`);
    if (date) closures.push({ date, scope: 'TW', reason: title, source: url.href, publishedAt });
    else if (/集中交易市場.*休市|颱風.*休市/.test(title) && now - publishedAt < 3 * DAY) unresolved.push(title);
  }
  if (now - latest > 10 * DAY) throw new Error('Official RSS is too old');
  return { closures, unresolved, latest };
}

export function parseTaifexEmergency(html) {
  // A removed banner leaves its section label in a comment. Inert markup is
  // not an announcement; visible but unrecognized banners must still fail shut.
  html = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  if (!html.includes('臺灣期貨交易所') || !/<header\b/.test(html) || !/<\/html>/i.test(html)) {
    throw new Error('Invalid TAIFEX homepage');
  }
  const notices = [...html.matchAll(/緊急公告<\/span>[\s\S]{0,300}?<div class="txt">([\s\S]*?)<\/div>/g)]
    .map(match => text(match[1]));
  const closures = [], unresolved = [];
  for (const notice of new Set(notices)) {
    const date = closureDate(notice);
    if (date && /包含一般交易時段及盤後交易時段/.test(notice)) {
      closures.push({ date, scope: 'TAIFEX', reason: notice.split('。')[0], source: SOURCES.futures });
    } else if (/休市|停止交易|暫停交易/.test(notice)) unresolved.push(notice);
  }
  if (html.includes('緊急公告') && !notices.length) throw new Error('Emergency announcement layout changed');
  return { closures, unresolved };
}

async function get(url, retry=true) {
  for(let attempt=0;attempt<(retry?2:1);attempt++) {
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(attempt?6000:3500),cache:'no-store',
        headers:{Accept:'application/json, application/rss+xml, text/html'}});
      if(response.ok) return response;
      const error=new Error(`Official source HTTP ${response.status}`);
      error.retryable=response.status===429||response.status>=500;
      throw error;
    } catch(error) {
      if(!retry||attempt===1||error.retryable===false) throw error;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
  }
}

export function validAnnualSnapshot(calendar,year,now=Date.now()) {
  return calendar?.year===year && Array.isArray(calendar.closed) && calendar.closed.length>=5
    && calendar.closed.every(date=>validDate(date)&&date.startsWith(`${year}-`))
    && calendar.source===SOURCES.annual && Number.isFinite(calendar.checkedAt)
    && calendar.checkedAt>0 && calendar.checkedAt<=now+300000;
}

async function preloadYear(prior,year,now) {
  const saved=prior.annuals?.[year];
  const attempt=prior.preload?.year===year?prior.preload:null;
  const retryAfter=attempt?.status==='unavailable'?15*60000:DAY;
  if(attempt && now>=attempt.attemptedAt && now-attempt.attemptedAt<retryAfter
    && (attempt.status!=='ready'||validAnnualSnapshot(saved,year,now))) return {...attempt,calendar:saved};
  try {
    const payload=await (await get(`${SOURCES.annual}&queryYear=${year}`,false)).json();
    if(payload?.stat==='ok' && Number.isInteger(Number(payload.queryYear)) && Number(payload.queryYear)!==year) {
      return {year,status:validAnnualSnapshot(saved,year,now)?'ready':'pending-publication',
        attemptedAt:now,providerYear:Number(payload.queryYear),source:SOURCES.annual,calendar:saved};
    }
    const calendar={...parseAnnualCalendar(payload,year),checkedAt:now,source:SOURCES.annual};
    return {year,status:'ready',attemptedAt:now,verifiedAt:now,source:SOURCES.annual,calendar};
  } catch(error) {
    return {year,status:validAnnualSnapshot(saved,year,now)?'ready':'unavailable',attemptedAt:now,
      source:SOURCES.annual,error:String(error.message),calendar:saved};
  }
}

export async function refreshOfficialCalendar(previous = null, now = Date.now(), allowBackup = true) {
  const date = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const year = Number(date.slice(0, 4));
  const prior = previous?.schemaVersion === 1 ? previous : {};
  const annuals={...prior.annuals};
  if(prior.annual?.year) annuals[prior.annual.year]=prior.annual;
  const current=annuals[year];
  const state = { schemaVersion: 1, date, attemptedAt: now, annual: prior.annual || null,
    annuals,closures: prior.closures || [], checks: {} };
  // Start the independent backup alongside primary checks, not after a timeout.
  const backupRequest=allowBackup?get(BACKUP_URL,false).then(r=>r.json()).catch(()=>null):Promise.resolve(null);
  const [annual, notices, futures, preload] = await Promise.allSettled([
    current?.year === year && now>=current.checkedAt && now - current.checkedAt < DAY
      ? current
      : get(`${SOURCES.annual}&queryYear=${year}`).then(r => r.json())
        .then(data => ({ ...parseAnnualCalendar(data, year), checkedAt: now, source: SOURCES.annual })),
    get(SOURCES.notices).then(r => r.text()).then(xml => parseTwseNotices(xml, now)),
    get(SOURCES.futures).then(r => r.text()).then(parseTaifexEmergency),
    preloadYear({...prior,annuals},year+1,now),
  ]);
  if (annual.status === 'fulfilled') annuals[year] = annual.value;
  if(preload.status==='fulfilled') {
    const {calendar,...status}=preload.value;
    state.preload=status;
    if(validAnnualSnapshot(calendar,year+1,now)) annuals[year+1]=calendar;
  }
  const merged = new Map(state.closures.filter(item => validDate(item.date)
    && Date.parse(item.date) > now - 400 * DAY).map(item => [`${item.scope}:${item.date}`, item]));
  for (const [name, result] of [['annual', annual], ['notices', notices], ['futures', futures]]) {
    state.checks[name] = { ok: result.status === 'fulfilled' && !result.value.unresolved?.length,
      checkedAt: result.status === 'fulfilled' ? now : prior.checks?.[name]?.checkedAt || null,
      error: result.status === 'rejected' ? String(result.reason?.message || 'Official check failed')
        : result.value.unresolved?.length ? 'Announcement requires manual review' : null };
    if (result.status === 'fulfilled') for (const item of result.value.closures || []) merged.set(`${item.scope}:${item.date}`, item);
  }
  // A second execution network reads the SAME official sources. Preserve the
  // original verification time; fetching a backup does not make it current.
  const backup=await backupRequest;
  if (allowBackup && [annual,notices,futures].some(result => result.status === 'rejected')) {
    try {
      if (backup?.schemaVersion === 1 && Array.isArray(backup.closures)) {
        const candidates={...backup.annuals};
        if(backup.annual?.year) candidates[backup.annual.year]=backup.annual;
        for(const target of [year-1,year,year+1]) {
          const incoming=candidates[target],existing=annuals[target];
          if(validAnnualSnapshot(incoming,target,now) && (!validAnnualSnapshot(existing,target,now)
            || incoming.checkedAt>existing.checkedAt)) annuals[target]=incoming;
        }
        if(annual.status==='rejected' && validAnnualSnapshot(annuals[year],year,now)
          && now-annuals[year].checkedAt<DAY) state.checks.annual={ok:true,checkedAt:annuals[year].checkedAt,
            delivery:'github-official-check',directError:state.checks.annual.error};
        for (const item of backup.closures) {
          const source = new URL(item.source);
          const trusted = item.scope === 'TW' ? source.origin === 'https://www.twse.com.tw'
            && source.pathname.startsWith('/rwd/zh/news/newsDetail/')
            : item.scope === 'TAIFEX' && item.source === SOURCES.futures;
          if (trusted && validDate(item.date) && Date.parse(item.date) > now - 400 * DAY) {
            merged.set(`${item.scope}:${item.date}`, item);
          }
        }
        for (const name of ['notices', 'futures']) {
          const check = backup.checks?.[name];
          if (!state.checks[name].ok && check?.ok && check.checkedAt <= now
            && now - check.checkedAt <= 10 * 60000) {
            state.checks[name] = {...check, delivery:'github-official-check', directError:state.checks[name].error};
          }
        }
      }
    } catch { /* Keep explicit failed-check state and previously known closures. */ }
  }
  state.annual=annuals[year]||null;
  state.annuals=Object.fromEntries(Object.entries(annuals).filter(([key,value])=>
    Number(key)>=year-1&&Number(key)<=year+1&&value?.year===Number(key)));
  if(validAnnualSnapshot(annuals[year+1],year+1,now)) state.preload={...state.preload,year:year+1,
    status:'ready',verifiedAt:annuals[year+1].checkedAt,source:SOURCES.annual};
  state.closures = [...merged.values()];
  return state;
}
