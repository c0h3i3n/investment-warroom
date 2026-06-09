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
    const h = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei', hour: 'numeric', hour12: false,
    }).format(now));
    const t = h * 60 + now.getMinutes();

    const twOrb = document.getElementById('twOrb');
    const twLabel = document.getElementById('twLabel');
    const usOrb = document.getElementById('usOrb');
    const usLabel = document.getElementById('usLabel');

    if (t >= CONFIG.TW_OPEN && t <= CONFIG.TW_CLOSE) {
      if (twOrb) twOrb.className = 'status-orb live';
      if (twLabel) twLabel.textContent = 'TW OPEN';
    } else {
      if (twOrb) twOrb.className = 'status-orb off';
      if (twLabel) twLabel.textContent = 'TW CLOSED';
    }

    const usOpen = CONFIG.US_OPEN;
    const usClose = CONFIG.US_CLOSE + 24 * 60;
    const tWrap = t < usOpen ? t + 24 * 60 : t;
    const isPreMarket = (t >= CONFIG.US_PRE && t < CONFIG.US_OPEN);
    const isMarketOpen = (tWrap >= usOpen && tWrap <= usClose);

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

  // ═══════════════════════════════════════
  // DATA FETCHING
  // ═══════════════════════════════════════
  async function fetchAllData(forceRefresh = false) {
    if (forceRefresh) DataService.clearCache();
    UI.setRefreshing(true);
    usingFallback = false;

    try {
      // 1. Fetch indexes (MIS for TW, Yahoo for US, fallback built-in)
      const indexes = await DataService.fetchIndexes();
      if (indexes) {
        indexData = indexes;
        UI.renderIndexCards(indexes);
      }

      // 2. Fetch watchlist quotes (hybrid: MIS for TW, Yahoo for US)
      const watchlist = loadWatchlist();
      const wSymbols = watchlist.map(w => w.symbol);
      if (wSymbols.length > 0) {
        const quotes = await DataService.fetchAllQuotes(wSymbols);
        if (quotes) {
          watchlistQuotes = quotes;
          window._watchlistQuotes = quotes;
          const watchData = watchlist.map(w => {
            const q = quotes.find(q => q.symbol === w.symbol);
            return {
              ...w,
              price: q?.price,
              change: q?.change,
              changePct: q?.changePct,
              currency: q?.currency,
              region: w.region || (w.symbol.endsWith('.TW') ? 'TW' : 'US'),
            };
          });
          UI.renderWatchlist(watchData);
          UI.renderFeatured();
          UI.renderTicker(watchData);

          // Fetch sparklines for watchlist (non-blocking)
          DataService.fetchSparklines(wSymbols).then(sparkData => {
            UI.renderWatchlist(watchData, sparkData);
            UI.renderFeatured();
          });
        }
      }

      // 3. Portfolio stats
      updatePortfolio();

      // 4. Technical indicators - load on demand via HTML button

      // 5. News
      updateNews(forceRefresh);

    } catch (e) {
      console.error('Data fetch error:', e);
      UI.showToast('資料擷取異常，顯示備用數據', 'warn');
    }

    UI.setRefreshing(false);
  }


  // ═══════════════════════════════════════
  // STATIC FALLBACK — loads data/*.json if live APIs fail
  // ═══════════════════════════════════════
  async function loadStaticFallback() {
    try {
      const [idxResp, qResp, nResp] = await Promise.all([
        fetch('data/indexes.json', { signal: AbortSignal.timeout(3000) }),
        fetch('data/quotes.json', { signal: AbortSignal.timeout(3000) }),
        fetch('data/news.json', { signal: AbortSignal.timeout(3000) }).catch(() => null),
      ]);
      if (!idxResp.ok && !qResp.ok) return false;
      
      const indexes = idxResp.ok ? (await idxResp.json()).data : null;
      const quotes = qResp.ok ? (await qResp.json()).data : null;
      let news = null;
      if (nResp && nResp.ok) {
        try { news = (await nResp.json()).data; } catch(e) {}
      }
      
      if (indexes && indexes.length > 0) {
        indexData = indexes;
        UI.renderIndexCards(indexes);
      }
      if (quotes && quotes.length > 0) {
        const watchlist = loadWatchlist();
        const watchData = watchlist.map(w => {
          const q = quotes.find(q => q.symbol === w.symbol);
          return { ...w, price: q?.price, change: q?.change, changePct: q?.changePct, currency: w.symbol.endsWith('.TW') ? 'TWD' : 'USD', region: w.region || (w.symbol.endsWith('.TW') ? 'TW' : 'US') };
        });
        watchlistQuotes = watchData;
        UI.renderWatchlist(watchData);
        UI.renderFeatured();
        UI.renderTicker(watchData);
        updatePortfolio(quotes);
      }
      if (news && news.length > 0) {
        UI.renderNews(news);
      }
      
      const ts = indexes?.timestamp || quotes?.timestamp;
      if (ts) {
        document.getElementById('last-updated').textContent = 
          'CACHED ' + new Date(ts).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false });
      }
      return true;
    } catch(e) { return false; }
  }

  // ═══════════════════════════════════════
  // PORTFOLIO
  // ═══════════════════════════════════════
  async function updatePortfolio() {
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

      const quotes = await DataService.fetchAllQuotes(allSymbols);
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

  function loadWatchlist() {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
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
          if (changed) saveWatchlist(data);
          return data;
        }
      }
    } catch (e) { /* use defaults */ }
    const defaults = JSON.parse(JSON.stringify(CONFIG.DEFAULT_WATCHLIST));
    saveWatchlist(defaults);
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
