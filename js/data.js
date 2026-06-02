// ═══════════════════════════════════════
// J.A.R.V.I.S · DATA LAYER v3.1
// Multi-source: Yahoo Finance + TWSE MIS
// Multiple CORS proxy fallback
// ═══════════════════════════════════════

const DataService = (() => {

  // ── Internal cache ──
  const cache = new Map();
  const CACHE_TTL = 45000;
  let activeProxyIndex = 0;

  // ═══════════════════════════════════════
  // FALLBACK DATA
  // ═══════════════════════════════════════
  const FALLBACK_INDEXES = {
    '^TWII':  { price: 45337.91, change: 604.97, changePct: 1.35 },
    '^TWOII': { price: 446.02,   change: 7.81,   changePct: 1.78 },
    '^GSPC':  { price: 6723.05,  change: 42.15,  changePct: 0.63 },
    '^IXIC':  { price: 22680.40, change: 138.31, changePct: 0.61 },
    '^SOX':   { price: 6285.29,  change: 89.14,  changePct: 1.44 },
  };

  const FALLBACK_QUOTES = {
    '0050.TW':   { price: 105.50,  change: 0.10,   changePct: 0.09,  name: '元大台灣50',          currency: 'TWD' },
    '00679B.TW': { price: 27.24,   change: -0.08,  changePct: -0.29, name: '元大美債20年',        currency: 'TWD' },
    '00878.TW':  { price: 23.82,   change: 0.24,   changePct: 1.02,  name: '國泰永續高股息',      currency: 'TWD' },
    '00929.TW':  { price: 19.66,   change: 0.14,   changePct: 0.72,  name: '復華台灣科技優息',    currency: 'TWD' },
    '00933B.TW': { price: 15.33,   change: 0.05,   changePct: 0.33,  name: '國泰10Y+金融債',      currency: 'TWD' },
    '00937B.TW': { price: 17.45,   change: 0.03,   changePct: 0.17,  name: '群益ESG投等債20+',    currency: 'TWD' },
    '2330.TW':   { price: 2355.00, change: 0.00,   changePct: 0.00,  name: '台積電',              currency: 'TWD' },
    'NVDA':      { price: 224.36,  change: 3.51,   changePct: 1.59,  name: '輝達',                currency: 'USD' },
    'TSLA':      { price: 370.89,  change: 8.26,   changePct: 2.28,  name: '特斯拉',              currency: 'USD' },
  };

  // ═══════════════════════════════════════
  // PARSE PROXY RESPONSE (handles allorigins wrapper)
  // ═══════════════════════════════════════
  function parseProxyResponse(text) {
    // Try direct JSON first
    try {
      const json = JSON.parse(text);
      // allorigins wraps in { contents: "<json string>", status: {...} }
      if (json.contents) {
        try { return JSON.parse(json.contents); } catch { return json.contents; }
      }
      return json;
    } catch {}
    // Return as text if not JSON
    return text;
  }

  // ═══════════════════════════════════════
  // CORE FETCH — tries each proxy in sequence
  // ═══════════════════════════════════════
  async function fetchWithProxy(url, timeoutMs = 8000) {
    // Try direct first with short timeout
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
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
      const proxyUrl = proxy + encodeURIComponent(url);

      try {
        const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs) });
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
  // FETCH QUOTES — Yahoo Finance via proxy
  // ═══════════════════════════════════════
  async function fetchQuotes(symbols) {
    const key = `quotes:${symbols.join(',')}`;
    const cached = getCached(key);
    if (cached) return cached;

    const url = CONFIG.YAHOO_QUOTE + symbols.join(',');
    try {
      const json = await fetchWithProxy(url);
      const result = json?.quoteResponse?.result;
      if (!result || result.length === 0) throw new Error('Empty quote response');

      const mapped = result.map(r => ({
        symbol: r.symbol,
        name: r.shortName || r.longName || r.symbol,
        price: r.regularMarketPrice,
        change: r.regularMarketChange,
        changePct: r.regularMarketChangePercent,
        prevClose: r.regularMarketPreviousClose,
        currency: r.currency,
      }));

      setCache(key, mapped);
      return mapped;
    } catch (e) {
      console.warn('fetchQuotes failed:', e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════
  // FETCH TWSE MIS QUOTES — Taiwan stocks
  // ═══════════════════════════════════════
  async function fetchMISQuotes(twSymbols) {
    const parts = twSymbols.map(s => {
      const code = s.replace(/\.TW$/i, '');
      const ex = (code.length === 4 && code.startsWith('00')) ? 'tse' : 'tse';
      return `${ex}_${code}.tw`;
    });

    const misUrl = `${CONFIG.MIS_BASE}?ex_ch=${parts.join('|')}&json=1&delay=0`;

    try {
      const json = await fetchWithProxy(misUrl, 10000);
      const msgArray = json?.msgArray;
      if (!msgArray || msgArray.length === 0) throw new Error('Empty MIS response');

      const mapped = msgArray
        .filter(r => r.c && r.c !== '')
        .map(r => {
          const code = r.c;
          const symbol = code + '.TW';
          const prevClose = parseFloat(r.y) || null;
          const zVal = parseFloat(r.z);
          const price = !isNaN(zVal) ? zVal : prevClose;
          const change = (price != null && prevClose != null) ? price - prevClose : null;
          const changePct = (prevClose && change != null) ? (change / prevClose) * 100 : null;

          return {
            symbol: symbol,
            name: r.n || r.nf || code,
            price: price,
            change: change,
            changePct: changePct,
            prevClose: prevClose,
            currency: 'TWD',
          };
        });

      return mapped.length > 0 ? mapped : null;
    } catch (e) {
      console.warn('fetchMISQuotes failed:', e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════
  // FETCH INDEXES — MIS for TW, Yahoo for US
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

              results.push({ ...idx, price, change, changePct });
            }
          });
        }
      } catch (e) {
        console.warn('TW index fetch failed:', e.message);
      }
    }

    // ── US indexes via Yahoo ──
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

    // ── Fill gaps with fallback ──
    CONFIG.INDEXES.forEach(idx => {
      const existing = results.find(r => r.id === idx.id);
      if (!existing || existing.price == null) {
        const fb = FALLBACK_INDEXES[idx.symbol];
        if (fb) {
          const entry = { ...idx, ...fb };
          if (existing) {
            const exIdx = results.findIndex(r => r.id === idx.id);
            results[exIdx] = { ...entry, ...existing };
          } else {
            results.push(entry);
          }
        }
      }
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

    const url = `${CONFIG.YAHOO_CHART}${symbol}?range=${range}&interval=${interval}`;
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

    // Try Yahoo for all (US must use Yahoo, and serves as TW fallback)
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

    // Fill any remaining gaps with fallback
    allSymbols.forEach(s => {
      if (!result.find(r => r.symbol === s)) {
        const fb = FALLBACK_QUOTES[s];
        if (fb) result.push({ symbol: s, ...fb });
      }
    });

    return result.length > 0 ? result : null;
  }

  // ═══════════════════════════════════════
  // FALLBACK HELPERS
  // ═══════════════════════════════════════
  function getFallbackQuotes(symbols) {
    return symbols.map(s => {
      const fb = FALLBACK_QUOTES[s];
      if (fb) return { symbol: s, ...fb };
      return { symbol: s, name: s, price: null, change: null, changePct: null };
    });
  }

  // ═══════════════════════════════════════
  // CLEAR CACHE
  // ═══════════════════════════════════════
  function clearCache() {
    cache.clear();
    activeProxyIndex = 0;
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
    clearCache,
  };
})();
