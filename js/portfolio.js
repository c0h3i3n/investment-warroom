// ═══════════════════════════════════════
// J.A.R.V.I.S · PORTFOLIO TRACKER
// localStorage CRUD for holdings
// ═══════════════════════════════════════

const PortfolioService = (() => {

  const STORAGE_KEY = 'warroom_portfolio';
  const PORTFOLIO_VERSION = 3;

  // ── Load holdings from localStorage ──
  function loadHoldings() {
    try {
      const verKey = STORAGE_KEY + '_ver';
      const savedVer = parseInt(localStorage.getItem(verKey)) || 0;
      const raw = localStorage.getItem(STORAGE_KEY);
      
      if (raw && savedVer >= PORTFOLIO_VERSION) {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
          const savedSymbols = new Set(data.map(h => h.symbol));
          const defaults = CONFIG.DEFAULT_HOLDINGS;
          let changed = false;
          defaults.forEach(d => {
            if (!savedSymbols.has(d.symbol)) {
              data.push({...d});
              changed = true;
            }
          });
          if (changed) { saveHoldings(data); localStorage.setItem(verKey, PORTFOLIO_VERSION); }
          return data;
        }
      }
    } catch (e) {
      console.error('Failed to load portfolio:', e);
    }
    const defaults = JSON.parse(JSON.stringify(CONFIG.DEFAULT_HOLDINGS));
    saveHoldings(defaults);
    localStorage.setItem(STORAGE_KEY + '_ver', PORTFOLIO_VERSION);
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
    let unavailableCount = 0;
    let hasIndicative = false;
    const activeCurrencies = new Set();
    const enriched = holdings.map(h => {
      const quote = quotesMap[h.symbol];
      const hasPrice = Number.isFinite(Number(quote?.price)) && Number(quote.price) > 0;
      const price = hasPrice ? Number(quote.price) : null;
      const value = hasPrice ? price * h.shares : null;
      const costBasis = h.cost * h.shares;
      const pnl = hasPrice ? value - costBasis : null;
      const pnlPct = hasPrice && costBasis > 0 ? ((pnl / costBasis) * 100) : null;

      if (hasPrice) {
        totalValue += value;
        totalCost += costBasis;
        if (Number(h.shares) > 0) {
          activeCurrencies.add(quote?.currency || (h.region === 'TW' ? 'TWD' : 'USD'));
          if (quote?.priceType === 'indicative') hasIndicative = true;
        }
      } else if (Number(h.shares) > 0) {
        unavailableCount += 1;
      }

      return {
        ...h,
        price,
        value,
        pnl,
        pnlPct,
        currency: quote?.currency || (h.region === 'TW' ? 'TWD' : 'USD'),
        priceType: quote?.priceType,
        unavailable: !hasPrice,
      };
    });

    const mixedCurrency = activeCurrencies.size > 1;
    const totalCurrency = mixedCurrency ? 'MIX' : activeCurrencies.values().next().value || 'TWD';
    const totalPnl = mixedCurrency ? null : totalValue - totalCost;
    const returnPct = mixedCurrency ? null : totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;

    return {
      holdings: enriched,
      totalValue: mixedCurrency ? null : totalValue,
      totalCost: mixedCurrency ? null : totalCost,
      totalPnl,
      returnPct,
      unavailableCount,
      mixedCurrency,
      hasIndicative,
      currency: totalCurrency,
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
