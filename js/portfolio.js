// ═══════════════════════════════════════
// J.A.R.V.I.S · PORTFOLIO TRACKER
// localStorage CRUD for holdings
// ═══════════════════════════════════════

const PortfolioService = (() => {

  const STORAGE_KEY = 'warroom_portfolio';

  // ── Load holdings from localStorage ──
  function loadHoldings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch (e) {
      console.error('Failed to load portfolio:', e);
    }
    // Use defaults
    const defaults = JSON.parse(JSON.stringify(CONFIG.DEFAULT_HOLDINGS));
    saveHoldings(defaults);
    return defaults;
  }

  // ── Save holdings to localStorage ──
  function saveHoldings(holdings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    } catch (e) {
      console.error('Failed to save portfolio:', e);
    }
  }

  // ── Add a new holding ──
  function addHolding(holding) {
    const holdings = loadHoldings();
    // Check duplicate
    const exists = holdings.find(h => h.symbol === holding.symbol);
    if (exists) return { ok: false, msg: `${holding.symbol} 已存在於投資組合中` };

    holdings.push({
      symbol: holding.symbol,
      name: holding.name,
      shares: Number(holding.shares),
      cost: Number(holding.cost),
      region: holding.region || (holding.symbol.endsWith('.TW') ? 'TW' : 'US'),
    });
    saveHoldings(holdings);
    return { ok: true, msg: `${holding.symbol} 已加入投資組合` };
  }

  // ── Edit an existing holding ──
  function editHolding(symbol, updates) {
    const holdings = loadHoldings();
    const idx = holdings.findIndex(h => h.symbol === symbol);
    if (idx === -1) return { ok: false, msg: `找不到 ${symbol}` };

    if (updates.shares !== undefined) holdings[idx].shares = Number(updates.shares);
    if (updates.cost !== undefined) holdings[idx].cost = Number(updates.cost);
    if (updates.name !== undefined) holdings[idx].name = updates.name;
    saveHoldings(holdings);
    return { ok: true, msg: `${symbol} 已更新` };
  }

  // ── Delete a holding ──
  function deleteHolding(symbol) {
    const holdings = loadHoldings();
    const filtered = holdings.filter(h => h.symbol !== symbol);
    if (filtered.length === holdings.length) {
      return { ok: false, msg: `找不到 ${symbol}` };
    }
    saveHoldings(filtered);
    return { ok: true, msg: `${symbol} 已從投資組合移除` };
  }

  // ── Get all holdings ──
  function getHoldings() {
    return loadHoldings();
  }

  // ── Calculate portfolio stats against live prices ──
  function calculateStats(holdings, quotesMap) {
    let totalValue = 0;
    let totalCost = 0;
    const enriched = holdings.map(h => {
      const quote = quotesMap[h.symbol];
      const price = quote?.price || h.cost; // fallback to cost if no live data
      const value = price * h.shares;
      const costBasis = h.cost * h.shares;
      const pnl = value - costBasis;
      const pnlPct = costBasis > 0 ? ((pnl / costBasis) * 100) : 0;

      totalValue += value;
      totalCost += costBasis;

      return {
        ...h,
        price,
        value,
        pnl,
        pnlPct,
        currency: quote?.currency || (h.region === 'TW' ? 'TWD' : 'USD'),
      };
    });

    const totalPnl = totalValue - totalCost;
    const returnPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;

    return {
      holdings: enriched,
      totalValue,
      totalCost,
      totalPnl,
      returnPct,
      currency: 'MIX', // mixed currencies
    };
  }

  // ── Format currency ──
  function formatCurrency(value, region) {
    if (region === 'TW') return `NT$${Math.round(value).toLocaleString()}`;
    return `$${value.toFixed(2)}`;
  }

  // ── Public API ──
  return {
    loadHoldings,
    saveHoldings,
    addHolding,
    editHolding,
    deleteHolding,
    getHoldings,
    calculateStats,
    formatCurrency,
  };
})();
