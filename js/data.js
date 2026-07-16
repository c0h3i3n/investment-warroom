// ═══════════════════════════════════════
// J.A.R.V.I.S · DATA LAYER v3.2
// Multi-source: Yahoo Finance v8 + TWSE MIS
// Multiple CORS proxy fallback
// ═══════════════════════════════════════

const DataService = (() => {

  // ── Internal cache ──
  const cache = new Map();
  const latestRecords = new Map();
  const indexSeriesCache = new Map();
  const indexSeriesInFlight = new Map();
  const CACHE_TTL = 15000;
  const INDEX_SERIES_OPEN_TTL = 60000;
  const INDEX_SERIES_CLOSED_TTL = 15 * 60 * 1000;
  const INDEX_SERIES_CLOSE_GRACE = 10;
  const MARKET_DATA_CLOSED_MAX_AGE = 4 * 24 * 60 * 60 * 1000;
  const MARKET_SESSIONS = {
    TW: { timeZone: 'Asia/Taipei', open: 540, close: 810 },
    US: { timeZone: 'America/New_York', open: 570, close: 960 },
  };
  let activeProxyIndex = 0;
  let cacheEpoch = 0;
  let indexSeriesEpoch = 0;

  // ── OTC ETF symbols need .TWO suffix on Yahoo Finance ──
  const OTC_YAHOO_MAP = { '00679B.TW':'00679B.TWO', '00933B.TW':'00933B.TWO', '00937B.TW':'00937B.TWO' };
  const OTC_YAHOO_REV = {}; for (const [k,v] of Object.entries(OTC_YAHOO_MAP)) OTC_YAHOO_REV[v]=k;
  const OTC_CODES = new Set(['00679B','00687B','00712','00713','00751B','00864B','00933B','00937B','00942B','00945B','00948B','00950B','00951B','00952B','00953B','00956B','00957B','00958B','00959B','00960B','00961B','00962B','00963B','00964B','00965B']);

  // ═══════════════════════════════════════
  // FRESHNESS & REQUEST HELPERS
  // ═══════════════════════════════════════
  function addCacheBuster(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_wr=${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function getMarketTimeParts(region, timestamp = Date.now()) {
    const session = MARKET_SESSIONS[region] || MARKET_SESSIONS.US;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: session.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
    const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
    return {
      ...parts,
      minutes: hour * 60 + Number(parts.minute),
      dayNumber: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
    };
  }

  function isWeekday(parts) {
    return parts.weekday !== 'Sat' && parts.weekday !== 'Sun';
  }

  function isMarketOpen(region, now = new Date()) {
    const session = MARKET_SESSIONS[region] || MARKET_SESSIONS.US;
    const parts = getMarketTimeParts(region, now);
    return isWeekday(parts) && parts.minutes >= session.open && parts.minutes < session.close;
  }

  function isInClosingGrace(region, now = new Date()) {
    const session = MARKET_SESSIONS[region] || MARKET_SESSIONS.US;
    const parts = getMarketTimeParts(region, now);
    return isWeekday(parts)
      && parts.minutes >= session.close
      && parts.minutes < session.close + INDEX_SERIES_CLOSE_GRACE;
  }

  function isFreshTimestamp(timestamp, region, nowMs = Date.now()) {
    const sourceMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number(timestamp);
    if (!Number.isFinite(sourceMs) || sourceMs <= 0) return false;
    const age = nowMs - sourceMs;
    if (age < -5 * 60 * 1000) return false;
    if (isMarketOpen(region, new Date(nowMs))) return age <= 20 * 60 * 1000;
    if (age > MARKET_DATA_CLOSED_MAX_AGE) return false;

    // Outside trading hours, only the latest plausible trading session is
    // accepted. This prevents a proxy or scheduled snapshot from making a
    // days-old quote look current merely by refreshing its envelope timestamp.
    const session = MARKET_SESSIONS[region] || MARKET_SESSIONS.US;
    const sourceParts = getMarketTimeParts(region, sourceMs);
    const nowParts = getMarketTimeParts(region, nowMs);
    if (!isWeekday(sourceParts) || sourceParts.minutes < session.close - 60) return false;
    if (isWeekday(nowParts) && nowParts.minutes >= session.close
      && sourceParts.dayNumber !== nowParts.dayNumber) return false;
    return countWeekdaysCrossed(sourceMs, nowMs, region) <= 1;
  }

  function countWeekdaysCrossed(sourceMs, nowMs, region) {
    const source = getMarketTimeParts(region, sourceMs);
    const now = getMarketTimeParts(region, nowMs);
    if (!Number.isFinite(source.dayNumber) || !Number.isFinite(now.dayNumber)
      || source.dayNumber > now.dayNumber) return Infinity;

    let weekdays = 0;
    for (let day = source.dayNumber + 24 * 60 * 60 * 1000;
      day <= now.dayNumber;
      day += 24 * 60 * 60 * 1000) {
      const weekday = new Date(day).getUTCDay();
      if (weekday >= 1 && weekday <= 5) weekdays += 1;
    }
    return weekdays;
  }

  function isFreshIndexSeriesTimestamp(timestamp, region, nowMs = Date.now()) {
    return isFreshTimestamp(timestamp, region, nowMs);
  }

  function isFreshRecord(record, region = record?.region || (/\.TW$/i.test(record?.symbol || '') ? 'TW' : 'US')) {
    return Number.isFinite(Number(record?.price)) && Number(record.price) > 0
      && isFreshTimestamp(record?.asOf, region);
  }

  function parseMisTimestamp(row) {
    const epoch = Number(row.tlong);
    if (Number.isFinite(epoch) && epoch > 0) return epoch;
    if (!/^\d{8}$/.test(row.d || '') || !/^\d{2}:\d{2}:\d{2}$/.test(row.t || '')) return null;
    const d = row.d;
    return Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${row.t}+08:00`);
  }

  function keepNewest(record, key = record?.symbol || record?.id) {
    if (!record || !key) return record;
    const previous = latestRecords.get(key);
    const nextTime = typeof record.asOf === 'string' ? Date.parse(record.asOf) : Number(record.asOf);
    const previousTime = typeof previous?.asOf === 'string' ? Date.parse(previous.asOf) : Number(previous?.asOf);
    if (previous && Number.isFinite(previousTime) && Number.isFinite(nextTime)
      && previousTime > nextTime && isFreshRecord(previous, previous.region)) {
      return previous;
    }
    latestRecords.set(key, record);
    return record;
  }

  function rememberRecords(records = []) {
    records.forEach(record => {
      if (isFreshRecord(record, record?.region)) {
        keepNewest({ ...record, deliveryMode: 'cache' });
      }
    });
  }

  // ═══════════════════════════════════════
  // PARSE PROXY RESPONSE (handles allorigins wrapper)
  // ═══════════════════════════════════════
  function parseProxyResponse(text) {
    try {
      const json = JSON.parse(text);
      if (json.contents) {
        try { return JSON.parse(json.contents); } catch { return json.contents; }
      }
      return json;
    } catch {}
    return text;
  }

  // ═══════════════════════════════════════
  // CORE FETCH — tries each proxy in sequence
  // ═══════════════════════════════════════
  async function fetchWithProxy(url, timeoutMs = 8000, options = {}) {
    const freshUrl = addCacheBuster(url);
    // Try direct first with short timeout
    if (options.direct !== false) {
      try {
        const resp = await fetch(freshUrl, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
          const text = await resp.text();
          const parsed = parseProxyResponse(text);
          if (parsed) return parsed;
        }
      } catch (e) { /* CORS blocked — expected */ }
    }

    // Try each proxy
    const startIdx = activeProxyIndex;
    for (let attempt = 0; attempt < CONFIG.CORS_PROXIES.length; attempt++) {
      const idx = (startIdx + attempt) % CONFIG.CORS_PROXIES.length;
      const proxy = CONFIG.CORS_PROXIES[idx];
      const proxyUrl = addCacheBuster(proxy + encodeURIComponent(freshUrl));

      try {
        const resp = await fetch(proxyUrl, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          if (text.includes('Server-side requests are not allowed')) continue;
          if (text.includes('Rate limit exceeded')) continue;
          throw new Error(`Proxy ${idx} returned ${resp.status}`);
        }
        const text = await resp.text();
        activeProxyIndex = idx;
        const parsed = parseProxyResponse(text);
        if (parsed) return parsed;
      } catch (e) {
        if (attempt === CONFIG.CORS_PROXIES.length - 1) {
          console.warn('All proxies failed:', e.message);
        }
      }
    }
    return null;
  }

  // ═══════════════════════════════════════
  // CACHE HELPERS
  // ═══════════════════════════════════════
  function getCached(key) {
    const entry = cache.get(key);
    if (entry && (Date.now() - entry.ts) < CACHE_TTL) return entry.data;
    cache.delete(key);
    return null;
  }
  function setCache(key, data) {
    cache.set(key, { ts: Date.now(), data });
  }

  // ═══════════════════════════════════════
  // FETCH SINGLE QUOTE via v8 chart API
  // ═══════════════════════════════════════
  async function fetchOneChartQuote(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
    try {
      const json = await fetchWithProxy(url, 8000);
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta) return null;

      const price = meta.regularMarketPrice;
      const prevClose = meta.previousClose || meta.chartPreviousClose;
      const sourceTime = Number(meta.regularMarketTime) * 1000;
      const originalSymbol = OTC_YAHOO_REV[meta.symbol] || symbol;
      const region = /\.TW$/i.test(originalSymbol) ? 'TW' : 'US';
      if (!isFreshRecord({ price, asOf: sourceTime }, region)) {
        console.info(`Rejected stale/invalid Yahoo quote: ${originalSymbol}`);
        return null;
      }

      return keepNewest({
        symbol: originalSymbol,
        name: meta.shortName || meta.longName || meta.symbol,
        price: price,
        change: (price != null && prevClose != null) ? price - prevClose : null,
        changePct: (prevClose && price != null) ? ((price - prevClose) / prevClose * 100) : null,
        prevClose: prevClose,
        currency: meta.currency,
        source: 'Yahoo Finance',
        asOf: sourceTime,
        priceType: 'trade',
        region,
      }, originalSymbol);
    } catch (e) {
      console.warn(`fetchOneChartQuote ${symbol} failed:`, e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════
  // FETCH QUOTES — parallel v8 chart calls
  // ═══════════════════════════════════════
  async function fetchQuotes(symbols) {
    const key = `quotes:${symbols.join(',')}`;
    const cached = getCached(key);
    if (cached) return cached;
    const requestEpoch = cacheEpoch;

    try {
      const results = await Promise.all(symbols.map(s => fetchOneChartQuote(OTC_YAHOO_MAP[s] || s)));
      const valid = results.filter(r => r != null);
      if (valid.length > 0) {
        if (requestEpoch === cacheEpoch) setCache(key, valid);
        return valid;
      }
    } catch (e) {
      console.warn('fetchQuotes failed:', e.message);
    }
    return null;
  }

  // ═══════════════════════════════════════
  // FETCH TWSE MIS QUOTES — Taiwan stocks
  // ═══════════════════════════════════════
  function getMISKey(symbol) {
    const code = symbol.replace(/\.TW$/i, '');
    const ex = OTC_CODES.has(code) ? 'otc' : 'tse';
    return `${ex}_${code}.tw`;
  }

  async function fetchMISQuotes(twSymbols) {
    // Try batch first, fall back to individual with stagger
    const parts = twSymbols.map(s => getMISKey(s));
    try {
      const url = `${CONFIG.MIS_BASE}?ex_ch=${parts.join('|')}&json=1&delay=0&_=${Date.now()}`;
      const resp = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const json = await resp.json();
        const arr = json?.msgArray;
        if (arr && arr.length > 0) {
          const parsed = parseMIS(arr);
          if (parsed.length > 0) return parsed;
        }
      }
    } catch(e) {}

    // Fallback: proxy batch
    try {
      const proxyUrl = `${CONFIG.MIS_BASE}?ex_ch=${parts.join('|')}&json=1&delay=0&_=${Date.now()}`;
      const json = await fetchWithProxy(proxyUrl, 10000);
      if (json?.msgArray) return parseMIS(json.msgArray);
    } catch(e) {}

    // Individual queries with stagger
    const results = [];
    const delay = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < twSymbols.length; i++) {
      if (i > 0) await delay(300);
      try {
        const key = getMISKey(twSymbols[i]);
        const url = `${CONFIG.MIS_BASE}?ex_ch=${key}&json=1&delay=0&_=${Date.now()}`;
        let json = null;
        try {
          const resp = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
          if (resp.ok) json = await resp.json();
        } catch(e) {}
        if (!json) json = await fetchWithProxy(url, 8000);
        if (json?.msgArray) results.push(...parseMIS(json.msgArray));
      } catch(e) {}
    }
    return results.length > 0 ? results : null;
  }

  function parseMIS(msgArray) {
    return msgArray.filter(r => r.c && r.c !== '').map(r => {
      const symbol = r.c + '.TW';
      const prevClose = parseFloat(r.y) || null;
      let price = null;
      let priceType = 'trade';
      if (r.z && r.z !== '-') {
        price = parseFloat(r.z);
      } else {
        const bids = (r.b || '').split('_').filter(Boolean).map(Number);
        const asks = (r.a || '').split('_').filter(Boolean).map(Number);
        if (bids.length && asks.length) {
          price = (bids[0] + asks[0]) / 2;
          priceType = 'indicative';
        }
      }
      if (price==null||isNaN(price)) return null;
      const change = (price!=null&&prevClose!=null) ? price-prevClose : null;
      const changePct = (prevClose&&change!=null) ? (change/prevClose)*100 : null;
      const sourceTime = parseMisTimestamp(r);
      if (!isFreshRecord({ price, asOf: sourceTime }, 'TW')) return null;
      return keepNewest({ symbol, price, change, changePct, prevClose, currency:'TWD', name: r.n||r.nf||r.c, source:'TWSE MIS', asOf:sourceTime, priceType, region:'TW' }, symbol);
    }).filter(r=>r!=null);
  }

  // ═══════════════════════════════════════
  // FETCH INDEXES — MIS for TW, Yahoo v8 for US
  // ═══════════════════════════════════════
  async function fetchIndexes() {
    const key = 'indexes:all';
    const cached = getCached(key);
    if (cached) return cached;
    const requestEpoch = cacheEpoch;

    const results = [];

    // ── Taiwan indexes via MIS ──
    const twIdxConfigs = CONFIG.INDEXES.filter(i => i.misKey);
    if (twIdxConfigs.length > 0) {
      const misKeys = twIdxConfigs.map(i => i.misKey).join('|');
      const misUrl = `${CONFIG.MIS_BASE}?ex_ch=${misKeys}&json=1&delay=0`;

      try {
        const json = await fetchWithProxy(misUrl, 10000);
        const msgArray = json?.msgArray;
        if (msgArray) {
          twIdxConfigs.forEach(idx => {
            const r = msgArray.find(m => m.c === idx.misKey.replace(/.*_/, '').replace('.tw', ''));
            if (r) {
              const price = parseFloat(r.z) || null;
              const prevClose = parseFloat(r.y) || null;
              const change = (price != null && prevClose != null) ? price - prevClose : null;
              const changePct = (prevClose && change != null) ? (change / prevClose) * 100 : null;
              const sourceTime = parseMisTimestamp(r);

              if (isFreshRecord({ price, asOf: sourceTime }, 'TW')) {
                results.push(keepNewest({ ...idx, price, change, changePct, source:'TWSE MIS', asOf:sourceTime, priceType:'trade' }, idx.symbol));
              }
            }
          });
        }
      } catch (e) {
        console.warn('TW index fetch failed:', e.message);
      }
    }

    // ── US indexes via Yahoo v8 chart ──
    const usIdxConfigs = CONFIG.INDEXES.filter(i => !i.misKey);
    if (usIdxConfigs.length > 0) {
      const usSymbols = usIdxConfigs.map(i => i.symbol);
      try {
        const quotes = await fetchQuotes(usSymbols);
        if (quotes) {
          usIdxConfigs.forEach(idx => {
            const q = quotes.find(q => q.symbol === idx.symbol);
            if (q) results.push({ ...idx, ...q });
          });
        }
      } catch (e) {
        console.warn('US index fetch failed:', e.message);
      }
    }

    // Keep gaps visible; never disguise hard-coded values as current market data.
    CONFIG.INDEXES.forEach(idx => {
      const existing = results.find(r => r.id === idx.id);
      if (!existing || existing.price == null) results.push({ ...idx, unavailable:true });
    });

    if (requestEpoch === cacheEpoch) setCache(key, results);
    return results;
  }

  // ═══════════════════════════════════════
  // FETCH HISTORICAL
  // ═══════════════════════════════════════
  async function fetchHistorical(symbol, range = '3mo', interval = '1d') {
    const key = `hist:${symbol}:${range}:${interval}`;
    const cached = getCached(key);
    if (cached) return cached;
    const requestEpoch = cacheEpoch;

    const encodedSymbol = encodeURIComponent(symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?range=${range}&interval=${interval}`;
    try {
      const json = await fetchWithProxy(url, 15000);
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error('No chart data');

      const { timestamp, indicators } = result;
      const quote = indicators.quote[0];
      const adjClose = indicators.adjclose?.[0]?.adjclose || quote.close;

      const data = timestamp.map((t, i) => ({
        time: t * 1000,
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: adjClose[i],
        volume: quote.volume[i],
      })).filter(d => d.close != null);

      if (requestEpoch === cacheEpoch) setCache(key, data);
      return data;
    } catch (e) {
      console.warn('fetchHistorical failed:', e.message);
      return null;
    }
  }

  // ═══════════════════════
  // FETCH REAL INDEX SERIES
  // TW: official MIS 1-minute chart
  // US: Yahoo 1-day/5-minute, then 5-day/hourly fallback
  // ═══════════════════════
  function normalizeSeriesPoints(points) {
    const byTime = new Map();
    (points || []).forEach(point => {
      let time = Number(point?.time);
      const close = Number(point?.close);
      if (Number.isFinite(time) && time > 0 && time < 1e12) time *= 1000;
      if (Number.isFinite(time) && time > 0 && Number.isFinite(close) && close > 0) {
        byTime.set(time, close);
      }
    });
    return [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, close]) => ({ time, close }));
  }

  function makeIndexSeries(points, region, source, period, interval) {
    const normalized = normalizeSeriesPoints(points);
    if (normalized.length < 2) return null;
    const asOf = normalized[normalized.length - 1].time;
    if (!isFreshIndexSeriesTimestamp(asOf, region)) return null;
    return {
      closes: normalized.map(point => point.close),
      asOf,
      source,
      period,
      interval,
    };
  }

  function parseMISIndexKey(misKey) {
    const separator = String(misKey || '').indexOf('_');
    if (separator <= 0) return null;
    const ex = misKey.slice(0, separator);
    const ch = misKey.slice(separator + 1);
    if (!['tse', 'otc'].includes(ex) || !/^[A-Za-z0-9]+\.tw$/i.test(ch)) return null;
    return { ex, ch };
  }

  async function fetchTWIndexSeries(index) {
    const chartKey = parseMISIndexKey(index?.misKey);
    if (!chartKey) return null;
    const url = `https://mis.twse.com.tw/stock/api/getChartOhlcStatis.jsp?ex=${encodeURIComponent(chartKey.ex)}&ch=${encodeURIComponent(chartKey.ch)}&fqy=1&delay=0`;
    // The official MIS endpoint does not expose CORS headers, so skip the
    // guaranteed-to-fail browser-direct attempt and use the configured proxies.
    const json = await fetchWithProxy(url, 10000, { direct: false });
    if (!Array.isArray(json?.ohlcArray)) return null;
    const points = json.ohlcArray.map(row => ({ time: row?.t, close: row?.c }));
    const source = chartKey.ex === 'otc' ? 'TPEx MIS' : 'TWSE MIS';
    return makeIndexSeries(points, 'TW', source, '1D', '1m');
  }

  async function fetchUSIndexSeries(index) {
    const intraday = await fetchHistorical(index.symbol, '1d', '5m');
    let series = makeIndexSeries(intraday, 'US', 'Yahoo Finance', '1D', '5m');
    if (series) return series;

    const hourly = await fetchHistorical(index.symbol, '5d', '60m');
    series = makeIndexSeries(hourly, 'US', 'Yahoo Finance', '5D', '1h');
    return series;
  }

  function getIndexSeriesCache(index) {
    const entry = indexSeriesCache.get(index.id);
    if (!entry) return null;
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const ttl = isMarketOpen(index.region, now) || isInClosingGrace(index.region, now)
      ? INDEX_SERIES_OPEN_TTL
      : INDEX_SERIES_CLOSED_TTL;
    const validData = Array.isArray(entry.data?.closes)
      && entry.data.closes.length >= 2
      && entry.data.closes.every(close => Number.isFinite(Number(close)) && Number(close) > 0)
      && isFreshIndexSeriesTimestamp(entry.data.asOf, index.region, nowMs);
    if (!validData) {
      indexSeriesCache.delete(index.id);
      return null;
    }
    return {
      data: entry.data,
      validForRequest: (nowMs - entry.ts) < ttl,
    };
  }

  function fetchOneIndexSeries(index) {
    const cached = getIndexSeriesCache(index);
    if (cached?.validForRequest) return Promise.resolve(cached.data);
    const pending = indexSeriesInFlight.get(index.id);
    if (pending) return pending;

    const requestEpoch = indexSeriesEpoch;
    const request = (async () => {
      try {
        const series = index.region === 'TW'
          ? await fetchTWIndexSeries(index)
          : await fetchUSIndexSeries(index);
        if (series) {
          if (requestEpoch === indexSeriesEpoch) {
            indexSeriesCache.set(index.id, { ts: Date.now(), data: series });
          }
          return series;
        }
      } catch (error) {
        console.warn(`Index series ${index.id} failed:`, error.message);
      }
      // A refresh failure may reuse a previously fetched series only while its
      // source timestamp still passes the same market-aware freshness check.
      if (cached?.data) {
        return cached.data;
      }
      return null;
    })();

    indexSeriesInFlight.set(index.id, request);
    request.finally(() => {
      if (indexSeriesInFlight.get(index.id) === request) indexSeriesInFlight.delete(index.id);
    });
    return request;
  }

  async function fetchIndexSeries(indexes = CONFIG.INDEXES) {
    const configs = Array.isArray(indexes)
      ? indexes.filter(index => index?.id && index?.symbol && ['TW', 'US'].includes(index?.region))
      : [];
    const settled = await Promise.allSettled(configs.map(fetchOneIndexSeries));
    const result = {};
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled' && outcome.value) {
        result[configs[index].id] = outcome.value;
      }
    });
    return result;
  }

  // ═══════════════════════════════════════
  // FETCH SINGLE QUOTE
  // ═══════════════════════════════════════
  async function fetchQuote(symbol) {
    const isTW = symbol.endsWith('.TW') || symbol.endsWith('.tw');
    if (isTW) {
      const misData = await fetchMISQuotes([symbol]);
      if (misData && misData.length > 0) return misData[0];
    }
    const results = await fetchQuotes([symbol]);
    return results ? results[0] : null;
  }

  // ═══════════════════════════════════════
  // FETCH ALL QUOTES (hybrid)
  // ═══════════════════════════════════════
  async function fetchAllQuotes(allSymbols) {
    const twSymbols = allSymbols.filter(s => /\.TW$/i.test(s));
    const usSymbols = allSymbols.filter(s => !/\.TW$/i.test(s));

    let twData = null;
    let usData = null;

    // Try MIS for Taiwan stocks first (fast, real-time)
    if (twSymbols.length > 0) {
      twData = await fetchMISQuotes(twSymbols);
    }

    // Try Yahoo v8 for all
    const yahooData = await fetchQuotes(allSymbols);

    // Merge: prefer MIS for TW, Yahoo for US
    const result = [];
    const twMap = {};
    if (twData) twData.forEach(q => { twMap[q.symbol] = q; });

    if (yahooData) {
      yahooData.forEach(q => {
        if (twMap[q.symbol]) {
          result.push(twMap[q.symbol]);
        } else {
          result.push(q);
        }
      });
    }

    // Add any TW stocks that MIS got but Yahoo didn't
    if (twData) {
      twData.forEach(q => {
        if (!result.find(r => r.symbol === q.symbol)) {
          result.push(q);
        }
      });
    }

    return result.length > 0 ? result : null;
  }

  // ═══════════════════════════════════════
  // CLEAR CACHE
  // ═══════════════════════════════════════
  function clearCache() {
    cache.clear();
    cacheEpoch += 1;
    indexSeriesCache.clear();
    indexSeriesInFlight.clear();
    indexSeriesEpoch += 1;
    activeProxyIndex = 0;
  }

  // ═══════════════════════════════════════
  // FETCH SPARKLINES — batch historical for watchlist
  // ═══════════════════════════════════════
  async function fetchSparklines(symbols) {
    const sparkMap = {};
    const results = await Promise.all(
      symbols.map(async (s) => {
        const data = await fetchHistorical(s, '3mo', '1d');
        return { symbol: s, closes: data ? data.map(d => d.close).filter(v => v != null) : null };
      })
    );
    results.forEach(r => { sparkMap[r.symbol] = r.closes; });
    return sparkMap;
  }

  // ═══════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════
  return {
    fetchQuotes,
    fetchQuote,
    fetchHistorical,
    fetchIndexes,
    fetchAllQuotes,
    fetchSparklines,
    fetchIndexSeries,
    clearCache,
    isFreshRecord,
    rememberRecords,
  };
})();
