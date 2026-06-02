// ═══════════════════════════════════════
// J.A.R.V.I.S · MAIN APPLICATION v3.1
// Orchestrates all modules
// ═══════════════════════════════════════

const App = (() => {

  // ── State ──
  let watchlistQuotes = [];
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
          UI.renderTicker(watchData);
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
    if (result) {
      UI.renderIndicators(result);
    } else {
      document.getElementById("ind-grid").innerHTML = '<div class="ind-cell" style="text-align:center;color:var(--warn);padding:24px">⚠ 無法載入技術指標<br><small>確認網路連線後重整頁面</small></div>';
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
        if (Array.isArray(data) && data.length > 0) return data;
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

    // Initial data fetch
    await fetchAllData(true);

    // Start periodic refresh
    startAutoRefresh();

    // Clock tick
    setInterval(updateClock, 1000);



    console.log('J.A.R.V.I.S WARROOM v3.1 · SYSTEM ONLINE');
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
