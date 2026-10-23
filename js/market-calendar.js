// Sources: https://www.nyse.com/trade/hours-calendars (2026–2027)
// https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json (TW: 2026)
// Checked 2026-09-20: requesting TW 2027 still returns queryYear:2026. Do not infer it.
// Update the published exchange calendar annually, including exceptional closures.
globalThis.MARKET_HOLIDAYS = /* calendar:start */ {
  "US": ["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25","2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24"],
  "TW": ["2026-01-01","2026-02-12","2026-02-13","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-02-27","2026-04-03","2026-04-06","2026-05-01","2026-06-19","2026-09-25","2026-09-28","2026-10-09","2026-10-26","2026-12-25"]
} /* calendar:end */;
globalThis.MarketCalendar = (() => {
  const dayMs = 86400000;
  let official = null;
  function applyOfficial(state) {
    if (state?.schemaVersion !== 1 || !Array.isArray(state.closures)
      || !Number.isFinite(state.attemptedAt)) return false;
    if (official && state.attemptedAt < official.attemptedAt) return false;
    official = state;
    return true;
  }
  function scheduledTradingDay(region, day) {
    const date = new Date(day);
    const key = date.toISOString().slice(0, 10);
    const holidays = region === 'TW' && official?.annual?.year === date.getUTCFullYear()
      ? official.annual.closed : MARKET_HOLIDAYS[region] || [];
    return ![0, 6].includes(date.getUTCDay())
      && !holidays.includes(key);
  }
  function closure(scope, day) {
    const key = new Date(day).toISOString().slice(0, 10);
    return official?.closures.find(item => item.scope === scope && item.date === key);
  }
  function tradingDay(region, day) {
    return scheduledTradingDay(region, day) && !(region === 'TW' && closure('TW', day));
  }
  function nightStartDay(day) {
    return scheduledTradingDay('TW', day) && !closure('TAIFEX', day);
  }
  function verification(now = Date.now()) {
    const date = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    const day = Date.parse(date);
    const notice = closure('TW', day);
    const fresh = official?.date === date && now >= official.attemptedAt
      && now - official.attemptedAt <= 10 * 60000;
    const checked = Boolean(fresh && official.checks?.annual?.ok && official.checks?.notices?.ok);
    return { date, status: notice ? 'closed-announcement' : !scheduledTradingDay('TW', day)
      ? 'closed-calendar' : checked ? 'scheduled' : 'unverified',
      checked, checkedAt: official?.checks?.notices?.checkedAt || null,
      reason: notice?.reason || null, source: notice?.source || 'https://www.twse.com.tw/zh/terms/rss.html',
      futuresChecked: Boolean(fresh && official.checks?.futures?.ok),
      futuresClosure: closure('TAIFEX', day) || null };
  }
  function closeMinutes(region, day) {
    if (region === 'TW') return 810;
    return ['2026-11-27', '2026-12-24', '2027-11-26'].includes(new Date(day).toISOString().slice(0, 10)) ? 780 : 960;
  }
  function latestSession(region, day, minutes) {
    const open = region === 'TW' ? 540 : 570;
    if (minutes < open || !tradingDay(region, day)) day -= dayMs;
    for (let i = 0; i < 30; i++, day -= dayMs) {
      if (tradingDay(region, day)) return day;
    }
    return NaN;
  }
  return { tradingDay, scheduledTradingDay, nightStartDay, closeMinutes, latestSession,
    applyOfficial, verification, officialState: () => official };
})();
