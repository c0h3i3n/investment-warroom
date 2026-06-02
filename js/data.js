// ═══════════════════════════════════════
// J.A.R.V.I.S · DATA LAYER
// Yahoo Finance API integration with CORS fallback
// ═══════════════════════════════════════

const DataService = (() => {

  // ── Internal cache ──
  const cache = new Map();
  const CACHE_TTL = 30000; // 30 seconds

  // ── Fetch with CORS proxy fallback ──
  async function fetchWithFallback(url, useProxy = true) {
    // Try direct
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) return await resp.json();
    } catch (e) {
      console.debug('Direct fetch failed, trying proxy:', e.message);
    }
    // Fallback to CORS proxy
    if (useProxy) {
      const proxyUrl = CONFIG.CORS_PROXY + encodeURIComponent(url);
      const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) throw new Error(`Proxy fetch failed: ${resp.status}`);
      return await resp.json();
    }
    throw new Error('All fetch methods failed');
  }

  // ── Cache helpers ──
  function getCached(key) {
    const entry = cache.get(key);
    if (entry && (Date.now() - entry.ts) < CACHE_TTL) {
      return entry.data;
    }
    cache.delete(key);
    return null;
  }
  function setCache(key, data) {
    cache.set(key, { ts: Date.now(), data });
  }

  // ── Fetch quote for multiple symbols (real-time) ──
  async function fetchQuotes(symbols) {
    const key = `quotes:${symbols.join(',')}`;
    const cached = getCached(key);
    if (cached) return cached;

    const url = CONFIG.YAHOO_QUOTE + symbols.join(',');
    try {
      const json = await fetchWithFallback(url);
      const result = json.quoteResponse?.result || [];
      // Map to our format
      const mapped = result.map(r => ({
        symbol: r.symbol,
        name: r.shortName || r.symbol,
        price: r.regularMarketPrice,
        change: r.regularMarketChange,
        changePct: r.regularMarketChangePercent,
        prevClose: r.regularMarketPreviousClose,
        currency: r.currency || (r.symbol.endsWith('.TW') ? 'TWD' : 'USD'),
      }));
      setCache(key, mapped);
      return mapped;
    } catch (e) {
      console.error('fetchQuotes error:', e);
      return null;
    }
  }

  // ── Fetch historical data for chart & indicators ──
  async function fetchHistorical(symbol, range = '3mo', interval = '1d') {
    const key = `hist:${symbol}:${range}:${interval}`;
    const cached = getCached(key);
    if (cached) return cached;

    const url = `${CONFIG.YAHOO_CHART}${symbol}?range=${range}&interval=${interval}`;
    try {
      const json = await fetchWithFallback(url);
      const result = json.chart?.result?.[0];
      if (!result) throw new Error('No chart data');

      const { timestamp, indicators } = result;
      const quote = indicators.quote[0];
      const adjClose = indicators.adjclose?.[0]?.adjclose || quote.close;

      // Build OHLCV array
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
      console.error('fetchHistorical error:', e);
      return null;
    }
  }

  // ── Fetch all indexes at once ──
  async function fetchIndexes() {
    const symbols = CONFIG.INDEXES.map(i => i.symbol);
    const quotes = await fetchQuotes(symbols);
    if (!quotes) return null;

    return CONFIG.INDEXES.map(idx => {
      const q = quotes.find(q => q.symbol === idx.symbol);
      return q ? { ...idx, ...q } : idx;
    });
  }

  // ── Fetch single symbol quote ──
  async function fetchQuote(symbol) {
    const results = await fetchQuotes([symbol]);
    return results ? results[0] : null;
  }

  // ── Clear cache ──
  function clearCache() {
    cache.clear();
  }

  // ── Public API ──
  return {
    fetchQuotes,
    fetchQuote,
    fetchHistorical,
    fetchIndexes,
    clearCache,
  };
})();
