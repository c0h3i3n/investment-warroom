// ═══════════════════════════════════════
// J.A.R.V.I.S · UI RENDERING ENGINE
// DOM manipulation and visual updates
// ═══════════════════════════════════════

const UI = (() => {

  // ── Color / class helpers ──
  function chgClass(val) { return val >= 0 ? 'up' : 'dn'; }
  function chgArrow(val) { return val >= 0 ? '▲' : '▼'; }
  function pctStr(val) { return (val >= 0 ? '+' : '') + val.toFixed(2) + '%'; }

  // ── Price Flash Animation ──
  const _prevPrices = {};

  function flashPrice(el, symbol, newPrice) {
    if (!el || newPrice == null) return;
    const old = _prevPrices[symbol];
    _prevPrices[symbol] = newPrice;
    if (old != null && old !== newPrice) {
      el.classList.remove('price-flash-up', 'price-flash-dn');
      void el.offsetWidth; // reflow
      el.classList.add(newPrice > old ? 'price-flash-up' : 'price-flash-dn');
    }
  }



  // ── Regional formatting ──
  function fmtPrice(price, region) {
    if (price == null) return '--';
    return Number(price).toFixed(2);
  }

  function fmtCurrency(price, region) {
    if (price == null) return '--';
    const prefix = region === 'TW' ? 'NT$' : '$';
    return prefix + fmtPrice(price, region);
  }

  // ═══════════════════════════════════════
  // INDEX CARDS
  // ═══════════════════════════════════════
  function renderIndexCards(indexes) {
    const container = document.getElementById('index-cards');
    if (!container) return;

    container.innerHTML = indexes.map((idx, i) => {
      const price = idx.price;
      const changePct = idx.changePct;
      const cls = changePct >= 0 ? 'up' : 'dn';
      const points = generateSparkPoints(30, 100, changePct >= 0);
      const color = cls === 'up' ? '#ff7744' : '#cc1133';
      const gradId = 'sg' + (i + 1);

      return `
      <div class="idx-card">
        <div class="idx-region">${idx.region} · ${idx.region === 'TW' ? '台灣' : '美國'}</div>
        <div class="idx-name">${idx.name}</div>
        <div class="idx-price ${cls}" data-id="${idx.id}">${idx.currency}${fmtPrice(price, idx.region)}</div>
        <div class="idx-change">
          <span class="idx-pct ${cls}">${chgArrow(changePct)} ${Math.abs(changePct || 0).toFixed(2)}%</span>
          <div class="progress-track"><div class="progress-fill ${cls}" style="width:${Math.min(100, Math.abs(changePct || 0) * 15)}%"></div></div>
        </div>
        <svg class="mini-spark" viewBox="0 0 100 30" preserveAspectRatio="none">
          <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity=".35"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient></defs>
          <path fill="url(#${gradId})" d="M0,30 ${points.area} 100,30 Z"/>
          <polyline fill="none" stroke="${color}" stroke-width="1.5" opacity=".9" points="${points.line}"/>
          <circle cx="100" cy="${points.lastY}" r="2" fill="${color}" filter="drop-shadow(0 0 3px ${color})"/>
        </svg>
      </div>`;
    // Flash prices after render
    setTimeout(() => {
      indexes.forEach(idx => {
        const el = document.querySelector(`.idx-card .idx-price[data-id="${idx.id}"]`);
        flashPrice(el, 'idx_'+idx.id, idx.price);
      });
    }, 50);
    }).join('');
  }

  function generateSparkPoints(h, w, uptrend) {
    let y = uptrend ? h * 0.7 : h * 0.3;
    const ptsLine = [];
    const ptsArea = [];
    let lastY = y;
    for (let x = 0; x <= w; x += Math.ceil(w / 10)) {
      y += (uptrend ? -1 : 1) * (Math.random() * 3 + 0.5);
      y = Math.max(2, Math.min(h - 2, y));
      if (x === 0) ptsArea.push(`0,${h}`);
      ptsLine.push(`${x},${y.toFixed(1)}`);
      ptsArea.push(`${x},${y.toFixed(1)}`);
      lastY = y;
    }
    return { line: ptsLine.join(' '), area: ptsArea.join(' '), lastY: lastY.toFixed(1) };
  }

  // ═══════════════════════════════════════
  // TICKER BAR
  // ═══════════════════════════════════════
  function renderTicker(quotes) {
    const container = document.getElementById('ticker-inner');
    if (!container || !quotes || quotes.length === 0) return;

    // Duplicate for seamless scroll
    const items = [...quotes, ...quotes].map(q => {
      const cls = (q.changePct || 0) >= 0 ? 't-up' : 't-dn';
      const arrow = (q.changePct || 0) >= 0 ? '▲' : '▼';
      const sym = q.symbol.replace('.TW', '');
      return `<span class="t-item"><span class="t-sym">${sym}</span><span class="t-price">${q.price ? fmtCurrency(q.price, q.symbol.endsWith('.TW') ? 'TW' : 'US') : '--'}</span><span class="${cls}">${arrow} ${Math.abs(q.changePct || 0).toFixed(2)}%</span></span>`;
    }).join('');

    container.innerHTML = items;
  }

  // ═══════════════════════════════════════
  // PORTFOLIO TABLE
  // ═══════════════════════════════════════
  function renderPortfolio(stats) {
    const tbody = document.getElementById('port-tbody');
    const totalVal = document.getElementById('port-total-val');
    const totalPnl = document.getElementById('port-total-pnl');
    const returnRate = document.getElementById('port-return-rate');

    if (totalVal) totalVal.textContent = `NT$${Math.round(stats.totalValue).toLocaleString()}`;
    if (totalPnl) {
      totalPnl.textContent = (stats.totalPnl >= 0 ? '+' : '') + `NT$${Math.round(stats.totalPnl).toLocaleString()}`;
      totalPnl.className = 'ps-value ' + chgClass(stats.totalPnl);
    }
    if (returnRate) {
      returnRate.textContent = pctStr(stats.returnPct);
      returnRate.className = 'ps-value ' + chgClass(stats.returnPct);
    }

    if (!tbody) return;

    tbody.innerHTML = stats.holdings.map(h => {
      const cls = chgClass(h.pnlPct);
      const barW = Math.min(100, Math.abs(h.pnlPct) * 2.5);
      const arrow = chgArrow(h.pnlPct);
      return `
      <tr>
        <td><span class="pt-ticker">${h.symbol.replace('.TW', '')}</span></td>
        <td>${h.name}</td>
        <td>${fmtCurrency(h.cost, h.region)}</td>
        <td style="color:${cls === 'up' ? 'var(--pos)' : 'var(--neg)'}">${fmtCurrency(h.price, h.region)}</td>
        <td>
          <div class="pnl-wrap">
            <div class="pnl-bar"><div class="pnl-fill ${cls}" style="width:${barW}%"></div></div>
            <span style="color:${cls === 'up' ? 'var(--pos)' : 'var(--neg)'};font-family:'Orbitron',sans-serif;font-size:10px">${arrow} ${Math.abs(h.pnlPct).toFixed(2)}%</span>
          </div>
        </td>
        <td class="delete-col">
          <button class="btn danger small" onclick="App.deleteHolding('${h.symbol}')" title="移除">✕</button>
        </td>
      </tr>`;
    }).join('');

    // Add "add row" at bottom
    if (stats.holdings.length < 10) {
      tbody.innerHTML += `
      <tr>
        <td colspan="6" style="text-align:center;padding:8px">
          <button class="btn primary small" onclick="App.showAddModal()">+ 新增持股</button>
        </td>
      </tr>`;
    }
  }

  // ═══════════════════════════════════════
  // SPARKLINE HELPER — normalize real data to SVG points
  // ═══════════════════════════════════════
  function normalizeSparkline(closes, w, h) {
    if (!closes || closes.length < 2) return null;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const step = w / (closes.length - 1);
    return closes.map((v, i) => {
      const x = (i * step).toFixed(1);
      const y = (h - ((v - min) / range) * (h - 4) - 2).toFixed(1);
      return x + ',' + y;
    }).join(' ');
  }

  // ═══════════════════════════════════════
  // WATCHLIST
  // ═══════════════════════════════════════
  function renderWatchlist(watchData, sparkData) {
    const container = document.getElementById('watchlist');
    if (!container) return;

    container.innerHTML = watchData.map(w => {
      const cls = (w.changePct || 0) >= 0 ? 'up' : 'dn';
      const arrow = chgArrow(w.changePct || 0);
      const sym = w.symbol.replace('.TW', '');
      const color = cls === 'up' ? '#ff7744' : '#cc1133';
      const realCloses = sparkData ? sparkData[w.symbol] : null;
      const pts = realCloses ? normalizeSparkline(realCloses, 55, 22) : generateSparkPoints(22, 55, cls === 'up').line;

      return `
      <div class="watch-item">
        <span class="w-ticker">${sym}</span><span class="w-name">${w.name}</span>
        <svg class="w-spark" viewBox="0 0 55 22" preserveAspectRatio="none">
          <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/>
        </svg>
        <span class="w-price" data-sym="${w.symbol}">${w.price ? fmtCurrency(w.price, w.region) : '--'}</span>
        <span class="w-chg ${cls}">${arrow} ${Math.abs(w.changePct || 0).toFixed(2)}%</span>
      </div>`;
    }).join('');
    // Flash prices after render
    setTimeout(() => {
      watchData.forEach((w, i) => {
        setTimeout(() => {
          const el = container.querySelector(`.w-price[data-sym="${w.symbol}"]`);
          flashPrice(el, w.symbol, w.price);
        }, i * 30);
      });
    }, 80);
  }

  // ═══════════════════════════════════════
  // TECHNICAL INDICATORS
  // ═══════════════════════════════════════
  function renderIndicators(indData) {
    const grid = document.getElementById('ind-grid');
    const chart = document.getElementById('ind-chart');
    const label = document.getElementById('ind-label');

    if (indData && label) {
      label.textContent = `TECHNICAL · 技術指標 · ${indData.symbol.replace('.TW', '')}`;
    }

    if (grid && indData?.indicators) {
      grid.innerHTML = indData.indicators.map(ind => `
        <div class="ind-cell">
          <div class="ind-name">${ind.name}</div>
          <div class="ind-val ${ind.color}">${ind.value}</div>
          <div class="ind-sig ${ind.color}">${ind.signal}</div>
        </div>
      `).join('');
    }

    if (chart && indData?.chartData) {
      chart.innerHTML = renderSVGChart(indData.chartData, 340, 90);
    }
  }

  function renderSVGChart(data, w, h) {
    if (!data || data.length < 2) return '';

    const closes = data.map(d => d.close);
    const min = Math.min(...closes) * 0.995;
    const max = Math.max(...closes) * 1.005;
    const range = max - min || 1;
    const stepX = w / (closes.length - 1);

    const points = closes.map((c, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (h - 5 - ((c - min) / range) * (h - 25)).toFixed(1);
      return `${x},${y}`;
    }).join(' ');

    const areaPts = `0,${h} ${closes.map((c, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (h - 5 - ((c - min) / range) * (h - 25)).toFixed(1);
      return `${x},${y}`;
    }).join(' ')} ${w},${h}`;

    const color = closes[closes.length - 1] >= closes[0] ? '#ff3d1a' : '#cc1133';

    return `
    <defs>
      <linearGradient id="icg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line x1="0" y1="${h * 0.25}" x2="${w}" y2="${h * 0.25}" stroke="rgba(255,61,26,.06)" stroke-width="1"/>
    <line x1="0" y1="${h * 0.5}"  x2="${w}" y2="${h * 0.5}"  stroke="rgba(255,61,26,.06)" stroke-width="1"/>
    <line x1="0" y1="${h * 0.75}" x2="${w}" y2="${h * 0.75}" stroke="rgba(255,61,26,.06)" stroke-width="1"/>
    <path fill="url(#icg)" d="M${areaPts}"/>
    <polyline fill="none" stroke="${color}" stroke-width="2" points="${points}"/>
    <circle cx="${w}" cy="${h - 5 - ((closes[closes.length - 1] - min) / range) * (h - 25)}" r="3" fill="${color}" filter="drop-shadow(0 0 6px ${color})"/>
    <text x="4" y="10" fill="rgba(255,61,26,.3)" font-family="Orbitron,sans-serif" font-size="6" letter-spacing="2">PRICE CHART</text>`;
  }

  // ═══════════════════════════════════════
  // NEWS FEED
  // ═══════════════════════════════════════
  function renderNews(newsItems) {
    const container = document.getElementById('news-feed');
    if (!container) return;

    const half = Math.ceil(newsItems.length / 2);
    const left = newsItems.slice(0, half);
    const right = newsItems.slice(half);

    const renderCol = (items) => items.map(n => {
      const headlineHtml = n.link
        ? `<a class="n-headline" href="${n.link}" target="_blank" rel="noopener">${n.headline}</a>`
        : `<span class="n-headline">${n.headline}</span>`;
      return `
      <div class="news-item">
        <div class="n-tag ${n.region === 'TW' ? 'tw' : n.region === 'US' ? 'us' : 'macro'}">${n.region}</div>
        <div>
          ${headlineHtml}
          <div class="n-meta">
            <span>${n.source}</span><span>${n.time}</span>
            <div class="n-impact">
              <div class="n-dot ${n.impact}"></div>
              <span style="color:${n.impact === 'pos' ? 'var(--pos)' : n.impact === 'neg' ? 'var(--neg)' : 'var(--gold)'}">${n.impact.toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = `<div>${renderCol(left)}</div><div>${renderCol(right)}</div>`;
  }


  // ═══════════════════════════════════════
  // MODAL
  // ═══════════════════════════════════════
  function showModal(title, content, onSave) {
    // Remove existing modal
    closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        ${content}
        <div class="modal-actions">
          <button class="btn" onclick="UI.closeModal()">取消</button>
          <button class="btn primary" id="modal-save-btn">確認</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Bind save
    overlay.querySelector('#modal-save-btn').addEventListener('click', () => {
      if (onSave) onSave(overlay);
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Close on Escape
    const escHandler = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    // Focus first input
    setTimeout(() => {
      const firstInput = overlay.querySelector('input');
      if (firstInput) firstInput.focus();
    }, 100);
  }

  function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.remove();
  }

  // ── Add holding modal ──
  function showAddHoldingModal() {
    const content = `
      <div class="form-group">
        <label>股票代號 (美股如 NVDA，台股如 2330.TW)</label>
        <input id="mf-symbol" type="text" placeholder="例: 2330.TW 或 NVDA">
      </div>
      <div class="form-group">
        <label>股票名稱</label>
        <input id="mf-name" type="text" placeholder="例: 台積電">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>股數 (Shares)</label>
          <input id="mf-shares" type="number" placeholder="100" min="1" step="1">
        </div>
        <div class="form-group">
          <label>成本價 (Cost)</label>
          <input id="mf-cost" type="number" placeholder="840" min="0.01" step="0.01">
        </div>
      </div>
    `;

    showModal('ADD HOLDING · 新增持股', content, async (overlay) => {
      const symbol = overlay.querySelector('#mf-symbol').value.trim().toUpperCase();
      const name = overlay.querySelector('#mf-name').value.trim();
      const shares = overlay.querySelector('#mf-shares').value;
      const cost = overlay.querySelector('#mf-cost').value;

      if (!symbol || !name || !shares || !cost) {
        showToast('請填寫所有欄位', 'error');
        return;
      }

      // Determine region
      const region = symbol.endsWith('.TW') ? 'TW' : 'US';
      const result = PortfolioService.addHolding({ symbol, name, shares, cost, region });
      if (result.ok) {
        showToast(result.msg, 'success');
        closeModal();
        // Trigger refresh
        if (window.App && App.refresh) App.refresh();
      } else {
        showToast(result.msg, 'error');
      }
    });
  }

  // ═══════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════
  function showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .3s';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ═══════════════════════════════════════
  // LOADING & ERROR STATES
  // ═══════════════════════════════════════
  function setLoading(elementId, isLoading) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (isLoading) {
      el.classList.add('data-stale');
    } else {
      el.classList.remove('data-stale');
    }
  }

  function showError(elementId, msg) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="error-badge">⚠ ${msg}</div>`;
  }

  // ═══════════════════════════════════════
  // REFRESH BUTTON
  // ═══════════════════════════════════════
  function setRefreshing(isRefreshing) {
    const btn = document.getElementById('refresh-btn');
    const lbl = document.getElementById('last-updated');
    if (btn) {
      if (isRefreshing) btn.classList.add('spinning');
      else btn.classList.remove('spinning');
    }
    if (lbl && !isRefreshing) {
      const now = new Date();
      lbl.textContent = 'UPDATED ' + now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
  }

  // ═══════════════════════════════════════
  // INDICATOR LOAD PROMPT
  // ═══════════════════════════════════════
  function showIndicatorPrompt(symbol) {
    const grid = document.getElementById('ind-grid');
    if (!grid) return;
    const symName = symbol.replace('.TW', '');
    grid.innerHTML = `
      <div class="ind-cell" style="grid-column:1/-1;text-align:center;padding:20px">
        <div style="color:var(--gold);font-size:13px;margin-bottom:8px">📊 技術指標 · ${symName}</div>
        <button onclick="App.updateIndicators('${symbol}')" 
          style="background:rgba(255,119,68,0.12);border:1px solid var(--arc);color:var(--arc);
          padding:6px 20px;font-family:inherit;font-size:12px;cursor:pointer;letter-spacing:1px">
          ⬡ LOAD INDICATORS
        </button>
        <div style="color:var(--dim);font-size:10px;margin-top:6px">透過 Yahoo Finance 計算 RSI / KD / MACD / 均線</div>
      </div>`;
  }

  // ═══════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════
  return {
    // Rendering
    renderIndexCards,
    renderTicker,
    renderPortfolio,
    renderWatchlist,
    renderIndicators,
    renderNews,
    renderSVGChart,

    // Modal
    showModal,
    closeModal,
    showAddHoldingModal,
    showIndicatorPrompt,

    // Utilities
    showToast,
    setLoading,
    showError,
    setRefreshing,

    // Helpers
    chgClass,
    chgArrow,
    pctStr,
    fmtPrice,
    fmtCurrency,
  };
})();
