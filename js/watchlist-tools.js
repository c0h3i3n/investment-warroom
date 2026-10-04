const WatchlistTools = (() => {
  function validateBackup(value) {
    if (!value || value.type !== 'warroom-watchlist' || value.version !== 1 || !Array.isArray(value.items)
      || value.items.length > 25) throw new Error('不是支援的自選股備份（最多 25 檔）');
    const seen = new Set();
    return value.items.map(item => {
      const symbol = typeof item?.symbol === 'string' ? item.symbol.toUpperCase() : '';
      if (!/^(?:\d{4,6}[A-Z]?\.TW|[A-Z][A-Z0-9.-]{0,14})$/.test(symbol)
        || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 30 || seen.has(symbol)) {
        throw new Error('備份包含不合法或重複的代號／名稱');
      }
      seen.add(symbol);
      return { symbol, name:item.name.trim(), region:symbol.endsWith('.TW') ? 'TW' : 'US' };
    });
  }
  function combine(existing, incoming, replace = false) {
    const result = replace ? [...incoming] : [...existing, ...incoming.filter(item => !existing.some(old => old.symbol === item.symbol))];
    if (result.length > 25) throw new Error('合併後超過 25 檔，請減少項目或選擇取代');
    return result;
  }
  function restoreRemoved(current, removed) {
    if (!removed || current.some(item => item.symbol === removed.item.symbol)) return current;
    if (current.length >= 25) throw new Error('自選股已達 25 檔，請先移除一檔');
    const result = [...current];
    result.splice(Math.min(removed.index, result.length), 0, removed.item);
    return result;
  }
  return { validateBackup, combine, restoreRemoved };
})();
