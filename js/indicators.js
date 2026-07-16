// ═══════════════════════════════════════
// J.A.R.V.I.S · TECHNICAL INDICATORS
// Self-contained (no CDN dependency)
// ═══════════════════════════════════════

const IndicatorsService = (() => {

  // ── Extract arrays from OHLCV data ──
  function getCloses(data) { return data.map(d => d.close).filter(v => v != null); }
  function getHighs(data)  { return data.map(d => d.high).filter(v => v != null); }
  function getLows(data)   { return data.map(d => d.low).filter(v => v != null); }

  // ═══════════════════════════════════════
  // RSI (Relative Strength Index)
  // ═══════════════════════════════════════
  function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;
    const gains = [], losses = [];
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    if (avgLoss === 0) return 100;
    let rsi = 100 - (100 / (1 + avgGain / avgLoss));
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      if (avgLoss === 0) { rsi = 100; continue; }
      rsi = 100 - (100 / (1 + avgGain / avgLoss));
    }
    return isNaN(rsi) ? null : rsi;
  }

  // ═══════════════════════════════════════
  // EMA (Exponential Moving Average)
  // ═══════════════════════════════════════
  function calcEMA(data, period) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  // ═══════════════════════════════════════
  // MACD
  // ═══════════════════════════════════════
  function calcMACD(closes) {
    if (closes.length < 35) return null;
    const ema12 = calcEMASeries(closes, 12);
    const ema26 = calcEMASeries(closes, 26);
    // Align: ema12 has 14 more elements than ema26 — slice to match
    const offset = ema12.length - ema26.length;
    const macdLine = ema12.slice(offset).map((v, i) => v - ema26[i]);
    if (macdLine.length < 9) return null;
    const signal = calcEMASeries(macdLine, 9);
    const lastMacd = macdLine[macdLine.length - 1];
    const lastSignal = signal[signal.length - 1];
    const histogram = lastMacd - lastSignal;
    if (isNaN(lastMacd) || isNaN(lastSignal)) return null;
    return {
      macd: lastMacd,
      signal: lastSignal,
      histogram: histogram,
      cross: histogram > 0 ? 'bullish' : 'bearish',
    };
  }

  function calcEMASeries(data, period) {
    const k = 2 / (period + 1);
    const result = [];
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(ema);
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
      result.push(ema);
    }
    return result;
  }

  // ═══════════════════════════════════════
  // Stochastic (KD)
  // ═══════════════════════════════════════
  function calcStochastic(highs, lows, closes, period = 9, kPeriod = 3) {
    if (closes.length < period) return null;
    const kValues = [];
    for (let i = period - 1; i < closes.length; i++) {
      const sliceHigh = highs.slice(i - period + 1, i + 1);
      const sliceLow = lows.slice(i - period + 1, i + 1);
      const maxH = Math.max(...sliceHigh);
      const minL = Math.min(...sliceLow);
      const range = maxH - minL;
      kValues.push(range === 0 ? 50 : ((closes[i] - minL) / range) * 100);
    }
    const dValues = [];
    for (let i = kPeriod - 1; i < kValues.length; i++) {
      dValues.push(kValues.slice(i - kPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / kPeriod);
    }
    const k = kValues[kValues.length - 1];
    const d = dValues[dValues.length - 1];
    if (isNaN(k) || isNaN(d)) return null;
    return { k, d };
  }

  // ═══════════════════════════════════════
  // SMA (Simple Moving Average)
  // ═══════════════════════════════════════
  function calcSMA(closes, period) {
    if (closes.length < period) return null;
    return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  // ═══════════════════════════════════════
  // Volume pace (compare an intraday candle with the expected volume so far)
  // ═══════════════════════════════════════
  const MARKET_SESSIONS = {
    TW: { timeZone: 'Asia/Taipei', open: 9 * 60, close: 13 * 60 + 30 },
    US: { timeZone: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
  };
  const VOLUME_WARMUP_MINUTES = 30;

  function zonedTimeParts(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const hour = Number(values.hour) === 24 ? 0 : Number(values.hour);
    return {
      dateKey: `${values.year}-${values.month}-${values.day}`,
      weekday: values.weekday,
      minutes: hour * 60 + Number(values.minute),
    };
  }

  function classifyVolumeRatio(ratio, allowDryUp = true, reference = 'PACE') {
    if (ratio >= 1.5) return { label: 'SURGE ↑↑', color: 'up' };
    if (ratio >= 1.1) return { label: `ABOVE ${reference} ↑`, color: 'up' };
    if (ratio >= 0.8) return { label: `ON ${reference} —`, color: 'arc' };
    if (ratio >= 0.5 || !allowDryUp) return { label: `BELOW ${reference} ↓`, color: 'warn' };
    return { label: 'DRY UP ↓↓', color: 'warn' };
  }

  function analyzeVolume(data, symbol, nowMs = Date.now()) {
    if (!Array.isArray(data)) return null;

    // Preserve candle timestamps: filtering a standalone volume array can make
    // a previous day's volume look like today's when the latest value is null.
    const rows = data.map(row => ({
      time: row?.time == null ? NaN : (typeof row.time === 'string' ? Date.parse(row.time) : Number(row.time)),
      volume: row?.volume == null || row.volume === '' ? NaN : Number(row.volume),
    })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.volume) && row.volume >= 0)
      .sort((a, b) => a.time - b.time);

    // The latest row is the comparison day, so its (possibly partial) volume
    // must never be included in the 20 completed-session baseline.
    if (rows.length < 21) return null;
    const latest = rows[rows.length - 1];
    const baseline = rows.slice(0, -1).slice(-20);
    const avgVolume = baseline.reduce((sum, row) => sum + row.volume, 0) / baseline.length;
    if (!Number.isFinite(avgVolume) || avgVolume <= 0) return null;

    const market = /\.TW$/i.test(symbol || '') || /^\^TW/i.test(symbol || '') ? 'TW' : 'US';
    const session = MARKET_SESSIONS[market];
    const parsedNow = nowMs instanceof Date ? nowMs.getTime() : Number(nowMs);
    const effectiveNow = Number.isFinite(parsedNow) ? parsedNow : Date.now();
    const now = zonedTimeParts(effectiveNow, session.timeZone);
    const candle = zonedTimeParts(latest.time, session.timeZone);
    const weekday = !['Sat', 'Sun'].includes(now.weekday);
    const latestIsToday = candle.dateKey === now.dateKey;
    const marketOpen = weekday && now.minutes >= session.open && now.minutes < session.close;
    const intraday = marketOpen && latestIsToday;

    let mode;
    let progress = 1;
    let ratio = latest.volume / avgVolume;
    let name;
    let signal;
    let color;

    if (intraday) {
      const elapsedMinutes = now.minutes - session.open;
      progress = Math.min(1, Math.max(0, elapsedMinutes / (session.close - session.open)));
      name = `VOL · ${Math.round(progress * 100)}% DAY`;

      if (elapsedMinutes < VOLUME_WARMUP_MINUTES) {
        mode = 'building';
        ratio = null;
        signal = 'BUILDING DATA';
        color = 'arc';
      } else {
        mode = 'pace';
        ratio = latest.volume / (avgVolume * progress);
        const classification = classifyVolumeRatio(ratio, progress >= 0.5);
        signal = `PACE ${Math.round(ratio * 100)}% · ${classification.label}`;
        color = classification.color;
      }
    } else {
      const closedToday = weekday && latestIsToday && now.minutes >= session.close;
      mode = closedToday ? 'close' : 'last';
      name = closedToday ? 'VOL · CLOSE' : 'VOL · LAST';
      const classification = classifyVolumeRatio(ratio, true, 'AVG');
      signal = `20D ${Math.round(ratio * 100)}% · ${classification.label}`;
      color = classification.color;
    }

    return {
      name,
      value: formatVolume(latest.volume),
      signal,
      color,
      mode,
      progress,
      ratio,
      latestVolume: latest.volume,
      avgVolume,
    };
  }

  // ═══════════════════════════════════════
  // Interpret indicators
  // ═══════════════════════════════════════
  function interpret(rsi, macd, stoch, ma20, ma60, currentPrice, volumeIndicator) {
    const results = [];

    if (rsi !== null) {
      let signal, color;
      if (rsi > 70) { signal = 'OVERBOUGHT ⚠'; color = 'warn'; }
      else if (rsi < 30) { signal = 'OVERSOLD ▼'; color = 'up'; }
      else if (rsi > 50) { signal = 'BULLISH ▲'; color = 'up'; }
      else { signal = 'BEARISH ▼'; color = 'dn'; }
      results.push({ name: 'RSI · 14', value: rsi.toFixed(1), signal, color });
    }

    if (stoch) {
      let signal, color;
      if (stoch.k > 80) { signal = 'OVERBOUGHT ⚠'; color = 'warn'; }
      else if (stoch.k < 20) { signal = 'OVERSOLD ▼'; color = 'up'; }
      else if (stoch.k > stoch.d) { signal = 'BULLISH ▲'; color = 'up'; }
      else { signal = 'BEARISH ▼'; color = 'dn'; }
      results.push({ name: 'KD · K值', value: stoch.k.toFixed(1), signal, color });
    }

    if (macd) {
      let signal, color;
      if (macd.cross === 'bullish' && macd.histogram > 0) { signal = 'CROSS ↑'; color = 'up'; }
      else if (macd.cross === 'bearish') { signal = 'CROSS ↓'; color = 'dn'; }
      else { signal = 'FLAT —'; color = 'warn'; }
      results.push({ name: 'MACD', value: macd.macd.toFixed(2), signal, color });
    }

    if (ma20 !== null && currentPrice) {
      const above = currentPrice > ma20;
      results.push({ name: 'MA · 20', value: ma20.toFixed(1), signal: above ? 'ABOVE ✓' : 'BELOW ✗', color: above ? 'up' : 'dn' });
    }

    if (ma60 !== null && currentPrice) {
      const above = currentPrice > ma60;
      results.push({ name: 'MA · 60', value: ma60.toFixed(1), signal: above ? 'ABOVE ✓' : 'BELOW ✗', color: above ? 'up' : 'dn' });
    }

    if (volumeIndicator) results.push(volumeIndicator);

    return results;
  }

  function formatVolume(vol) {
    if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M';
    if (vol >= 1e3) return (vol / 1e3).toFixed(0) + 'K';
    return String(vol);
  }

  // ═══════════════════════════════════════
  // Calculate all indicators
  // ═══════════════════════════════════════
  async function calculateFor(symbol, currentPrice) {
    console.log('[Indicators] Fetching historical data for', symbol);
    const data = await DataService.fetchHistorical(symbol, '6mo', '1d');
    if (!data) {
      console.warn('[Indicators] fetchHistorical returned null');
      return { error: 'API 逾時或代理失敗' };
    }
    if (data.length < 60) {
      console.warn('[Indicators] Not enough data:', data.length);
      return { error: `歷史資料不足 (${data.length}筆，需60筆)` };
    }
    console.log('[Indicators] Got', data.length, 'points, calculating...');

    const closes = getCloses(data);
    const highs = getHighs(data);
    const lows = getLows(data);
    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const stoch = calcStochastic(highs, lows, closes);
    const ma20 = calcSMA(closes, 20);
    const ma60 = calcSMA(closes, 60);
    const volumeIndicator = analyzeVolume(data, symbol);

    return {
      symbol,
      indicators: interpret(rsi, macd, stoch, ma20, ma60, currentPrice, volumeIndicator),
      chartData: data.slice(-60),
    };
  }

  // ═══════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════
  return { calculateFor, calcSMA, analyzeVolume };
})();
