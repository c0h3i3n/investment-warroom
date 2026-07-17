// ═══════════════════════════════════════
// J.A.R.V.I.S · MAIN APPLICATION v3.2
// Orchestrates all modules
// ═══════════════════════════════════════

const App = (() => {

  // ── State ──
  let watchlistQuotes = [];
  window._watchlistQuotes = watchlistQuotes;
  let indexData = [];
  let usingFallback = false;
  let refreshInFlight = false;
  let refreshGeneration = 0;
  let pendingForceRefresh = false;
  let portfolioGeneration = 0;
  let newsGeneration = 0;

  // ═══════════════════════════════════════
  // CLOCK & STATUS
  // ═══════════════════════════════════════
  function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(now);
    document.getElementById('dateStr').textContent = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric', month: 'short', day: '2-digit',
    }).format(now).toUpperCase();
    document.getElementById('fdate').textContent = now.toISOString().slice(0, 10);
  }

  function updateMarketStatus() {
    const now = new Date();
    const zoned = timeZone => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, weekday:'short', hour:'2-digit', minute:'2-digit', hour12:false,
    }).formatToParts(now).map(part => [part.type, part.value]));
    const twTime = zoned('Asia/Taipei');
    const usTime = zoned('America/New_York');
    const isWeekday = parts => !['Sat', 'Sun'].includes(parts.weekday);
    const twMinutes = Number(twTime.hour) * 60 + Number(twTime.minute);
    const usMinutes = Number(usTime.hour) * 60 + Number(usTime.minute);

    const twOrb = document.getElementById('twOrb');
    const twLabel = document.getElementById('twLabel');
    const usOrb = document.getElementById('usOrb');
    const usLabel = document.getElementById('usLabel');

    if (isWeekday(twTime) && twMinutes >= 540 && twMinutes < 810) {
      if (twOrb) twOrb.className = 'status-orb live';
      if (twLabel) twLabel.textContent = 'TW OPEN';
    } else {
      if (twOrb) twOrb.className = 'status-orb off';
      if (twLabel) twLabel.textContent = 'TW CLOSED';
    }

    const isPreMarket = isWeekday(usTime) && usMinutes >= 240 && usMinutes < 570;
    const isMarketOpen = isWeekday(usTime) && usMinutes >= 570 && usMinutes < 960;

    if (usOrb && usLabel) {
      if (isMarketOpen) {
        usOrb.className = 'status-orb live';
        usLabel.textContent = 'US OPEN';
      } else if (isPreMarket) {
        usOrb.className = 'status-orb pre';
        usLabel.textContent = 'US PRE-MKT';
      } else {
        usOrb.className = 'status-orb off';
        usLabel.textContent = 'US CLOSED';
      }
    }
  }

  function sourceTimesByRegion(items) {
    const result = { TW: [], US: [] };
    items.forEach(item => {
      const region = item.region || (/\.TW$/i.test(item.symbol || '') ? 'TW' : 'US');
      const time = typeof item.asOf === 'string' ? Date.parse(item.asOf) : Number(item.asOf);
      if (Number.isFinite(time) && result[region]) result[region].push(time);
    });
    return {
      twAsOf: result.TW.length ? Math.min(...result.TW) : null,
      usAsOf: result.US.length ? Math.min(...result.US) : null,
    };
  }

  function isFreshEnvelope(envelope, maxAgeMs = 60 * 60 * 1000) {
    const timestamp = Date.parse(envelope?.generatedAt || envelope?.timestamp || '');
    const age = Date.now() - timestamp;
    return Number.isFinite(timestamp) && age >= -5 * 60 * 1000 && age <= maxAgeMs;
  }

  // ═══════════════════════════════════════
  // DATA FETCHING
  // ═══════════════════════════════════════
  async function fetchAllData(forceRefresh = false) {
    if (refreshInFlight) {
      if (forceRefresh) {
        pendingForceRefresh = true;
        refreshGeneration += 1;
        portfolioGeneration += 1;
        newsGeneration += 1;
      }
      return false;
    }
    if (forceRefresh) {
      portfolioGeneration += 1;
      newsGeneration += 1;
    }
    refreshInFlight = true;
    const generation = ++refreshGeneration;
    if (forceRefresh) DataService.clearCache();
    UI.setRefreshing(true);
    usingFallback = false;
    const watchlist = loadWatchlist();
    const wSymbols = watchlist.map(w => w.symbol);
    const holdingSymbols = PortfolioService.getHoldings().map(h => h.symbol);
    const allQuoteSymbols = [...new Set([...wSymbols, ...holdingSymbols])];
    const expectedQuotes = CONFIG.INDEXES.length + wSymbols.length;
    let quotesForPortfolio = [];
    let indexFreshness = indexData.filter(x => DataService.isFreshRecord(x, x.region));
    let quoteFreshness = watchlistQuotes.filter(x => DataService.isFreshRecord(x));
    const currentFreshness = () => [...indexFreshness, ...quoteFreshness];
    const publishStatus = () => {
      if (generation !== refreshGeneration) return;
      const freshness = currentFreshness();
      const sourceTimes = freshness
        .map(x => typeof x.asOf === 'string' ? Date.parse(x.asOf) : Number(x.asOf))
        .filter(Number.isFinite);
      const regionalTimes = sourceTimesByRegion(freshness);
      UI.setDataStatus({
        fresh: freshness.length,
        total: expectedQuotes,
        oldestAsOf: sourceTimes.length ? Math.min(...sourceTimes) : null,
        ...regionalTimes,
        mode: freshness.some(x => x.deliveryMode === 'cache') ? 'cache' : 'live',
        indicative: freshness.filter(x => x.priceType === 'indicative').length,
      });
    };
    const statusDeadline = setTimeout(() => {
      if (generation === refreshGeneration) publishStatus();
    }, 12000);

    try {
      try {
        // Indexes and quotes are independent. Run both paths together so a slow
        // proxy cannot block the rest of the dashboard from updating.
        const indexTask = (async () => {
          const indexes = await DataService.fetchIndexes();
          if (generation !== refreshGeneration) return;
          if (!indexes) return;
          indexData = indexes;
          UI.renderIndexCards(indexes);
          indexFreshness = indexes.filter(x => DataService.isFreshRecord(x, x.region));
          publishStatus();

          // Index charts are best-effort and never block quote freshness.
          DataService.fetchIndexSeries(CONFIG.INDEXES).then(series => {
            if (generation === refreshGeneration) UI.renderIndexSparklines(series);
          });
        })();

        const quoteTask = (async () => {
          const quotes = allQuoteSymbols.length > 0
            ? await DataService.fetchAllQuotes(allQuoteSymbols) || []
            : [];
          if (generation !== refreshGeneration) return;
          quotesForPortfolio = quotes;
          quoteFreshness = quotes.filter(q => wSymbols.includes(q.symbol) && DataService.isFreshRecord(q));
          const watchData = watchlist.map(w => {
            const q = quotes.find(item => item.symbol === w.symbol);
            return {
              ...w,
              price: q?.price,
              change: q?.change,
              changePct: q?.changePct,
              currency: q?.currency,
              asOf: q?.asOf,
              source: q?.source,
              priceType: q?.priceType,
              deliveryMode: q?.deliveryMode,
              region: w.region || (w.symbol.endsWith('.TW') ? 'TW' : 'US'),
            };
          });
          watchlistQuotes = watchData;
          window._watchlistQuotes = watchData;
          UI.renderWatchlist(watchData);
          UI.renderFeatured();
          UI.renderTicker(watchData);
          publishStatus();

          if (quotes.length > 0) {
            DataService.fetchSparklines(wSymbols).then(sparkData => {
              if (generation === refreshGeneration) {
                UI.renderWatchlist(watchData, sparkData);
                UI.renderFeatured();
              }
            });
          }
        })();

        updateNews(forceRefresh, generation);
        const outcomes = await Promise.allSettled([indexTask, quoteTask]);
        outcomes.filter(outcome => outcome.status === 'rejected').forEach(outcome => {
          console.error('Market data task failed:', outcome.reason);
        });
        if (generation !== refreshGeneration) return false;

        // 3. Portfolio stats
        await updatePortfolio(quotesForPortfolio, generation);
        if (generation !== refreshGeneration) return false;

        // 4. Technical indicators - load on demand via HTML button
      } catch (e) {
        console.error('Data fetch error:', e);
        UI.showToast('資料擷取異常，顯示備用數據', 'warn');
      }

      if (generation !== refreshGeneration) return false;
      publishStatus();
      return currentFreshness().length > 0;
    } finally {
      clearTimeout(statusDeadline);
      UI.setRefreshing(false);
      refreshInFlight = false;
      if (pendingForceRefresh) {
        pendingForceRefresh = false;
        queueMicrotask(() => fetchAllData(true));
      }
    }
  }


  // ═══════════════════════════════════════
  // STATIC FALLBACK — loads data/*.json if live APIs fail
  // ═══════════════════════════════════════
  async function loadStaticFallback(expectedGeneration = refreshGeneration) {
    try {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const [idxResp, qResp, nResp] = await Promise.all([
        fetch(`data/indexes.json?_wr=${requestId}`, { cache:'no-store', signal: requestTimeoutSignal(3000) }).catch(() => null),
        fetch(`data/quotes.json?_wr=${requestId}`, { cache:'no-store', signal: requestTimeoutSignal(3000) }).catch(() => null),
        fetch(`data/news.json?_wr=${requestId}`, { cache:'no-store', signal: requestTimeoutSignal(3000) }).catch(() => null),
      ]);
      if ((!idxResp || !idxResp.ok) && (!qResp || !qResp.ok)) return false;

      const rawIdxEnvelope = idxResp?.ok ? await idxResp.json() : null;
      const rawQEnvelope = qResp?.ok ? await qResp.json() : null;
      let rawNewsEnvelope = null;
      if (nResp?.ok) {
        try { rawNewsEnvelope = await nResp.json(); } catch(e) {}
      }
      const idxEnvelope = isFreshEnvelope(rawIdxEnvelope) ? rawIdxEnvelope : null;
      const qEnvelope = isFreshEnvelope(rawQEnvelope) ? rawQEnvelope : null;
      const newsEnvelope = isFreshEnvelope(rawNewsEnvelope) ? rawNewsEnvelope : null;
      const rawIndexes = Array.isArray(idxEnvelope?.data) ? idxEnvelope.data : [];
      const rawQuotes = Array.isArray(qEnvelope?.data) ? qEnvelope.data : [];
      const indexes = CONFIG.INDEXES.map(cfg => {
        const item = rawIndexes.find(x => x.id === cfg.id);
        return item && DataService.isFreshRecord(item, cfg.region)
          ? { ...cfg, ...item, deliveryMode:'cache' }
          : { ...cfg, unavailable:true };
      });
      const quotes = rawQuotes
        .filter(q => DataService.isFreshRecord(q))
        .map(q => ({ ...q, deliveryMode:'cache' }));
      if (expectedGeneration !== refreshGeneration || refreshInFlight) return false;
      DataService.rememberRecords([
        ...indexes.filter(x => DataService.isFreshRecord(x, x.region)),
        ...quotes,
      ]);
      const news = Array.isArray(newsEnvelope?.data) ? newsEnvelope.data : null;
      
      if (indexes.length > 0) {
        indexData = indexes;
        UI.renderIndexCards(indexes);
      }
      {
        const watchlist = loadWatchlist();
        const watchData = watchlist.map(w => {
          const q = quotes.find(q => q.symbol === w.symbol);
          return { ...w, price: q?.price, change: q?.change, changePct: q?.changePct, asOf:q?.asOf, source:q?.source, priceType:q?.priceType, deliveryMode:q?.deliveryMode, currency: w.symbol.endsWith('.TW') ? 'TWD' : 'USD', region: w.region || (w.symbol.endsWith('.TW') ? 'TW' : 'US') };
        });
        watchlistQuotes = watchData;
        window._watchlistQuotes = watchData;
        UI.renderWatchlist(watchData);
        UI.renderFeatured();
        UI.renderTicker(watchData);
        await updatePortfolio(quotes, expectedGeneration);
      }
      if (expectedGeneration !== refreshGeneration || refreshInFlight) return false;
      UI.renderNews(news || []);
      
      const watchlist = loadWatchlist();
      const watchlistSymbols = new Set(watchlist.map(w => w.symbol));
      const freshItems = [
        ...indexes.filter(x => DataService.isFreshRecord(x, x.region)),
        ...quotes.filter(q => watchlistSymbols.has(q.symbol)),
      ];
      const sourceTimes = freshItems.map(x => typeof x.asOf === 'string' ? Date.parse(x.asOf) : Number(x.asOf)).filter(Number.isFinite);
      const regionalTimes = sourceTimesByRegion(freshItems);
      UI.setDataStatus({
        fresh: freshItems.length,
        total: CONFIG.INDEXES.length + watchlist.length,
        oldestAsOf: sourceTimes.length ? Math.min(...sourceTimes) : null,
        ...regionalTimes,
        mode: 'cache',
        indicative: freshItems.filter(x => x.priceType === 'indicative').length,
      });
      return freshItems.length > 0;
    } catch(e) { return false; }
  }

  // ═══════════════════════════════════════
  // PORTFOLIO
  // ═══════════════════════════════════════
  async function updatePortfolio(preloadedQuotes = null, expectedRefreshGeneration = refreshGeneration) {
    const requestGeneration = ++portfolioGeneration;
    const holdings = PortfolioService.getHoldings();
    if (!holdings.length) {
      // Show empty portfolio state
      if (requestGeneration === portfolioGeneration && expectedRefreshGeneration === refreshGeneration) {
        UI.renderPortfolio({ holdings: [], totalValue: 0, totalCost: 0, totalPnl: 0, returnPct: 0 });
      }
      return false;
    }

    try {
      // Build quotes map from existing watchlist data and any additional symbols
      const allSymbols = [...new Set([
        ...holdings.map(h => h.symbol),
        ...watchlistQuotes.map(q => q.symbol),
      ])];

      const quotes = Array.isArray(preloadedQuotes)
        ? preloadedQuotes
        : await DataService.fetchAllQuotes(allSymbols);
      if (requestGeneration !== portfolioGeneration || expectedRefreshGeneration !== refreshGeneration) return false;
      const quotesMap = {};
      if (quotes) quotes.forEach(q => { quotesMap[q.symbol] = q; });

      const stats = PortfolioService.calculateStats(holdings, quotesMap);
      UI.renderPortfolio(stats);
      return true;
    } catch (e) {
      console.warn('Portfolio update failed:', e);
      if (requestGeneration !== portfolioGeneration || expectedRefreshGeneration !== refreshGeneration) return false;
      const stats = PortfolioService.calculateStats(holdings, {});
      UI.renderPortfolio(stats);
      return false;
    }
  }

  // ═══════════════════════════════════════
  // INDICATORS
  // ═══════════════════════════════════════
  async function updateIndicators(symbol) {
    const quote = await DataService.fetchQuote(symbol);
    const currentPrice = quote?.price;

    const result = await IndicatorsService.calculateFor(symbol, currentPrice);
    if (result && !result.error) {
      UI.renderIndicators(result);
    } else {
      const msg = result?.error || '未知錯誤';
      document.getElementById("ind-grid").innerHTML = '<div class="ind-cell" style="grid-column:1/-1;text-align:center;color:var(--warn);padding:24px">⚠ 無法載入技術指標<br><small>' + msg + '</small><br><button onclick="App.updateIndicators(\'0050.TW\')" style="margin-top:8px;background:rgba(255,119,68,0.12);border:1px solid var(--arc);color:var(--arc);padding:4px 16px;font-family:inherit;font-size:11px;cursor:pointer">🔄 重試</button></div>';
    }
  }

  // ═══════════════════════════════════════
  // NEWS
  // ═══════════════════════════════════════
  async function updateNews(forceRefresh = false, expectedRefreshGeneration = refreshGeneration) {
    const requestGeneration = ++newsGeneration;
    const news = await NewsService.getNews(forceRefresh);
    if (requestGeneration !== newsGeneration || expectedRefreshGeneration !== refreshGeneration) return false;
    UI.renderNews(news);
    return true;
  }

  // ═══════════════════════════════════════
  // WATCHLIST MANAGEMENT
  // ═══════════════════════════════════════
  const WATCHLIST_KEY = 'warroom_watchlist';
  const WATCHLIST_VERSION = 3; // bump to force reorder

  function loadWatchlist() {
    try {
      const verKey = WATCHLIST_KEY + '_ver';
      const savedVer = parseInt(localStorage.getItem(verKey)) || 0;
      const raw = localStorage.getItem(WATCHLIST_KEY);
      
      if (raw && savedVer >= WATCHLIST_VERSION) {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
          // Auto-migrate: add any new defaults not in saved list
          const savedSymbols = new Set(data.map(w => w.symbol));
          const defaults = CONFIG.DEFAULT_WATCHLIST;
          let changed = false;
          defaults.forEach(d => {
            if (!savedSymbols.has(d.symbol)) {
              data.push({...d});
              changed = true;
            }
          });
          if (changed) { saveWatchlist(data); localStorage.setItem(verKey, WATCHLIST_VERSION); }
          return data;
        }
      }
    } catch (e) { /* use defaults */ }
    // Fresh load from defaults
    const defaults = JSON.parse(JSON.stringify(CONFIG.DEFAULT_WATCHLIST));
    saveWatchlist(defaults);
    localStorage.setItem(WATCHLIST_KEY + '_ver', WATCHLIST_VERSION);
    return defaults;
  }

  function saveWatchlist(watchlist) {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }

  // ═══════════════════════════════════════
  // PORTFOLIO CRUD (exposed for onclick)
  // ═══════════════════════════════════════
  function deleteHolding(symbol) {
    const result = PortfolioService.deleteHolding(symbol);
    if (result.ok) {
      UI.showToast(result.msg, 'success');
      updatePortfolio();
    } else {
      UI.showToast(result.msg, 'error');
    }
  }

  function showAddModal() {
    UI.showAddHoldingModal();
  }

  // ═══════════════════════════════════════
  // PRICE FLICKER EFFECT
  // ═══════════════════════════════════════
  function startPriceFlicker() {
    setInterval(() => {
      const els = document.querySelectorAll('.idx-price,.w-price');
      if (els.length === 0) return;
      const el = els[Math.floor(Math.random() * els.length)];
      el.style.opacity = '.25';
      setTimeout(() => el.style.opacity = '1', 90);
    }, 2800);
  }

  // ═══════════════════════════════════════
  // AUTO REFRESH
  // ═══════════════════════════════════════
  function startAutoRefresh() {
    setInterval(() => fetchAllData(false), CONFIG.REFRESH_QUOTES);
    setInterval(updateMarketStatus, 30000);
  }

  // ═══════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════
  function renderStartupShell() {
    const watchlist = loadWatchlist();
    const watchData = watchlist.map(w => ({
      ...w,
      price: undefined,
      change: undefined,
      changePct: undefined,
      region: w.region || (w.symbol.endsWith('.TW') ? 'TW' : 'US'),
    }));

    indexData = CONFIG.INDEXES.map(index => ({ ...index, unavailable: true }));
    watchlistQuotes = watchData;
    window._watchlistQuotes = watchData;
    UI.renderIndexCards(indexData);
    UI.renderIndexSparklines({});
    UI.renderWatchlist(watchData);
    UI.renderFeatured();
    UI.renderTicker(watchData);
    updatePortfolio([], refreshGeneration);
    UI.renderNews([]);
    UI.setDataStatus({ fresh: 0, total: CONFIG.INDEXES.length + watchlist.length });
  }

  async function init() {
    updateClock();
    updateMarketStatus();
    renderStartupShell();

    // Static snapshots are only accepted when both the envelope and individual
    // market records are fresh. The shell above remains usable if they are not.
    const startupGeneration = refreshGeneration;
    const staticOk = await loadStaticFallback(startupGeneration);
    setTimeout(() => {
      if (refreshGeneration === startupGeneration && !refreshInFlight) {
        fetchAllData(!staticOk);
      }
    }, staticOk ? 500 : 0);

    // Start periodic refresh
    startAutoRefresh();

    // Clock tick
    setInterval(updateClock, 1000);



    console.log('J.A.R.V.I.S WARROOM v3.2 · SYSTEM ONLINE');
  }

  // ═══════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════
  return {
    init,
    refresh: () => fetchAllData(true),
    deleteHolding,
    showAddModal,
    updateIndicators,
  };
})();

// ── Expose to window for onclick handlers ──
window.App = App;

// ── Auto-start when DOM is ready ──
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
