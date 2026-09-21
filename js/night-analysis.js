// Night-session risk synthesis. This is a market-risk summary, not a forecast.
globalThis.NightAnalysis = (() => {
  function finite(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }

  function signed(value) {
    const number = Number(value);
    return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
  }

  function futuresScore(changePct) {
    const value = Number(changePct);
    const direction = Math.sign(value);
    const magnitude = Math.abs(value);
    if (magnitude >= 1) return direction * 3;
    if (magnitude >= 0.5) return direction * 2;
    if (magnitude >= 0.15) return direction;
    return 0;
  }

  function indexScore(changePct, threshold) {
    const value = Number(changePct);
    return Math.abs(value) >= threshold ? Math.sign(value) : 0;
  }

  function evaluate(night, indexes = []) {
    if (!night || night.stale || !finite(night.price) || !finite(night.changePct)) {
      return { label: '資料不足', tone: 'unknown', score: null, drivers: [], usable: false };
    }

    let score = futuresScore(night.changePct);
    const drivers = [{ key: 'TX', label: '台指期', value: signed(night.changePct) }];
    const configs = [
      { symbol: '^GSPC', label: 'S&P 500', threshold: 0.25 },
      { symbol: '^IXIC', label: 'NASDAQ', threshold: 0.25 },
      { symbol: '^SOX', label: '費半', threshold: 0.4 },
    ];
    configs.forEach(config => {
      const item = indexes.find(index => index.symbol === config.symbol);
      if (!finite(item?.changePct) || item?.unavailable) return;
      score += indexScore(item.changePct, config.threshold);
      drivers.push({ key: config.symbol, label: config.label, value: signed(item.changePct) });
    });

    const tone = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral';
    const label = tone === 'bullish' ? '偏多' : tone === 'bearish' ? '偏空' : '中性';
    return { label, tone, score, drivers, usable: true };
  }

  return { evaluate };
})();
