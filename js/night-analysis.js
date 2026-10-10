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

  // US confirmation must belong to the same US trading date as the TX quote.
  // A Taiwan holiday can leave TX closed while the US has another full session.
  function sameSession(night, index) {
    if (!finite(night?.asOf) || !finite(index?.asOf) || Number(night.asOf) <= 0 || Number(index.asOf) <= 0) return false;
    const date = timestamp => new Intl.DateTimeFormat('en-CA', {
      timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit',
    }).format(new Date(Number(timestamp)));
    return date(night.asOf) === date(index.asOf)
      && (night.status !== 'open' || Math.abs(Number(night.asOf) - Number(index.asOf)) <= 20 * 60000);
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
    const excluded = [];
    configs.forEach(config => {
      const item = indexes.find(index => index.symbol === config.symbol);
      if (!finite(item?.changePct) || item?.unavailable) return;
      if (!sameSession(night, item)) { excluded.push(config.label); return; }
      score += indexScore(item.changePct, config.threshold);
      drivers.push({ key: config.symbol, label: config.label, value: signed(item.changePct) });
    });

    const tone = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral';
    const label = tone === 'bullish' ? '偏多' : tone === 'bearish' ? '偏空' : '中性';
    return { label, tone, score, drivers, excluded, usable: true };
  }

  return { evaluate, sameSession };
})();
