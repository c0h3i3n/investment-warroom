// Sources: NYSE hours-calendars; TWSE holidaySchedule (2026).
// Update the published exchange calendar annually, including exceptional closures.
globalThis.MARKET_HOLIDAYS = /* calendar:start */ {
  "US": ["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25"],
  "TW": ["2026-01-01","2026-02-12","2026-02-13","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-02-27","2026-04-03","2026-04-06","2026-05-01","2026-06-19","2026-09-25","2026-09-28","2026-10-09","2026-10-26","2026-12-25"]
} /* calendar:end */;
globalThis.MarketCalendar = (() => {
  const dayMs = 86400000;
  function tradingDay(region, day) {
    const date = new Date(day);
    return ![0, 6].includes(date.getUTCDay())
      && !(MARKET_HOLIDAYS[region] || []).includes(date.toISOString().slice(0, 10));
  }
  function closeMinutes(region, day) {
    if (region === 'TW') return 810;
    return ['2026-11-27', '2026-12-24'].includes(new Date(day).toISOString().slice(0, 10)) ? 780 : 960;
  }
  function latestSession(region, day, minutes) {
    const open = region === 'TW' ? 540 : 570;
    if (minutes < open || !tradingDay(region, day)) day -= dayMs;
    for (let i = 0; i < 30; i++, day -= dayMs) {
      if (tradingDay(region, day)) return day;
    }
    return NaN;
  }
  return { tradingDay, closeMinutes, latestSession };
})();
