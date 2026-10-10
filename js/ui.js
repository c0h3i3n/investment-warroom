// ═══════════════════════════════════════
// J.A.R.V.I.S · UI RENDERING ENGINE
// DOM manipulation and visual updates
// ═══════════════════════════════════════

const UI = (() => {

  // ── Color / class helpers ──
  function chgClass(val) {
    if (!isFiniteValue(val)) return '';
    if (Math.abs(Number(val)) < 0.005) return 'flat';
    return Number(val) > 0 ? 'up' : 'dn';
  }
  function chgArrow(val) { return chgClass(val) === 'flat' ? '—' : Number(val) >= 0 ? '▲' : '▼'; }
  function pctStr(val) { return (val >= 0 ? '+' : '') + val.toFixed(2) + '%'; }
  function isFiniteValue(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[char]);

  function quoteMeta(record) {
    if (!isFiniteValue(record?.asOf)) return '';
    const time = new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei',
      month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
    }).format(new Date(Number(record.asOf)));
    const type = record.priceType === 'indicative' ? '中間報價' : '成交價';
    return [type, record.source, time].filter(Boolean).join(' · ');
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
  let indexQuoteMap = {};
  function renderIndexCards(indexes) {
    indexQuoteMap = Object.fromEntries(indexes.map(item => [item.id, item]));
    const container = document.getElementById('index-cards');
    if (!container) return;

    container.innerHTML = indexes.map(idx => {
      const price = idx.price;
      const changePct = idx.changePct;
      const hasData = isFiniteValue(price) && isFiniteValue(changePct);
      const cls = chgClass(changePct);

      return `
      <div class="idx-card">
        <div class="idx-region">${idx.region} · ${idx.region === 'TW' ? '台灣' : '美國'}</div>
        <div class="idx-name">${CONFIG.INDEXES.find(item => item.id === idx.id)?.name || idx.name}</div>
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
      const quote = indexQuoteMap[id];
      const baseline = isFiniteValue(quote?.prevClose) ? Number(quote.prevClose) : null;
      const geometry = normalizeSparkGeometry(series?.closes, 100, 30, baseline);
      if (!geometry) {
        wrap.title = '真實走勢資料暫時不可用';
        wrap.innerHTML = `
          <div class="idx-spark-meta unavailable">NO CHART</div>
          <svg class="mini-spark" viewBox="0 0 100 30" preserveAspectRatio="none">
            <line x1="0" y1="15" x2="100" y2="15" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 4"/>
          </svg>`;
        return;
      }

      const rising = Number(quote?.changePct) >= 0;
      const color = !isFiniteValue(quote?.changePct) ? '#adb5c1' : rising ? '#ff7744' : '#ed527b';
      const gradId = `idx-sg-${id}`;
      const asOf = Number(series.asOf);
      const asOfText = Number.isFinite(asOf)
        ? new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(asOf))
        : '--';
      wrap.title = `${series.source || 'MARKET DATA'} · ${asOfText} · 線色依較昨收漲跌；線形為盤中走勢`;
      wrap.innerHTML = `
        <div class="idx-spark-meta">${series.period} · ${series.interval} · 較昨收</div>
        <svg class="mini-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="真實市場走勢">
          ${geometry.baselineY !== null ? `<line x1="0" x2="100" y1="${geometry.baselineY}" y2="${geometry.baselineY}" stroke="#adb5c1" stroke-width=".5" stroke-dasharray="2 2"><title>昨收 ${baseline}</title></line>` : ''}
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

  function renderNightMarket(data, indexes = []) {
    const container = document.getElementById('night-market-content');
    if (!container) return;
    if (!data) {
      setNightStatus(null);
      container.innerHTML = '<div class="night-unavailable">⚠ 夜盤資料暫時無法取得；不使用舊資料產生方向判斷。</div>';
      return;
    }

    setNightStatus(data);

    const state = data.status === 'open' ? '夜盤交易中' : '夜盤已收盤';
    const stateClass = data.status === 'open' ? 'live' : 'closed';
    const asOf = isFiniteValue(data.asOf) ? new Intl.DateTimeFormat('zh-TW', {
      timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
    }).format(new Date(Number(data.asOf))) : '--';
    const level = value => isFiniteValue(value) ? Number(value).toLocaleString('en-US', {maximumFractionDigits:2}) : '--';
    const signedPoints = value => isFiniteValue(value)
      ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)} 點` : '--';
    const contract = /^\d{6}$/.test(String(data.contract || ''))
      ? `${String(data.contract).slice(0,4)}/${String(data.contract).slice(4)}` : '--';
    if (data.stale) {
      container.innerHTML = `
        <div class="night-headline">
          <div>
            <span class="night-session ${stateClass}">${state}</span>
            <span class="night-contract">TX ${contract} · ${escapeHtml(data.source || 'TAIFEX')}</span>
          </div>
          <div class="night-asof">最後取得 ${asOf}</div>
        </div>
        <div class="night-unavailable">⚠ 夜盤資料已逾時，舊點位與基差不顯示；方向判斷已停用，等待有效行情。</div>`;
      return;
    }

    const analysis = NightAnalysis.evaluate(data, indexes);
    const cls = chgClass(data.changePct);
    const arrow = chgArrow(data.changePct);
    const drivers = analysis.drivers.map(driver =>
      `<span class="night-driver"><b>${escapeHtml(driver.label)}</b> ${escapeHtml(driver.value)}</span>`).join('');
    const refreshFailed = Boolean(data.warning);
    const warning = data.delayed
        ? '<div class="night-warning">⚠ 行情延遲 3–5 分鐘，方向僅供參考</div>'
      : refreshFailed || data.delivery === 'stale-kv'
        ? '<div class="night-warning">⚠ 即時更新失敗，顯示最近有效夜盤資料</div>' : '';

    const detailsOpen = data.status === 'open' || container.querySelector?.('.night-details')?.open;
    container.innerHTML = `
      <div class="night-headline">
        <div>
          <span class="night-session ${stateClass}">${state}</span>
          <span class="night-contract">TX ${contract}${data.sessionTradingDay ? ` · 交易日 ${escapeHtml(data.sessionTradingDay)}` : ''} · ${escapeHtml(data.source || 'TAIFEX')}</span>
        </div>
        <div class="night-asof">行情時間 ${asOf}</div>
      </div>
      ${warning}
      <details class="night-details" ${detailsOpen ? 'open' : ''}>
      <summary>${data.status === 'open' ? '夜盤行情' : '最近夜盤收盤'} · ${level(data.price)} 點 · ${arrow} ${Math.abs(Number(data.changePct)).toFixed(2)}% <span>展開／收合明細</span></summary>
      <div class="night-layout">
        <div class="night-primary">
          <div class="night-price ${cls}">${level(data.price)} <small>PTS</small></div>
          <div class="night-change ${cls}">${arrow} ${Math.abs(Number(data.change || 0)).toFixed(2)} (${Math.abs(Number(data.changePct || 0)).toFixed(2)}%)</div>
          <div class="night-reference">相對日盤參考價 ${level(data.referencePrice)}</div>
        </div>
        <div class="night-metrics">
          <div><span>最高／最低</span><b>${level(data.high)}／${level(data.low)}</b></div>
          <div><span>MIS 行情成交量</span><b>${isFiniteValue(data.volume) ? Math.round(Number(data.volume)).toLocaleString() + ' 口' : '--'}</b></div>
          <div><span>相對現貨收盤價差</span><b class="${Number(data.basis) >= 0 ? 'up' : 'dn'}">${signedPoints(data.basis)}</b></div>
        </div>
        <div class="night-risk ${analysis.tone}">
          <span>${data.status === 'open' ? '即時風險方向' : '最近夜盤方向'}</span>
          <strong>${escapeHtml(analysis.label)}</strong>
          <small>${analysis.usable ? `${analysis.drivers.length > 1 ? '同時段分數' : '台指期單一訊號'} ${analysis.score >= 0 ? '+' : ''}${analysis.score}` : '等待有效即時資料'}</small>
        </div>
      </div>
      <div class="night-drivers">${drivers || '<span>美股交叉訊號暫不可用</span>'}</div>
      ${analysis.excluded?.length ? `<div class="night-warning">${escapeHtml(analysis.excluded.join('、'))} 與夜盤非同時段或時間未確認，未納入評分。</div>` : ''}
      <div class="night-disclaimer">成交量為 TAIFEX MIS 行情值，非官方日報總量；日報含價差及鉅額交易，兩者不可直接混用。現貨價差採最近現貨收盤 ${level(data.spotReference)} 點，並非同步可交易基差。此區僅反映風險方向，不代表隔日開盤預測。</div></details>`;
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
      const tone = chgClass(q.changePct);
      const cls = hasData ? `t-${tone}` : '';
      const arrow = chgArrow(q.changePct);
      const sym = q.symbol.replace('.TW', '');
      return `<span class="t-item"><span class="t-sym">${sym}</span><span class="t-price" title="${q.priceType === 'indicative' ? '買一／賣一中間報價' : ''}">${hasData ? (q.priceType === 'indicative' ? '≈' : '') + fmtCurrency(q.price, q.symbol.endsWith('.TW') ? 'TW' : 'US') : '--'}</span><span class="${cls}">${hasData ? arrow + ' ' + Math.abs(q.changePct).toFixed(2) + '%' : 'UNAVAILABLE'}</span></span>`;
    }).join('');

    container.innerHTML = items;
  }

  // ═══════════════════════════════════════
  // ═══════════════════════════════════════
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

  function normalizeSparkGeometry(closes, w, h, baseline = null) {
    const values = (closes || []).map(Number).filter(Number.isFinite);
    const min = Math.min(...values, ...(baseline === null ? [] : [baseline]));
    const max = Math.max(...values, ...(baseline === null ? [] : [baseline]));
    const y = value => max === min ? h / 2 : h - ((value - min) / (max - min)) * (h - 4) - 2;
    const line = values.length < 2 ? null : values.map((value,i) => `${(i*w/(values.length-1)).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    if (!line) return null;
    const lastPoint = line.split(' ').pop();
    return {
      line,
      area: `0,${h} ${line} ${w},${h}`,
      lastY: lastPoint.split(',')[1],
      firstValue: values[0],
      lastValue: values[values.length - 1],
      baselineY: baseline === null ? null : y(baseline).toFixed(1),
    };
  }

  // ═══════════════════════════════════════
  // WATCHLIST
  // ═══════════════════════════════════════
  function renderWatchlist(watchData, sparkData) {
    const container = document.getElementById('watchlist');
    if (!container) return;

    renderWatchlist.latestData = watchData;
    renderWatchlist.latestSparks = sparkData;
    if (!renderWatchlist.controlsBound) {
      ['watch-search','watch-region','watch-sort'].forEach(id => {
        document.getElementById(id)?.addEventListener(id === 'watch-search' ? 'input' : 'change', () =>
          renderWatchlist(renderWatchlist.latestData || [], renderWatchlist.latestSparks));
      });
      container.addEventListener('click', event => {
        const remove = event.target.closest('[data-remove-symbol]');
        if (remove) {
          event.stopPropagation();
          App.removeWatchItem(remove.dataset.removeSymbol);
          return;
        }
        const item = event.target.closest('[data-watch-symbol]');
        if (item) App.updateIndicators(item.dataset.watchSymbol);
      });
      container.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key) || event.target.closest('button')) return;
        const item = event.target.closest('[data-watch-symbol]');
        if (item) {
          event.preventDefault();
          App.updateIndicators(item.dataset.watchSymbol);
        }
      });
      renderWatchlist.controlsBound = true;
    }
    const query = (document.getElementById('watch-search')?.value || '').trim().toLowerCase();
    const region = document.getElementById('watch-region')?.value || 'ALL';
    const sort = document.getElementById('watch-sort')?.value || 'default';
    watchData = watchData.filter(item => (!query || `${item.symbol} ${item.name}`.toLowerCase().includes(query))
      && (region === 'ALL' || item.region === region));
    if (sort === 'gainers') watchData.sort((a,b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
    if (sort === 'losers') watchData.sort((a,b) => (a.changePct ?? Infinity) - (b.changePct ?? Infinity));
    if (sort === 'symbol') watchData.sort((a,b) => a.symbol.localeCompare(b.symbol));

    if (!watchData.length) {
      container.innerHTML = '<div class="empty-state">沒有符合條件的自選股。</div>';
      return;
    }

    container.innerHTML = watchData.map(w => {
      const hasData = isFiniteValue(w.price) && isFiniteValue(w.changePct);
      const cls = chgClass(w.changePct);
      const arrow = chgArrow(w.changePct);
      const sym = w.symbol.replace('.TW', '');
      const color = cls === 'up' ? '#ff7744' : '#cc1133';
      const realCloses = sparkData ? sparkData[w.symbol] : null;
      const pts = normalizeSparkline(realCloses, 55, 22);

      return `
      <div class="watch-item${renderWatchlist.activeSymbol === w.symbol ? ' selected' : ''}" data-watch-symbol="${escapeHtml(w.symbol)}" role="button" tabindex="0" aria-label="顯示 ${escapeHtml(sym)} 技術指標">
        <span class="w-ticker">${escapeHtml(sym)}</span><span class="w-name">${escapeHtml(w.name)}<small class="quote-meta">${escapeHtml(quoteMeta(w))}</small></span>
        <svg class="w-spark" viewBox="0 0 55 22" preserveAspectRatio="none" aria-label="${pts ? '真實近三月日線走勢' : '走勢資料暫時不可用'}">
          ${pts
            ? `<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/>`
            : '<text x="27.5" y="13" text-anchor="middle" fill="rgba(255,255,255,.25)" font-size="5">N/A</text>'}
        </svg>
        <span class="w-price" data-sym="${w.symbol}" title="${w.priceType === 'indicative' ? '≈ 代表買一／賣一中間報價，非最後成交價' : ''}">${hasData ? (w.priceType === 'indicative' ? '≈' : '') + fmtCurrency(w.price, w.region) : '--'}</span>
        <span class="w-chg ${hasData ? cls : ''}">${hasData ? arrow + ' ' + Math.abs(w.changePct).toFixed(2) + '%' : 'UNAVAILABLE'}</span>
        <button class="watch-remove" type="button" data-remove-symbol="${escapeHtml(w.symbol)}" title="從自選股移除 ${escapeHtml(sym)}" aria-label="從自選股移除 ${escapeHtml(sym)}">×</button>
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

  function setWatchlistActiveSymbol(symbol) {
    renderWatchlist.activeSymbol = symbol;
    const link = document.getElementById('watch-indicator-link');
    if (link) link.textContent = `查看 ${symbol.replace('.TW', '')} 技術指標 ↓`;
    document.querySelectorAll('[data-watch-symbol]').forEach(item => {
      item.classList.toggle('selected', item.dataset.watchSymbol === symbol);
    });
  }


  // ═══════════════════════════════════════
  // FEATURED · 重點關注
  // ═══════════════════════════════════════
  function renderFeatured() {
    const container = document.getElementById('featured-row');
    if (!container) return;
    const featured = ['0050.TW', '2330.TW'];
    const quotes = window._featuredQuotes || window._watchlistQuotes || [];
    const data = featured.map(sym => quotes.find(q => q.symbol === sym)).filter(Boolean);
    if (!data.length) return;

    container.innerHTML = data.map(q => {
      const hasData = isFiniteValue(q.price) && isFiniteValue(q.changePct);
      const cls = chgClass(q.changePct);
      const arrow = chgArrow(q.changePct);
      const sym = q.symbol.replace('.TW', '');
      return `
      <div class="featured-card">
        <div class="featured-sym">${sym}</div>
        <div class="featured-name">${q.name || ''}</div>
        <div class="featured-price ${hasData ? cls : ''}" data-sym="${q.symbol}" title="${q.priceType === 'indicative' ? '≈ 代表買一／賣一中間報價，非最後成交價' : ''}">${hasData ? (q.priceType === 'indicative' ? '≈' : '') + Number(q.price).toFixed(2) : '--'}</div>
        <div class="featured-chg ${hasData ? cls : ''}">${hasData ? arrow + ' ' + Math.abs(q.change || 0).toFixed(2) + ' (' + Math.abs(q.changePct).toFixed(2) + '%)' : '⚠ UNAVAILABLE'}</div>
        <div class="featured-meta">${escapeHtml(quoteMeta(q))}</div>
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
  let indicatorChartData = null;
  let indicatorChartZone = 'Asia/Taipei';
  let indicatorChartObserver = null;

  function drawIndicatorChart() {
    const chart = document.getElementById('ind-chart');
    if (!chart || !indicatorChartData) return;
    const width = Math.max(1, Math.round(chart.getBoundingClientRect().width));
    chart.setAttribute('viewBox', `0 0 ${width} 150`);
    chart.innerHTML = renderSVGChart(indicatorChartData, width, 150, indicatorChartZone);
  }

  function renderIndicators(indData) {
    const grid = document.getElementById('ind-grid');
    const chart = document.getElementById('ind-chart');
    const label = document.getElementById('ind-label');

    if (indData && label) {
      label.textContent = `TECHNICAL · 技術指標 · ${indData.symbol.replace('.TW', '')}`;
    }

    if (grid && indData?.indicators) {
      const lag = Number(indData.historyMeta?.lagSessions) || 0;
      grid.innerHTML = (lag > 0 ? `<div class="indicator-warning" role="status">日線落後 ${lag} 個交易日，應更新至 ${escapeHtml(indData.historyMeta.expectedSession)}。以下保留歷史數值，方向訊號暫停。</div>` : '') + indData.indicators.map(ind => `
        <div class="ind-cell">
          <div class="ind-name">${ind.name}</div>
          <div class="ind-val ${lag > 0 ? 'historical' : ind.color}">${ind.value}</div>
          <div class="ind-sig ${lag > 0 ? 'historical' : ind.color}">${lag > 0 ? '歷史數值 · 訊號暫停' : ind.signal}</div>
        </div>
      `).join('');
      const status = document.createElement('div');
      status.className = 'indicator-source';
      const zone = String(indData.symbol || '').endsWith('.TW') ? 'Asia/Taipei' : 'America/New_York';
      const asDate = time => new Intl.DateTimeFormat('zh-TW', {
        timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit',
      }).format(new Date(time));
      const asTime = time => new Intl.DateTimeFormat('zh-TW', {
        timeZone:zone, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false,
      }).format(new Date(time));
      const generatedAt = Date.parse(indData.historyMeta?.generatedAt || '');
      status.textContent = '技術指標截至 ' + asDate(indData.asOf) + ' 完整日線'
        + (indData.historyMeta?.source ? ' · ' + indData.historyMeta.source : '')
        + (Number.isFinite(generatedAt) ? ' · 資料取得 ' + asTime(generatedAt) : ' · 資料取得時間不明')
        + (indData.historyMeta?.excludedIncomplete ? ' · 盤中日線未納入' : '')
        + (indData.historyMeta?.delivery === 'stale-kv' ? ' · 更新失敗，使用快取' : '')
        + (indData.historyMeta?.rejectedRows ? ' · 已排除異常日線 ' + indData.historyMeta.rejectedRows + ' 筆' : '');
      status.textContent += ' · 成交量及均量採同一 Yahoo 日線口徑，不等同交易所全市場日報總量';
      grid.appendChild(status);
    }

    if (chart && indData?.chartData) {
      indicatorChartData = indData.chartData;
      indicatorChartZone = String(indData.symbol).endsWith('.TW') ? 'Asia/Taipei' : 'America/New_York';
      drawIndicatorChart();
      if (!indicatorChartObserver && typeof ResizeObserver !== 'undefined') {
        indicatorChartObserver = new ResizeObserver(drawIndicatorChart);
        indicatorChartObserver.observe(chart);
      }
      const detail = document.getElementById('chart-detail');
      if (detail) detail.textContent = '指向或點選走勢查看還原價格；鍵盤可用左右方向鍵。';
    }
  }

  function renderSVGChart(data, w, h, timeZone = 'Asia/Taipei') {
    if (!data || data.length < 2) return '';

    const closes = data.map(d => d.close);
    const min = Math.min(...closes) * 0.995;
    const max = Math.max(...closes) * 1.005;
    const range = max - min || 1;
    const plotWidth = Math.max(1, w - 54);
    const bottom = h - 22;
    const stepX = plotWidth / (closes.length - 1);

    const points = closes.map((c, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (bottom - ((c - min) / range) * (bottom - 20)).toFixed(1);
      return `${x},${y}`;
    }).join(' ');

    const areaPts = `0,${bottom} ${closes.map((c, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (bottom - ((c - min) / range) * (bottom - 20)).toFixed(1);
      return `${x},${y}`;
    }).join(' ')} ${plotWidth},${bottom}`;

    const color = closes[closes.length - 1] >= closes[0] ? '#ff3d1a' : '#cc1133';
    const targets = data.map((row, i) => {
      const date = new Date(row.time).toLocaleDateString('zh-TW', {timeZone});
      const value = key => Number(row[key]).toFixed(2);
      const label = `${date} · 還原價格 開 ${value('open')} 高 ${value('high')} 低 ${value('low')} 收 ${value('close')}`;
      const left = Math.max(0, (i-.5)*stepX);
      return `<rect class="chart-hit" data-chart-detail="${label}" role="button" aria-label="${label}" tabindex="${i === data.length-1 ? 0 : -1}" x="${left}" y="15" width="${Math.min(plotWidth,left+stepX)-left}" height="${bottom-15}"><title>${label}</title></rect>`;
    }).join('');
    const ticks = [0,.5,1].map(f => {
      const y = bottom - f*(bottom-20);
      return `<line x1="0" x2="${plotWidth}" y1="${y}" y2="${y}" stroke="#343b45" stroke-dasharray="3 4"/><text x="${plotWidth+5}" y="${y+4}" fill="#adb5c1" font-size="11">${(min+f*range).toFixed(2)}</text>`;
    }).join('');
    const dateLabel = row => new Intl.DateTimeFormat('zh-TW',{timeZone,month:'2-digit',day:'2-digit'}).format(new Date(row.time));

    return `
    <defs>
      <linearGradient id="icg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${ticks}
    <path fill="url(#icg)" d="M${areaPts}"/>
    <polyline fill="none" stroke="${color}" stroke-width="2" points="${points}"/>
    <circle cx="${plotWidth}" cy="${bottom - ((closes.at(-1) - min) / range) * (bottom - 20)}" r="3" fill="${color}"/>
    <text x="0" y="11" fill="#adb5c1" font-size="10">還原日線 · 價格刻度</text>
    <text x="0" y="${h-4}" fill="#adb5c1" font-size="11">${dateLabel(data[0])}</text>
    <text x="${plotWidth}" y="${h-4}" text-anchor="end" fill="#adb5c1" font-size="11">${dateLabel(data.at(-1))}</text>${targets}`;
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

    const safeHttpUrl = value => {
      try {
        const url = new URL(String(value || ''));
        return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '';
      } catch(e) { return ''; }
    };

    newsItems = typeof NewsService !== 'undefined'
      ? NewsService.prepareNews(newsItems, typeof window !== 'undefined' ? window._watchlistQuotes || [] : [])
      : [...newsItems].sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0));
    const half = Math.ceil(newsItems.length / 2);
    const left = newsItems.slice(0, half);
    const right = newsItems.slice(half);

    const renderCol = (items) => items.map(n => {
      const link = safeHttpUrl(n.link);
      const headline = escapeHtml(n.headline);
      const region = ['TW', 'US', 'INTL', 'CRYPTO'].includes(n.region) ? n.region : 'INTL';
      const regionLabel = { TW:'台股', US:'美股', INTL:'綜合', CRYPTO:'加密' }[region];
      const publishedAt = Number(n.publishedAt);
      const publishedText = Number.isFinite(publishedAt) && publishedAt > 0
        ? new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(publishedAt))
        : n.time || '--';
      const headlineHtml = link
        ? `<a class="n-headline" href="${link}" target="_blank" rel="noopener">${headline}</a>`
        : `<span class="n-headline">${headline}</span>`;
      return `
      <div class="news-item">
        <div class="n-tag ${region === 'TW' ? 'tw' : region === 'US' ? 'us' : 'macro'}" title="依標題與專屬新聞來源分類">${regionLabel}</div>
        <div>
          ${headlineHtml}
          <div class="n-meta">
            <span>${escapeHtml(n.source)}</span><span>${escapeHtml(publishedText)}</span>
            ${n.related ? '<span class="news-related">自選相關</span>' : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = `<div>${renderCol(left)}</div><div>${renderCol(right)}</div>`;
  }


  // ═══════════════════════════════════════
  // ═══════════════════════════════════════
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
      btn.disabled = isRefreshing;
      btn.setAttribute('aria-busy', String(isRefreshing));
    }
    if (lbl && isRefreshing && /--:--|^UPDATED|^(DATA|QUOTES) UNAVAILABLE|^CONNECTING/.test(lbl.textContent)) {
      lbl.textContent = 'REFRESHING...';
    }
  }

  function setConnecting() {
    const lbl = document.getElementById('last-updated');
    const sysOrb = document.getElementById('sysOrb');
    const sysLabel = document.getElementById('sysLabel');
    const tickerMode = document.getElementById('ticker-mode-label');
    const nightOrb = document.getElementById('nightOrb');
    const nightLabel = document.getElementById('nightLabel');
    if (lbl) {
      lbl.textContent = 'CONNECTING MARKET DATA...';
      lbl.title = '正在連線至行情服務';
    }
    if (sysOrb) sysOrb.className = 'status-orb pre';
    if (sysLabel) sysLabel.textContent = 'QUOTES CONNECTING';
    if (nightOrb) nightOrb.className = 'status-orb pre';
    if (nightLabel) nightLabel.textContent = 'NIGHT CHECK';
    if (tickerMode) tickerMode.textContent = '◌ CONNECTING';
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
    const regionalState = (region, time) => {
      if (!isFiniteValue(time)) return '無資料';
      if (mode === 'cache') return '快取';
      if (typeof DataService !== 'undefined' && !DataService.isMarketOpen(region)) return '最近收盤';
      return region === 'US' ? '延遲行情' : Date.now() - Number(time) > 120000 ? '行情延遲' : '盤中行情';
    };
    const regionalText = [
      formatTime(twAsOf) ? `台股 ${regionalState('TW',twAsOf)} ${formatTime(twAsOf)}` : null,
      formatTime(usAsOf) ? `美股 ${regionalState('US',usAsOf)} ${formatTime(usAsOf)}` : null,
    ].filter(Boolean).join(' · ') || formatTime(asOf) || '--:--:--';
    const complete = fresh === total && total > 0;

    if (lbl) {
      const prefix = mode === 'cache' ? 'CACHED QUOTES' : 'QUOTES';
      lbl.textContent = fresh > 0 ? `${prefix} ${regionalText} · ${fresh}/${total}${indicative ? ` · ≈${indicative}` : ''}` : 'QUOTES UNAVAILABLE';
      lbl.title = '這是行情來源時間，不是頁面重新整理時間';
    }
    if (sysOrb) sysOrb.className = `status-orb ${complete && mode === 'live' ? 'live' : fresh > 0 ? 'pre' : 'off'}`;
    if (sysLabel) {
      sysLabel.textContent = mode === 'cache' && fresh > 0
        ? 'QUOTES CACHED'
        : complete ? '行情齊全 ≠ 全部即時' : fresh > 0 ? '部分行情缺漏' : '行情無法取得';
    }
    if (tickerMode) {
      tickerMode.textContent = mode === 'cache' && fresh > 0
        ? '◈ CACHED'
        : !fresh ? '⚠ OFFLINE' : fresh < total ? '⚠ PARTIAL' : indicative ? '≈ QUOTE' : '⬡ QUOTES';
    }
  }

  function setNightStatus(data) {
    const orb = document.getElementById('nightOrb');
    const label = document.getElementById('nightLabel');
    if (!orb || !label) return;
    if (!data) {
      orb.className = 'status-orb off';
      label.textContent = 'NIGHT OFFLINE';
    } else if (data.stale) {
      orb.className = 'status-orb off';
      label.textContent = 'NIGHT STALE';
    } else if (data.delayed || data.warning || data.delivery === 'stale-kv') {
      orb.className = 'status-orb pre';
      label.textContent = data.delayed ? 'NIGHT DELAYED' : 'NIGHT CACHED';
    } else if (data.status === 'open') {
      orb.className = 'status-orb live';
      label.textContent = 'NIGHT LIVE';
    } else {
      orb.className = 'status-orb off';
      label.textContent = 'NIGHT CLOSED';
    }
  }

  // ═══════════════════════════════════════
  // INDICATOR LOAD PROMPT
  // ═══════════════════════════════════════
  function showIndicatorLoading(symbol, automatic = false) {
    const grid = document.getElementById('ind-grid');
    if (!grid) return;
    const symName = symbol.replace('.TW', '');
    grid.innerHTML = `
      <div class="ind-cell" style="grid-column:1/-1;text-align:center;padding:20px">
        <div style="color:var(--gold);font-size:13px;margin-bottom:8px">📊 技術指標 · ${symName}</div>
        <div class="loading-indicator">${automatic ? 'AUTO LOADING' : 'LOADING'} INDICATORS...</div>
        <div style="color:var(--dim);font-size:10px;margin-top:6px">行情顯示不受影響</div>
      </div>`;
  }

  function showIndicatorPrompt(symbol, message = '自動載入失敗') {
    const grid = document.getElementById('ind-grid');
    if (!grid) return;
    const symName = symbol.replace('.TW', '');
    grid.innerHTML = `
      <div class="ind-cell" style="grid-column:1/-1;text-align:center;padding:20px">
        <div style="color:var(--warn);font-size:13px;margin-bottom:8px">⚠ 技術指標 · ${symName}</div>
        <div style="color:var(--dim);font-size:10px;margin-bottom:8px">${message}</div>
        <button onclick="App.updateIndicators('${symbol}')" 
          style="background:rgba(255,119,68,0.12);border:1px solid var(--arc);color:var(--arc);
          padding:6px 20px;font-family:inherit;font-size:12px;cursor:pointer;letter-spacing:1px">
          🔄 重新載入
        </button>
      </div>`;
  }

  // ═══════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════
  return {
    // Rendering
    renderIndexCards,
    renderIndexSparklines,
    renderNightMarket,
    renderTicker,
    renderWatchlist,
    setWatchlistActiveSymbol,
    renderFeatured,
    renderIndicators,
    renderNews,
    renderSVGChart,

    showIndicatorLoading,
    showIndicatorPrompt,

    // Utilities
    showToast,
    setLoading,
    showError,
    setRefreshing,
    setConnecting,
    setDataStatus,

    // Helpers
    chgClass,
    chgArrow,
    pctStr,
    fmtPrice,
    fmtCurrency,
  };
})();
