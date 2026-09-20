// Shared by Worker and browser fallback. All OHLC fields use one price basis.
globalThis.HistoryValidation = {
  normalize(rows, symbol, interval, now = Date.now()) {
    const region = /\.TW(O)?$/.test(symbol) || /^\^TW/.test(symbol) ? 'TW' : 'US';
    const zone = region === 'TW' ? 'Asia/Taipei' : 'America/New_York';
    const dates = new Map();
    const valid = value => value !== null && value !== undefined && value !== ''
      && Number.isFinite(Number(value));
    for (const row of rows || []) {
      if (!row || !valid(row.time) || Number(row.time) <= 0
        || Number(row.time) > now + 300000) continue;
      const time = Number(row.time);
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'
      }).formatToParts(new Date(time)).map(p => [p.type,p.value]));
      const day = Date.UTC(+parts.year,+parts.month-1,+parts.day);
      if (!MarketCalendar.tradingDay(region, day)) continue;
      if (!['open','high','low','close'].every(k => valid(row[k]) && +row[k] > 0)) continue;
      if (+row.low > Math.min(+row.open,+row.close) || +row.high < Math.max(+row.open,+row.close)
        || +row.low > +row.high) continue;
      const item = {time,open:+row.open,high:+row.high,low:+row.low,close:+row.close,
        volume:valid(row.volume) && +row.volume >= 0 ? +row.volume : null};
      dates.set(interval === '1d' ? day : time, item);
    }
    return [...dates.values()].sort((a,b) => a.time-b.time);
  },
  fromYahoo(result, symbol, interval) {
    const quote = result?.indicators?.quote?.[0];
    if (!quote || !Array.isArray(result.timestamp)) return [];
    const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
    const rows = result.timestamp.map((t,i) => {
      const close = quote.close?.[i], adj = adjusted?.[i];
      const factor = close > 0 && adj > 0 ? adj / close : 1;
      const price = key => quote[key]?.[i] == null ? null : quote[key][i] * factor;
      return {time:t*1000,open:price('open'),high:price('high'),low:price('low'),
        close:price('close'),volume:quote.volume?.[i]};
    });
    return this.normalize(rows,symbol,interval);
  }
};
