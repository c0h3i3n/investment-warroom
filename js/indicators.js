// ═══════════════════════════════════════
// J.A.R.V.I.S · TECHNICAL INDICATORS
// Using technicalindicators.js (CDN)
// ═══════════════════════════════════════

const IndicatorsService = (() => {

  // ── Check if library is loaded ──
  function isReady() {
    return typeof window.technicalindicators !== 'undefined';
  }

  // ── Extract close prices from OHLCV data ──
  function getCloses(data) {
    return data.map(d => d.close).filter(v => v != null);
  }

  function getHighs(data) {
    return data.map(d => d.high).filter(v => v != null);
  }

  function getLows(data) {
    return data.map(d => d.low).filter(v => v != null);
  }

  function getVolumes(data) {
    return data.map(d => d.volume).filter(v => v != null);
  }

  // ── RSI (14) ──
  function calcRSI(closes, period = 14) {
    if (!isReady() || closes.length < period + 1) return null;
    try {
      const input = { values: closes, period };
      const result = window.technicalindicators.rsi(input);
      return result[result.length - 1]; // latest value
    } catch (e) {
      console.error('RSI calc error:', e);
      return null;
    }
  }

  // ── MACD (12, 26, 9) ──
  function calcMACD(closes) {
    if (!isReady() || closes.length < 35) return null;
    try {
      const input = {
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      };
      const result = window.technicalindicators.macd(input);
      const latest = result[result.length - 1];
      return {
        macd: latest.MACD,
        signal: latest.signal,
        histogram: latest.histogram,
        cross: latest.histogram > 0 ? 'bullish' : 'bearish',
      };
    } catch (e) {
      console.error('MACD calc error:', e);
      return null;
    }
  }

  // ── Stochastic (KD) 9,3,3 ──
  function calcStochastic(highs, lows, closes) {
    if (!isReady() || closes.length < 15) return null;
    try {
      const input = {
        high: highs,
        low: lows,
        close: closes,
        period: 9,
        signalPeriod: 3,
      };
      const result = window.technicalindicators.stochastic(input);
      const latest = result[result.length - 1];
      return {
        k: latest.k,
        d: latest.d,
      };
    } catch (e) {
      console.error('Stochastic calc error:', e);
      return null;
    }
  }

  // ── Simple Moving Average ──
  function calcSMA(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  // ── Average Volume (20-day) ──
  function calcAvgVolume(volumes, period = 20) {
    if (volumes.length < period) return null;
    const slice = volumes.slice(-period);
    return Math.round(slice.reduce((a, b) => a + b, 0) / period);
  }

  // ── Interpret indicators ──
  function interpret(rsi, macd, stoch, ma20, ma60, currentPrice, avgVol, latestVol) {
    const results = [];

    // RSI interpretation
    if (rsi !== null) {
      let signal, color;
      if (rsi > 70) { signal = 'OVERBOUGHT ⚠'; color = 'warn'; }
      else if (rsi < 30) { signal = 'OVERSOLD ▼'; color = 'up'; }
      else if (rsi > 50) { signal = 'BULLISH ▲'; color = 'up'; }
      else { signal = 'BEARISH ▼'; color = 'dn'; }
      results.push({ name: 'RSI · 14', value: rsi.toFixed(1), signal, color });
    }

    // KD interpretation
    if (stoch) {
      let signal, color;
      if (stoch.k > 80) { signal = 'OVERBOUGHT ⚠'; color = 'warn'; }
      else if (stoch.k < 20) { signal = 'OVERSOLD ▼'; color = 'up'; }
      else if (stoch.k > stoch.d) { signal = 'BULLISH ▲'; color = 'up'; }
      else { signal = 'BEARISH ▼'; color = 'dn'; }
      results.push({ name: 'KD · K值', value: stoch.k.toFixed(1), signal, color });
    }

    // MACD interpretation
    if (macd) {
      let signal, color;
      if (macd.cross === 'bullish' && macd.histogram > 0) {
        signal = 'CROSS ↑'; color = 'up';
      } else if (macd.cross === 'bearish') {
        signal = 'CROSS ↓'; color = 'dn';
      } else {
        signal = 'FLAT —'; color = 'warn';
      }
      results.push({ name: 'MACD', value: macd.macd.toFixed(2), signal, color });
    }

    // MA20
    if (ma20 !== null && currentPrice) {
      const above = currentPrice > ma20;
      results.push({
        name: 'MA · 20',
        value: ma20.toFixed(1),
        signal: above ? 'ABOVE ✓' : 'BELOW ✗',
        color: above ? 'up' : 'dn',
      });
    }

    // MA60
    if (ma60 !== null && currentPrice) {
      const above = currentPrice > ma60;
      results.push({
        name: 'MA · 60',
        value: ma60.toFixed(1),
        signal: above ? 'ABOVE ✓' : 'BELOW ✗',
        color: above ? 'up' : 'dn',
      });
    }

    // Volume
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

  // ── Calculate all indicators for a symbol ──
  async function calculateFor(symbol, currentPrice) {
    const data = await DataService.fetchHistorical(symbol, '6mo', '1d');
    if (!data || data.length < 60) {
      console.warn(`Not enough historical data for ${symbol}`);
      return null;
    }

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
      chartData: data.slice(-60), // last 60 days for mini chart
    };
  }

  // ── Public API ──
  return {
    isReady,
    calculateFor,
    calcSMA,
  };
})();
