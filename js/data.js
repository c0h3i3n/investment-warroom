// ═══════════════════════════════════════
// J.A.R.V.I.S · DATA LAYER v3.2
// Multi-source: Yahoo Finance v8 + TWSE MIS
// Multiple CORS proxy fallback
// ═══════════════════════════════════════

const DataService = (() => {

  // ── Internal cache ──
  const cache = new Map();
  const CACHE_TTL = 15000;
  let activeProxyIndex = 0;

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

  function isMarketOpen(region, now = new Date()) {
    const timeZone = region === 'TW' ? 'Asia/Taipei' : 'America/New_York';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now).map(p => [p.type, p.value]));
    if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return region === 'TW'
      ? minutes >= 540 && minutes <= 810
      : minutes >= 570 && minutes <= 960;
  }

  function isFreshTimestamp(timestamp, region) {
    const sourceMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number(timestamp);
    if (!Number.isFinite(sourceMs) || sourceMs <= 0) return false;
    const age = Date.now() - sourceMs;
    if (age < -5 * 60 * 1000) return false;
    const maxAge = isMarketOpen(region) ? 20 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    return age <= maxAge;
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
  async function fetchWithProxy(url, timeoutMs = 8000) {
    const freshUrl = addCacheBuster(url);
    // Try direct first with short timeout
    try {
      const resp = await fetch(freshUrl, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const text = await resp.text();
        const parsed = parseProxyResponse(text);
        if (parsed) return parsed;
      }
    } catch (e) { /* CORS blocked — expected */ }

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
        console.warn(`Rejected stale/invalid Yahoo quote: ${originalSymbol}`);
        return null;
      }

      return {
        symbol: originalSymbol,
        name: meta.shortName || meta.longName || meta.symbol,
        price: price,
        change: (price != null && prevClose != null) ? price - prevClose : null,
        changePct: (prevClose && price != null) ? ((price - prevClose) / prevClose * 100) : null,
        prevClose: prevClose,
        currency: meta.currency,
        source: 'Yahoo Finance',
        asOf: sourceTime,
      };
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

    try {
      const results = await Promise.all(symbols.map(s => fetchOneChartQuote(OTC_YAHOO_MAP[s] || s)));
      const valid = results.filter(r => r != null);
      if (valid.length > 0) {
        setCache(key, valid);
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
        if (arr && arr.length > 0 && arr.some(r => r.z && r.z !== '-')) {
          return parseMIS(arr);
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
      return { symbol, price, change, changePct, prevClose, currency:'TWD', name: r.n||r.nf||r.c, source:'TWSE MIS', asOf:sourceTime, priceType };
    }).filter(r=>r!=null);
  }

  // ═══════════════════════════════════════
  // FETCH INDEXES — MIS for TW, Yahoo v8 for US
  // ═══════════════════════════════════════
  async function fetchIndexes() {
    const key = 'indexes:all';
    const cached = getCached(key);
    if (cached) return cached;

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
                results.push({ ...idx, price, change, changePct, source:'TWSE MIS', asOf:sourceTime });
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

    setCache(key, results);
    return results;
  }

  // ═══════════════════════════════════════
  // FETCH HISTORICAL
  // ═══════════════════════════════════════
  async function fetchHistorical(symbol, range = '3mo', interval = '1d') {
    const key = `hist:${symbol}:${range}:${interval}`;
    const cached = getCached(key);
    if (cached) return cached;

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
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

      setCache(key, data);
      return data;
    } catch (e) {
      console.warn('fetchHistorical failed:', e.message);
      return null;
    }
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
    clearCache,
    isFreshRecord,
  };
})();
