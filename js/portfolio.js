// ═══════════════════════════════════════
// J.A.R.V.I.S · PORTFOLIO TRACKER
// localStorage CRUD for holdings
// ═══════════════════════════════════════

const PortfolioService = (() => {

  const STORAGE_KEY = 'warroom_portfolio';
  const PORTFOLIO_VERSION = 4;

  function normalizeHolding(holding) {
    const symbol = String(holding?.symbol || '').trim().toUpperCase();
    const name = String(holding?.name || '').trim();
    const shares = Number(holding?.shares);
    const cost = Number(holding?.cost);
    if (!/^[A-Z0-9^.-]{1,20}$/.test(symbol) || !name || name.length > 80
      || !Number.isFinite(shares) || shares < 0
      || !Number.isFinite(cost) || cost < 0) return null;
    return { symbol, name, shares, cost,
      region: holding?.region === 'TW' || symbol.endsWith('.TW') ? 'TW' : 'US' };
  }

  // ── Load holdings from localStorage ──
  function loadHoldings() {
    try {
      const verKey = STORAGE_KEY + '_ver';
      const savedVer = parseInt(localStorage.getItem(verKey)) || 0;
      const raw = localStorage.getItem(STORAGE_KEY);
      
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          const normalized = data.map(normalizeHolding).filter(Boolean);
          if (savedVer < PORTFOLIO_VERSION || normalized.length !== data.length) {
            saveHoldings(normalized);
            localStorage.setItem(verKey, PORTFOLIO_VERSION);
          }
          return normalized;
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
      localStorage.setItem(STORAGE_KEY + '_ver', PORTFOLIO_VERSION);
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

    const normalized = normalizeHolding(holding);
    if (!normalized || (normalized.shares > 0 && normalized.cost <= 0)) {
      return { ok: false, msg: '持股資料格式不正確' };
    }
    holdings.push(normalized);
    saveHoldings(holdings);
    return { ok: true, msg: `${holding.symbol} 已加入投資組合` };
  }

  // ── Edit an existing holding ──
  function editHolding(symbol, updates) {
    const holdings = loadHoldings();
    const idx = holdings.findIndex(h => h.symbol === symbol);
    if (idx === -1) return { ok: false, msg: `找不到 ${symbol}` };

    const normalized = normalizeHolding({ ...holdings[idx], ...updates });
    if (!normalized || (normalized.shares > 0 && normalized.cost <= 0)) {
      return { ok: false, msg: '持股資料格式不正確' };
    }
    holdings[idx] = normalized;
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

  function exportBackup() {
    return { schema:'investment-warroom-portfolio', version:1,
      exportedAt:new Date().toISOString(), holdings:loadHoldings() };
  }

  function importBackup(payload) {
    if (payload?.schema !== 'investment-warroom-portfolio' || !Array.isArray(payload.holdings)
      || payload.holdings.length > 100) return { ok:false, msg:'備份檔格式不正確' };
    const normalized = payload.holdings.map(normalizeHolding);
    if (normalized.some(item => !item)) return { ok:false, msg:'備份檔包含無效持股資料' };
    if (new Set(normalized.map(item => item.symbol)).size !== normalized.length) {
      return { ok:false, msg:'備份檔包含重複股票代號' };
    }
    saveHoldings(normalized);
    return { ok:true, msg:`已匯入 ${normalized.length} 筆持股` };
  }

  // ── Calculate portfolio stats against live prices ──
  function calculateStats(holdings, quotesMap) {
    let totalValue = 0;
    let totalCost = 0;
    let unavailableCount = 0;
    let hasIndicative = false;
    const activeCurrencies = new Set();
    const byCurrency = {};
    const enriched = holdings.map(h => {
      const quote = quotesMap[h.symbol];
      const hasPrice = Number.isFinite(Number(quote?.price)) && Number(quote.price) > 0;
      const price = hasPrice ? Number(quote.price) : null;
      const value = hasPrice ? price * h.shares : null;
      const costBasis = h.cost * h.shares;
      const pnl = hasPrice ? value - costBasis : null;
      const pnlPct = hasPrice && costBasis > 0 ? ((pnl / costBasis) * 100) : null;

      const currency = quote?.currency || (h.region === 'TW' ? 'TWD' : 'USD');
      if (Number(h.shares) > 0) {
        activeCurrencies.add(currency);
        byCurrency[currency] ||= { currency, totalValue:0, totalCost:0, totalPnl:0,
          returnPct:0, unavailableCount:0, hasIndicative:false };
      }
      if (hasPrice && Number(h.shares) > 0) {
        totalValue += value;
        totalCost += costBasis;
        byCurrency[currency].totalValue += value;
        byCurrency[currency].totalCost += costBasis;
        byCurrency[currency].totalPnl += pnl;
        if (Number(h.shares) > 0) {
          if (quote?.priceType === 'indicative') hasIndicative = true;
          if (quote?.priceType === 'indicative') byCurrency[currency].hasIndicative = true;
        }
      } else if (Number(h.shares) > 0) {
        unavailableCount += 1;
        byCurrency[currency].unavailableCount += 1;
      }

      return {
        ...h,
        price,
        value,
        pnl,
        pnlPct,
        currency,
        priceType: quote?.priceType,
        source: quote?.source,
        asOf: quote?.asOf,
        unavailable: !hasPrice,
      };
    });

    Object.values(byCurrency).forEach(group => {
      group.returnPct = group.totalCost > 0 ? group.totalPnl / group.totalCost * 100 : 0;
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
      byCurrency,
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
    exportBackup,
    importBackup,
    getHoldings,
    calculateStats,
    formatCurrency,
  };
})();
