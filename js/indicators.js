// ═══════════════════════════════════════
// J.A.R.V.I.S · TECHNICAL INDICATORS
// Self-contained (no CDN dependency)
// ═══════════════════════════════════════

const IndicatorsService = (() => {

  // ── Extract arrays from OHLCV data ──
  function getCloses(data) { return data.map(d => d.close).filter(v => v != null); }
  function getHighs(data)  { return data.map(d => d.high).filter(v => v != null); }
  function getLows(data)   { return data.map(d => d.low).filter(v => v != null); }
  function getVolumes(data){ return data.map(d => d.volume).filter(v => v != null); }

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
  // Average Volume
  // ═══════════════════════════════════════
  function calcAvgVolume(volumes, period = 20) {
    if (volumes.length < period) return null;
    return Math.round(volumes.slice(-period).reduce((a, b) => a + b, 0) / period);
  }

  // ═══════════════════════════════════════
  // Interpret indicators
  // ═══════════════════════════════════════
  function interpret(rsi, macd, stoch, ma20, ma60, currentPrice, avgVol, latestVol) {
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

    if (avgVol !== null && latestVol !== null) {
      const ratio = latestVol / avgVol;
      let signal, color;
      if (ratio > 1.5) { signal = 'SURGE ↑↑'; color = 'vol'; }
      else if (ratio > 1.0) { signal = 'ABOVE AVG ↑'; color = 'up'; }
      else if (ratio > 0.5) { signal = 'BELOW AVG ↓'; color = 'dn'; }
      else { signal = 'DRY UP ↓↓'; color = 'warn'; }
      results.push({ name: 'VOL', value: formatVolume(latestVol), signal, color });
    }

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
    const volumes = getVolumes(data);

    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const stoch = calcStochastic(highs, lows, closes);
    const ma20 = calcSMA(closes, 20);
    const ma60 = calcSMA(closes, 60);
    const avgVol = calcAvgVolume(volumes);
    const latestVol = volumes[volumes.length - 1];

    return {
      symbol,
      indicators: interpret(rsi, macd, stoch, ma20, ma60, currentPrice, avgVol, latestVol),
      chartData: data.slice(-60),
    };
  }

  // ═══════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════
  return { calculateFor, calcSMA };
})();
