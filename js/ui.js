// ═══════════════════════════════════════
// J.A.R.V.I.S · UI RENDERING ENGINE
// DOM manipulation and visual updates
// ═══════════════════════════════════════

const UI = (() => {

  // ── Color / class helpers ──
  function chgClass(val) { return val >= 0 ? 'up' : 'dn'; }
  function chgArrow(val) { return val >= 0 ? '▲' : '▼'; }
  function pctStr(val) { return (val >= 0 ? '+' : '') + val.toFixed(2) + '%'; }
  function isFiniteValue(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }

  function portfolioMoney(value, currency, signed = false) {
    const amount = Math.abs(Number(value));
    const prefix = currency === 'USD' ? '$' : 'NT$';
    const formatted = currency === 'USD'
      ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(amount).toLocaleString();
    const sign = signed ? (Number(value) >= 0 ? '+' : '-') : (Number(value) < 0 ? '-' : '');
    return `${sign}${prefix}${formatted}`;
  }

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

  function fmtIndexLevel(price) {
    return Number(price).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // ═══════════════════════════════════════
  // INDEX CARDS
  // ═══════════════════════════════════════
  function renderIndexCards(indexes) {
    const container = document.getElementById('index-cards');
    if (!container) return;

    container.innerHTML = indexes.map(idx => {
      const price = idx.price;
      const changePct = idx.changePct;
      const hasData = isFiniteValue(price) && isFiniteValue(changePct);
      const cls = changePct >= 0 ? 'up' : 'dn';

      return `
      <div class="idx-card">
        <div class="idx-region">${idx.region} · ${idx.region === 'TW' ? '台灣' : '美國'}</div>
        <div class="idx-name">${idx.name}</div>
        <div class="idx-price ${hasData ? cls : ''}" data-id="${idx.id}" title="指數點位，不是貨幣金額">${hasData ? (idx.priceType === 'indicative' ? '≈' : '') + fmtIndexLevel(price) + '<span class="idx-unit"> ' + (idx.unit || 'PTS') + '</span>' : '--'}</div>
        <div class="idx-change">
          <span class="idx-pct ${hasData ? cls : ''}">${hasData ? chgArrow(changePct) + ' ' + Math.abs(changePct).toFixed(2) + '%' : '⚠ DATA UNAVAILABLE'}</span>
          <div class="progress-track"><div class="progress-fill ${cls}" style="width:${Math.min(100, Math.abs(changePct || 0) * 15)}%"></div></div>
        </div>
        <div class="idx-spark-wrap" data-index="${idx.id}" title="等待真實市場走勢資料">
          <div class="idx-spark-meta">CHART PENDING</div>
          <svg class="mini-spark" viewBox="0 0 100 30" preserveAspectRatio="none">
            <line x1="0" y1="15" x2="100" y2="15" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 4"/>
          </svg>
        </div>
      </div>`;
    }).join('');

    // Flash prices after render
    setTimeout(() => {
      indexes.forEach(idx => {
        const el = document.querySelector(`.idx-card .idx-price[data-id="${idx.id}"]`);
        flashPrice(el, 'idx_'+idx.id, idx.price);
      });
    }, 50);
  }

  function renderIndexSparklines(seriesMap = {}) {
    document.querySelectorAll('.idx-spark-wrap[data-index]').forEach(wrap => {
      const id = wrap.dataset.index;
      const series = seriesMap[id];
      const geometry = normalizeSparkGeometry(series?.closes, 100, 30);
      if (!geometry) {
        wrap.title = '真實走勢資料暫時不可用';
        wrap.innerHTML = `
          <div class="idx-spark-meta unavailable">NO CHART</div>
          <svg class="mini-spark" viewBox="0 0 100 30" preserveAspectRatio="none">
            <line x1="0" y1="15" x2="100" y2="15" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 4"/>
          </svg>`;
        return;
      }

      const rising = geometry.lastValue >= geometry.firstValue;
      const color = rising ? '#ff7744' : '#cc1133';
      const gradId = `idx-sg-${id}`;
      const asOf = Number(series.asOf);
      const asOfText = Number.isFinite(asOf)
        ? new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(asOf))
        : '--';
      wrap.title = `${series.source || 'MARKET DATA'} · ${asOfText}`;
      wrap.innerHTML = `
        <div class="idx-spark-meta">${series.period} · ${series.interval}</div>
        <svg class="mini-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="真實市場走勢">
          <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity=".35"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient></defs>
          <path fill="url(#${gradId})" d="M0,30 ${geometry.area} 100,30 Z"/>
          <polyline fill="none" stroke="${color}" stroke-width="1.5" opacity=".9" points="${geometry.line}"/>
          <circle cx="100" cy="${geometry.lastY}" r="2" fill="${color}" filter="drop-shadow(0 0 3px ${color})"/>
        </svg>`;
    });
  }

  // ═══════════════════════════════════════
  // TICKER BAR
  // ═══════════════════════════════════════
  function renderTicker(quotes) {
    const container = document.getElementById('ticker-inner');
    if (!container || !quotes || quotes.length === 0) return;

    // Duplicate for seamless scroll
    const items = [...quotes, ...quotes].map(q => {
      const hasData = isFiniteValue(q.price) && isFiniteValue(q.changePct);
      const cls = hasData && q.changePct >= 0 ? 't-up' : 't-dn';
      const arrow = (q.changePct || 0) >= 0 ? '▲' : '▼';
      const sym = q.symbol.replace('.TW', '');
      return `<span class="t-item"><span class="t-sym">${sym}</span><span class="t-price" title="${q.priceType === 'indicative' ? '買一／賣一中間報價' : ''}">${hasData ? (q.priceType === 'indicative' ? '≈' : '') + fmtCurrency(q.price, q.symbol.endsWith('.TW') ? 'TW' : 'US') : '--'}</span><span class="${cls}">${hasData ? arrow + ' ' + Math.abs(q.changePct).toFixed(2) + '%' : 'UNAVAILABLE'}</span></span>`;
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

    const complete = !stats.unavailableCount && !stats.mixedCurrency;
    const approximation = stats.hasIndicative ? '≈' : '';
    if (totalVal) totalVal.textContent = stats.mixedCurrency ? 'MIXED' : complete ? approximation + portfolioMoney(stats.totalValue, stats.currency) : '--';
    if (totalPnl) {
      totalPnl.textContent = complete ? approximation + portfolioMoney(stats.totalPnl, stats.currency, true) : '--';
      totalPnl.className = 'ps-value ' + chgClass(stats.totalPnl);
    }
    if (returnRate) {
      returnRate.textContent = complete ? approximation + pctStr(stats.returnPct) : '--';
      returnRate.className = 'ps-value ' + chgClass(stats.returnPct);
    }

    if (!tbody) return;

    tbody.innerHTML = stats.holdings.map(h => {
      const hasPrice = !h.unavailable && isFiniteValue(h.price);
      const cls = chgClass(h.pnlPct);
      const barW = hasPrice ? Math.min(100, Math.abs(h.pnlPct || 0) * 2.5) : 0;
      const arrow = chgArrow(h.pnlPct);
      return `
      <tr>
        <td><span class="pt-ticker">${h.symbol.replace('.TW', '')}</span></td>
        <td>${h.name}</td>
        <td>${fmtCurrency(h.cost, h.region)}</td>
        <td style="color:${hasPrice ? (cls === 'up' ? 'var(--pos)' : 'var(--neg)') : 'var(--warn)'}" title="${h.priceType === 'indicative' ? '買一／賣一中間報價' : ''}">${hasPrice ? (h.priceType === 'indicative' ? '≈' : '') + fmtCurrency(h.price, h.region) : '⚠ --'}</td>
        <td>
          <div class="pnl-wrap">
            <div class="pnl-bar"><div class="pnl-fill ${cls}" style="width:${barW}%"></div></div>
            <span style="color:${hasPrice ? (cls === 'up' ? 'var(--pos)' : 'var(--neg)') : 'var(--warn)'};font-family:'Orbitron',sans-serif;font-size:10px">${hasPrice ? arrow + ' ' + Math.abs(h.pnlPct || 0).toFixed(2) + '%' : 'UNAVAILABLE'}</span>
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
    const values = (closes || []).map(Number).filter(Number.isFinite);
    if (values.length < 2) return null;
    const maxPoints = 120;
    const sampled = values.length <= maxPoints
      ? values
      : Array.from({ length:maxPoints }, (_, i) => values[Math.round(i * (values.length - 1) / (maxPoints - 1))]);
    const min = Math.min(...sampled);
    const max = Math.max(...sampled);
    const range = max - min;
    const step = w / (sampled.length - 1);
    return sampled.map((v, i) => {
      const x = (i * step).toFixed(1);
      const y = (range === 0 ? h / 2 : h - ((v - min) / range) * (h - 4) - 2).toFixed(1);
      return x + ',' + y;
    }).join(' ');
  }

  function normalizeSparkGeometry(closes, w, h) {
    const values = (closes || []).map(Number).filter(Number.isFinite);
    const line = normalizeSparkline(values, w, h);
    if (!line) return null;
    const lastPoint = line.split(' ').pop();
    return {
      line,
      area: `0,${h} ${line} ${w},${h}`,
      lastY: lastPoint.split(',')[1],
      firstValue: values[0],
      lastValue: values[values.length - 1],
    };
  }

  // ═══════════════════════════════════════
  // WATCHLIST
  // ═══════════════════════════════════════
  function renderWatchlist(watchData, sparkData) {
    const container = document.getElementById('watchlist');
    if (!container) return;

    container.innerHTML = watchData.map(w => {
      const hasData = isFiniteValue(w.price) && isFiniteValue(w.changePct);
      const cls = (w.changePct || 0) >= 0 ? 'up' : 'dn';
      const arrow = chgArrow(w.changePct || 0);
      const sym = w.symbol.replace('.TW', '');
      const color = cls === 'up' ? '#ff7744' : '#cc1133';
      const realCloses = sparkData ? sparkData[w.symbol] : null;
      const pts = normalizeSparkline(realCloses, 55, 22);

      return `
      <div class="watch-item">
        <span class="w-ticker">${sym}</span><span class="w-name">${w.name}</span>
        <svg class="w-spark" viewBox="0 0 55 22" preserveAspectRatio="none" aria-label="${pts ? '真實近三月日線走勢' : '走勢資料暫時不可用'}">
          ${pts
            ? `<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/>`
            : '<text x="27.5" y="13" text-anchor="middle" fill="rgba(255,255,255,.25)" font-size="5">N/A</text>'}
        </svg>
        <span class="w-price" data-sym="${w.symbol}" title="${w.priceType === 'indicative' ? '≈ 代表買一／賣一中間報價，非最後成交價' : ''}">${hasData ? (w.priceType === 'indicative' ? '≈' : '') + fmtCurrency(w.price, w.region) : '--'}</span>
        <span class="w-chg ${hasData ? cls : ''}">${hasData ? arrow + ' ' + Math.abs(w.changePct).toFixed(2) + '%' : 'UNAVAILABLE'}</span>
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
  // FEATURED · 重點關注
  // ═══════════════════════════════════════
  function renderFeatured() {
    const container = document.getElementById('featured-row');
    if (!container) return;
    const featured = ['0050.TW', '2330.TW'];
    const quotes = window._watchlistQuotes || [];
    const data = featured.map(sym => quotes.find(q => q.symbol === sym)).filter(Boolean);
    if (!data.length) return;

    container.innerHTML = data.map(q => {
      const hasData = isFiniteValue(q.price) && isFiniteValue(q.changePct);
      const cls = (q.changePct || 0) >= 0 ? 'up' : 'dn';
      const arrow = (q.changePct || 0) >= 0 ? '▲' : '▼';
      const sym = q.symbol.replace('.TW', '');
      return `
      <div class="featured-card">
        <div class="featured-sym">${sym}</div>
        <div class="featured-name">${q.name || ''}</div>
        <div class="featured-price ${hasData ? cls : ''}" data-sym="${q.symbol}" title="${q.priceType === 'indicative' ? '≈ 代表買一／賣一中間報價，非最後成交價' : ''}">${hasData ? (q.priceType === 'indicative' ? '≈' : '') + Number(q.price).toFixed(2) : '--'}</div>
        <div class="featured-chg ${hasData ? cls : ''}">${hasData ? arrow + ' ' + Math.abs(q.change || 0).toFixed(2) + ' (' + Math.abs(q.changePct).toFixed(2) + '%)' : '⚠ UNAVAILABLE'}</div>
      </div>`;
    }).join('');

    setTimeout(() => {
      data.forEach(q => {
        const el = container.querySelector('.featured-price[data-sym="' + q.symbol + '"]');
        flashPrice(el, 'feat_'+q.symbol, q.price);
      });
    }, 50);
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
    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      container.innerHTML = '<div class="loading-indicator" style="grid-column:1/-1">⚠ CURRENT NEWS UNAVAILABLE · 未顯示舊新聞</div>';
      return;
    }

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    })[char]);
    const safeHttpUrl = value => {
      try {
        const url = new URL(String(value || ''));
        return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '';
      } catch(e) { return ''; }
    };

    const half = Math.ceil(newsItems.length / 2);
    const left = newsItems.slice(0, half);
    const right = newsItems.slice(half);

    const renderCol = (items) => items.map(n => {
      const link = safeHttpUrl(n.link);
      const headline = escapeHtml(n.headline);
      const region = ['TW', 'US', 'INTL'].includes(n.region) ? n.region : 'INTL';
      const impact = ['pos', 'neg', 'neu'].includes(n.impact) ? n.impact : 'neu';
      const headlineHtml = link
        ? `<a class="n-headline" href="${link}" target="_blank" rel="noopener">${headline}</a>`
        : `<span class="n-headline">${headline}</span>`;
      return `
      <div class="news-item">
        <div class="n-tag ${region === 'TW' ? 'tw' : region === 'US' ? 'us' : 'macro'}">${region}</div>
        <div>
          ${headlineHtml}
          <div class="n-meta">
            <span>${escapeHtml(n.source)}</span><span>${escapeHtml(n.time)}</span>
            <div class="n-impact">
              <div class="n-dot ${impact}"></div>
              <span style="color:${impact === 'pos' ? 'var(--pos)' : impact === 'neg' ? 'var(--neg)' : 'var(--gold)'}">${impact.toUpperCase()}</span>
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
    if (lbl && isRefreshing && /--:--|^UPDATED|^DATA UNAVAILABLE/.test(lbl.textContent)) {
      lbl.textContent = 'REFRESHING...';
    }
  }

  function setDataStatus({ fresh, total, oldestAsOf, twAsOf, usAsOf, mode = 'live', indicative = 0 }) {
    const lbl = document.getElementById('last-updated');
    const sysOrb = document.getElementById('sysOrb');
    const sysLabel = document.getElementById('sysLabel');
    const tickerMode = document.getElementById('ticker-mode-label');
    const asOf = isFiniteValue(oldestAsOf) ? Number(oldestAsOf) : null;
    const formatTime = value => isFiniteValue(value)
      ? new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(new Date(Number(value)))
      : null;
    const regionalText = [
      formatTime(twAsOf) ? `TW ${formatTime(twAsOf)}` : null,
      formatTime(usAsOf) ? `US ${formatTime(usAsOf)}` : null,
    ].filter(Boolean).join(' · ') || formatTime(asOf) || '--:--:--';
    const complete = fresh === total && total > 0;

    if (lbl) {
      const prefix = mode === 'cache' ? 'CACHED' : 'DATA';
      lbl.textContent = fresh > 0 ? `${prefix} ${regionalText} · ${fresh}/${total}${indicative ? ` · ≈${indicative}` : ''}` : 'DATA UNAVAILABLE';
      lbl.title = '這是行情來源時間，不是頁面重新整理時間';
    }
    if (sysOrb) sysOrb.className = `status-orb ${complete && mode === 'live' ? 'live' : fresh > 0 ? 'pre' : 'off'}`;
    if (sysLabel) {
      sysLabel.textContent = mode === 'cache' && fresh > 0
        ? 'DATA CACHED'
        : complete && !indicative ? 'DATA LIVE' : complete ? 'DATA QUOTED' : fresh > 0 ? 'DATA PARTIAL' : 'DATA OFFLINE';
    }
    if (tickerMode) {
      tickerMode.textContent = mode === 'cache' && fresh > 0
        ? '◈ CACHED'
        : !fresh ? '⚠ OFFLINE' : fresh < total ? '⚠ PARTIAL' : indicative ? '≈ QUOTE' : '⬡ LIVE';
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
    renderIndexSparklines,
    renderTicker,
    renderPortfolio,
    renderWatchlist,
    renderFeatured,
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
    setDataStatus,

    // Helpers
    chgClass,
    chgArrow,
    pctStr,
    fmtPrice,
    fmtCurrency,
  };
})();
