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

    if (isWeekday(twTime) && twMinutes >= 540 && twMinutes <= 810) {
      if (twOrb) twOrb.className = 'status-orb live';
      if (twLabel) twLabel.textContent = 'TW OPEN';
    } else {
      if (twOrb) twOrb.className = 'status-orb off';
      if (twLabel) twLabel.textContent = 'TW CLOSED';
    }

    const isPreMarket = isWeekday(usTime) && usMinutes >= 240 && usMinutes < 570;
    const isMarketOpen = isWeekday(usTime) && usMinutes >= 570 && usMinutes <= 960;

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

  // ═══════════════════════════════════════
  // DATA FETCHING
  // ═══════════════════════════════════════
  async function fetchAllData(forceRefresh = false) {
    if (refreshInFlight) return false;
    refreshInFlight = true;
    if (forceRefresh) DataService.clearCache();
    UI.setRefreshing(true);
    usingFallback = false;
    const freshness = [];
    let expectedQuotes = CONFIG.INDEXES.length;

    try {
      // 1. Fetch indexes (stale values are rejected by DataService)
      const indexes = await DataService.fetchIndexes();
      if (indexes) {
        indexData = indexes;
        UI.renderIndexCards(indexes);
        freshness.push(...indexes.filter(x => DataService.isFreshRecord(x, x.region)));
      }

      // 2. Fetch watchlist quotes (hybrid: MIS for TW, Yahoo for US)
      const watchlist = loadWatchlist();
      const wSymbols = watchlist.map(w => w.symbol);
      expectedQuotes += wSymbols.length;
      if (wSymbols.length > 0) {
        const quotes = await DataService.fetchAllQuotes(wSymbols) || [];
        freshness.push(...quotes.filter(x => DataService.isFreshRecord(x)));
        const watchData = watchlist.map(w => {
          const q = quotes.find(q => q.symbol === w.symbol);
          return {
            ...w,
            price: q?.price,
            change: q?.change,
            changePct: q?.changePct,
            currency: q?.currency,
            asOf: q?.asOf,
            source: q?.source,
            priceType: q?.priceType,
            region: w.region || (w.symbol.endsWith('.TW') ? 'TW' : 'US'),
          };
        });
        watchlistQuotes = watchData;
        window._watchlistQuotes = watchData;
        UI.renderWatchlist(watchData);
        UI.renderFeatured();
        UI.renderTicker(watchData);

        if (quotes.length > 0) {
          // Fetch sparklines for watchlist (non-blocking)
          DataService.fetchSparklines(wSymbols).then(sparkData => {
            UI.renderWatchlist(watchData, sparkData);
            UI.renderFeatured();
          });
        }
      }

      // 3. Portfolio stats
      await updatePortfolio();

      // 4. Technical indicators - load on demand via HTML button

      // 5. News
      updateNews(forceRefresh);

    } catch (e) {
      console.error('Data fetch error:', e);
      UI.showToast('資料擷取異常，顯示備用數據', 'warn');
    }

    UI.setRefreshing(false);
    const sourceTimes = freshness.map(x => typeof x.asOf === 'string' ? Date.parse(x.asOf) : Number(x.asOf)).filter(Number.isFinite);
    const regionalTimes = sourceTimesByRegion(freshness);
    UI.setDataStatus({
      fresh: freshness.length,
      total: expectedQuotes,
      oldestAsOf: sourceTimes.length ? Math.min(...sourceTimes) : null,
      ...regionalTimes,
      mode: 'live',
      indicative: freshness.filter(x => x.priceType === 'indicative').length,
    });
    refreshInFlight = false;
    return freshness.length > 0;
  }


  // ═══════════════════════════════════════
  // STATIC FALLBACK — loads data/*.json if live APIs fail
  // ═══════════════════════════════════════
  async function loadStaticFallback() {
    try {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const [idxResp, qResp, nResp] = await Promise.all([
        fetch(`data/indexes.json?_wr=${requestId}`, { cache:'no-store', signal: AbortSignal.timeout(3000) }).catch(() => null),
        fetch(`data/quotes.json?_wr=${requestId}`, { cache:'no-store', signal: AbortSignal.timeout(3000) }).catch(() => null),
        fetch(`data/news.json?_wr=${requestId}`, { cache:'no-store', signal: AbortSignal.timeout(3000) }).catch(() => null),
      ]);
      if ((!idxResp || !idxResp.ok) && (!qResp || !qResp.ok)) return false;

      const idxEnvelope = idxResp?.ok ? await idxResp.json() : null;
      const qEnvelope = qResp?.ok ? await qResp.json() : null;
      const rawIndexes = Array.isArray(idxEnvelope?.data) ? idxEnvelope.data : [];
      const rawQuotes = Array.isArray(qEnvelope?.data) ? qEnvelope.data : [];
      const indexes = CONFIG.INDEXES.map(cfg => {
        const item = rawIndexes.find(x => x.id === cfg.id);
        return item && DataService.isFreshRecord(item, cfg.region)
          ? { ...cfg, ...item }
          : { ...cfg, unavailable:true };
      });
      const quotes = rawQuotes.filter(q => DataService.isFreshRecord(q));
      let news = null;
      if (nResp && nResp.ok) {
        try { news = (await nResp.json()).data; } catch(e) {}
      }
      
      if (indexes.length > 0) {
        indexData = indexes;
        UI.renderIndexCards(indexes);
      }
      {
        const watchlist = loadWatchlist();
        const watchData = watchlist.map(w => {
          const q = quotes.find(q => q.symbol === w.symbol);
          return { ...w, price: q?.price, change: q?.change, changePct: q?.changePct, asOf:q?.asOf, source:q?.source, priceType:q?.priceType, currency: w.symbol.endsWith('.TW') ? 'TWD' : 'USD', region: w.region || (w.symbol.endsWith('.TW') ? 'TW' : 'US') };
        });
        watchlistQuotes = watchData;
        window._watchlistQuotes = watchData;
        UI.renderWatchlist(watchData);
        UI.renderFeatured();
        UI.renderTicker(watchData);
        await updatePortfolio(quotes);
      }
      if (news && news.length > 0) {
        UI.renderNews(news);
      }
      
      const freshItems = [...indexes.filter(x => DataService.isFreshRecord(x, x.region)), ...quotes];
      const sourceTimes = freshItems.map(x => typeof x.asOf === 'string' ? Date.parse(x.asOf) : Number(x.asOf)).filter(Number.isFinite);
      const regionalTimes = sourceTimesByRegion(freshItems);
      UI.setDataStatus({
        fresh: freshItems.length,
        total: CONFIG.INDEXES.length + loadWatchlist().length,
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
  async function updatePortfolio(preloadedQuotes = null) {
    const holdings = PortfolioService.getHoldings();
    if (!holdings.length) {
      // Show empty portfolio state
      UI.renderPortfolio({ holdings: [], totalValue: 0, totalCost: 0, totalPnl: 0, returnPct: 0 });
      return;
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
      const quotesMap = {};
      if (quotes) quotes.forEach(q => { quotesMap[q.symbol] = q; });

      const stats = PortfolioService.calculateStats(holdings, quotesMap);
      UI.renderPortfolio(stats);
    } catch (e) {
      console.warn('Portfolio update failed:', e);
      const stats = PortfolioService.calculateStats(holdings, {});
      UI.renderPortfolio(stats);
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
  async function updateNews(forceRefresh = false) {
    const news = await NewsService.getNews(forceRefresh);
    UI.renderNews(news);
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
  async function init() {
    updateClock();
    updateMarketStatus();
    startPriceFlicker();

    // ⚡ Load static data instantly (no waiting)
    const staticOk = await loadStaticFallback();
    
    // Then try live data in background (non-blocking)
    if (staticOk) {
      // Already showing data — just refresh in background
      setTimeout(() => fetchAllData(false), 500);
    } else {
      // No static data, must wait for live
      const liveTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
      try { await Promise.race([fetchAllData(true), liveTimeout]); } catch(e) {}
    }

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
