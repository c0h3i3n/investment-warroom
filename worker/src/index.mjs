const SNAPSHOT_KEY = 'market:snapshot:v1';
const SNAPSHOT_MAX_AGE_MS = 7 * 60 * 1000;
const HISTORY_MAX_AGE_MS = 15 * 60 * 1000;
const HISTORY_FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOSED_MARKET_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

export const INDEXES = [
  { id: 'tai', symbol: '^TWII', misKey: 'tse_t00.tw', name: '加權指數 TAIEX', region: 'TW', currency: 'NT$', unit: 'PTS' },
  { id: 'otc', symbol: '^TWOII', misKey: 'otc_o00.tw', name: 'OTC 櫃買指數', region: 'TW', currency: 'NT$', unit: 'PTS' },
  { id: 'spx', symbol: '^GSPC', misKey: null, name: 'S&P 500', region: 'US', currency: '$', unit: 'PTS' },
  { id: 'ndx', symbol: '^IXIC', misKey: null, name: 'NASDAQ', region: 'US', currency: '$', unit: 'PTS' },
  { id: 'sox', symbol: '^SOX', misKey: null, name: '費城半導體 SOX', region: 'US', currency: '$', unit: 'PTS' },
];

export const QUOTE_SYMBOLS = [
  '0050.TW', '2330.TW', '00679B.TW', '00878.TW', '00929.TW',
  '00933B.TW', '00937B.TW', '009800.TW', 'SPCX', 'NVDA', 'TSLA',
];

const MARKET_SESSIONS = {
  TW: { timeZone: 'Asia/Taipei', open: 540, close: 810 },
  US: { timeZone: 'America/New_York', open: 570, close: 960 },
};
const OTC_YAHOO_MAP = {
  '00679B.TW': '00679B.TWO',
  '00933B.TW': '00933B.TWO',
  '00937B.TW': '00937B.TWO',
};
const OTC_YAHOO_REVERSE = Object.fromEntries(
  Object.entries(OTC_YAHOO_MAP).map(([original, yahoo]) => [yahoo, original]),
);
const OTC_CODES = new Set([
  '00679B', '00687B', '00712', '00713', '00751B', '00864B', '00933B',
  '00937B', '00942B', '00945B', '00948B', '00950B', '00951B', '00952B',
  '00953B', '00956B', '00957B', '00958B', '00959B', '00960B', '00961B',
  '00962B', '00963B', '00964B', '00965B',
]);
const ALLOWED_HISTORY_SYMBOLS = new Set([
  ...INDEXES.map(index => index.symbol),
  ...QUOTE_SYMBOLS,
]);
const ALLOWED_HISTORY_QUERIES = new Set([
  '6mo:1d',
  '3mo:1d',
  '1d:5m',
  '5d:60m',
]);

function marketParts(region, timestamp = Date.now()) {
  const session = MARKET_SESSIONS[region] || MARKET_SESSIONS.US;
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: session.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  const hour = Number(values.hour) === 24 ? 0 : Number(values.hour);
  return {
    ...values,
    minutes: hour * 60 + Number(values.minute),
    dayNumber: Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)),
  };
}

function isWeekday(parts) {
  return parts.weekday !== 'Sat' && parts.weekday !== 'Sun';
}

function marketOpen(region, nowMs) {
  const session = MARKET_SESSIONS[region] || MARKET_SESSIONS.US;
  const parts = marketParts(region, nowMs);
  return isWeekday(parts) && parts.minutes >= session.open && parts.minutes < session.close;
}

function weekdaysCrossed(sourceMs, nowMs, region) {
  const source = marketParts(region, sourceMs);
  const now = marketParts(region, nowMs);
  if (!Number.isFinite(source.dayNumber) || !Number.isFinite(now.dayNumber)
    || source.dayNumber > now.dayNumber) return Infinity;
  let weekdays = 0;
  for (let day = source.dayNumber + 86400000; day <= now.dayNumber; day += 86400000) {
    const weekday = new Date(day).getUTCDay();
    if (weekday >= 1 && weekday <= 5) weekdays += 1;
  }
  return weekdays;
}

export function isFreshTimestamp(timestamp, region, nowMs = Date.now()) {
  const sourceMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number(timestamp);
  if (!Number.isFinite(sourceMs) || sourceMs <= 0) return false;
  const age = nowMs - sourceMs;
  if (age < -5 * 60 * 1000) return false;
  if (marketOpen(region, nowMs)) return age <= 20 * 60 * 1000;
  if (age > CLOSED_MARKET_MAX_AGE_MS) return false;

  const session = MARKET_SESSIONS[region] || MARKET_SESSIONS.US;
  const sourceParts = marketParts(region, sourceMs);
  const nowParts = marketParts(region, nowMs);
  if (!isWeekday(sourceParts) || sourceParts.minutes < session.close - 60) return false;
  if (isWeekday(nowParts) && nowParts.minutes >= session.close
    && sourceParts.dayNumber !== nowParts.dayNumber) return false;
  return weekdaysCrossed(sourceMs, nowMs, region) <= 1;
}

function validRecord(record, region = record?.region, nowMs = Date.now()) {
  return Number.isFinite(Number(record?.price))
    && Number(record.price) > 0
    && isFreshTimestamp(record?.asOf, region, nowMs);
}

function parseMisTimestamp(row) {
  const milliseconds = Number(row?.tlong);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
  if (!/^\d{8}$/.test(row?.d || '') || !/^\d{2}:\d{2}:\d{2}$/.test(row?.t || '')) return null;
  return Date.parse(
    `${row.d.slice(0, 4)}-${row.d.slice(4, 6)}-${row.d.slice(6, 8)}T${row.t}+08:00`,
  );
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'investment-warroom-market/1.0',
      },
      cf: { cacheTtl: 0, cacheEverything: false },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function yahooRegion(symbol) {
  return symbol === '^TWII' || symbol === '^TWOII' || /\.TW$/i.test(symbol) ? 'TW' : 'US';
}

export async function fetchYahooQuote(symbol) {
  const yahooSymbol = OTC_YAHOO_MAP[symbol] || symbol;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`;
  const json = await fetchJson(url);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const originalSymbol = OTC_YAHOO_REVERSE[meta.symbol] || symbol;
  const price = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.previousClose ?? meta.chartPreviousClose);
  const asOf = Number(meta.regularMarketTime) * 1000;
  const region = yahooRegion(originalSymbol);
  const record = {
    symbol: originalSymbol,
    name: meta.shortName || meta.longName || meta.symbol || originalSymbol,
    price,
    change: Number.isFinite(previousClose) ? price - previousClose : null,
    changePct: Number.isFinite(previousClose) && previousClose > 0
      ? ((price - previousClose) / previousClose) * 100
      : null,
    prevClose: Number.isFinite(previousClose) ? previousClose : null,
    currency: meta.currency || (region === 'TW' ? 'TWD' : 'USD'),
    source: 'Yahoo Finance',
    asOf,
    priceType: 'trade',
    region,
  };
  return validRecord(record, region) ? record : null;
}

export async function fetchYahooHistory(symbol, range, interval) {
  if (!ALLOWED_HISTORY_SYMBOLS.has(symbol)
    || !ALLOWED_HISTORY_QUERIES.has(`${range}:${interval}`)) {
    throw new Error('Unsupported history query');
  }
  const yahooSymbol = OTC_YAHOO_MAP[symbol] || symbol;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const json = await fetchJson(url);
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !quote) throw new Error('No history data');
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
  const data = timestamps.map((timestamp, index) => ({
    time: Number(timestamp) * 1000,
    open: Number.isFinite(Number(quote.open?.[index])) ? Number(quote.open[index]) : null,
    high: Number.isFinite(Number(quote.high?.[index])) ? Number(quote.high[index]) : null,
    low: Number.isFinite(Number(quote.low?.[index])) ? Number(quote.low[index]) : null,
    close: Number.isFinite(Number(adjusted?.[index] ?? quote.close?.[index]))
      ? Number(adjusted?.[index] ?? quote.close[index])
      : null,
    volume: Number.isFinite(Number(quote.volume?.[index])) ? Number(quote.volume[index]) : null,
  })).filter(row => Number.isFinite(row.time) && row.time > 0 && Number.isFinite(row.close) && row.close > 0);
  if (data.length < 2) throw new Error('Insufficient history data');
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    symbol,
    range,
    interval,
    data,
    source: 'Yahoo Finance',
  };
}

function misKey(symbol) {
  const code = symbol.replace(/\.TW$/i, '');
  return `${OTC_CODES.has(code) ? 'otc' : 'tse'}_${code}.tw`;
}

function parseMisQuote(row) {
  if (!row?.c) return null;
  const previousClose = Number(row.y);
  let price = Number(row.z);
  let priceType = 'trade';
  if (!Number.isFinite(price) || price <= 0) {
    const bid = String(row.b || '').split('_').map(Number).find(value => value > 0);
    const ask = String(row.a || '').split('_').map(Number).find(value => value > 0);
    if (!bid || !ask) return null;
    price = (bid + ask) / 2;
    priceType = 'indicative';
  }
  const record = {
    symbol: `${row.c}.TW`,
    name: row.n || row.nf || row.c,
    price,
    change: Number.isFinite(previousClose) ? price - previousClose : null,
    changePct: Number.isFinite(previousClose) && previousClose > 0
      ? ((price - previousClose) / previousClose) * 100
      : null,
    prevClose: Number.isFinite(previousClose) ? previousClose : null,
    currency: 'TWD',
    source: 'TWSE MIS',
    asOf: parseMisTimestamp(row),
    priceType,
    region: 'TW',
  };
  return validRecord(record, 'TW') ? record : null;
}

function parseMisIndex(row, config) {
  let price = Number(row?.z);
  if (!Number.isFinite(price) || price <= 0) return null;
  const previousClose = Number(row.y);
  const record = {
    ...config,
    price,
    change: Number.isFinite(previousClose) ? price - previousClose : null,
    changePct: Number.isFinite(previousClose) && previousClose > 0
      ? ((price - previousClose) / previousClose) * 100
      : null,
    prevClose: Number.isFinite(previousClose) ? previousClose : null,
    source: 'TWSE MIS',
    asOf: parseMisTimestamp(row),
    priceType: 'trade',
  };
  return validRecord(record, 'TW') ? record : null;
}

export async function fetchMisBatch(quoteSymbols) {
  const keys = [
    ...INDEXES.filter(index => index.misKey).map(index => index.misKey),
    ...quoteSymbols.filter(symbol => /\.TW$/i.test(symbol)).map(misKey),
  ];
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(keys.join('|'))}&json=1&delay=0&_=${Date.now()}`;
  const json = await fetchJson(url);
  const rows = Array.isArray(json?.msgArray) ? json.msgArray : [];
  const indexes = INDEXES.filter(index => index.misKey).map(config => {
    const code = config.misKey.replace(/^.*_/, '').replace(/\.tw$/i, '');
    const row = rows.find(item => item.c === code || item.ch === config.misKey.replace(/^.*_/, ''));
    return row ? parseMisIndex(row, config) : null;
  }).filter(Boolean);
  const quotes = rows.map(parseMisQuote).filter(record => (
    record && quoteSymbols.includes(record.symbol)
  ));
  return { indexes, quotes };
}

function withIndexConfig(record) {
  const config = INDEXES.find(index => index.symbol === record?.symbol);
  return config ? { ...config, ...record } : null;
}

export async function buildSnapshot() {
  const yahooSymbols = [...INDEXES.map(index => index.symbol), ...QUOTE_SYMBOLS];
  const [misResult, yahooSettled] = await Promise.all([
    fetchMisBatch(QUOTE_SYMBOLS).catch(() => ({ indexes: [], quotes: [] })),
    Promise.allSettled(yahooSymbols.map(fetchYahooQuote)),
  ]);
  const yahoo = yahooSettled
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value);
  const yahooMap = new Map(yahoo.map(record => [record.symbol, record]));
  const misIndexMap = new Map(misResult.indexes.map(record => [record.symbol, record]));
  const misQuoteMap = new Map(misResult.quotes.map(record => [record.symbol, record]));

  const indexes = INDEXES.map(config => {
    const preferred = misIndexMap.get(config.symbol) || yahooMap.get(config.symbol);
    return preferred ? withIndexConfig(preferred) : null;
  }).filter(Boolean);
  const quotes = QUOTE_SYMBOLS.map(symbol => (
    misQuoteMap.get(symbol) || yahooMap.get(symbol) || null
  )).filter(Boolean);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    indexes,
    quotes,
    valid: {
      indexes: indexes.length,
      quotes: quotes.length,
      totalIndexes: INDEXES.length,
      totalQuotes: QUOTE_SYMBOLS.length,
    },
    source: 'warroom-market-worker',
  };
}

function acceptableSnapshot(snapshot) {
  return snapshot?.valid?.indexes >= 3 && snapshot?.valid?.quotes >= 5;
}

function newestFreshRecord(current, cached, region, nowMs) {
  const candidates = [current, cached]
    .filter(record => validRecord(record, region || record?.region, nowMs));
  return candidates.reduce((newest, record) => {
    if (!newest) return record;
    const newestTime = typeof newest.asOf === 'string' ? Date.parse(newest.asOf) : Number(newest.asOf);
    const recordTime = typeof record.asOf === 'string' ? Date.parse(record.asOf) : Number(record.asOf);
    return recordTime > newestTime ? record : newest;
  }, null);
}

export function mergeSnapshotWithCache(snapshot, cached, nowMs = Date.now()) {
  if (!cached) return snapshot;
  const currentIndexes = new Map((snapshot?.indexes || []).map(record => [record.symbol, record]));
  const cachedIndexes = new Map((cached?.indexes || []).map(record => [record.symbol, record]));
  const currentQuotes = new Map((snapshot?.quotes || []).map(record => [record.symbol, record]));
  const cachedQuotes = new Map((cached?.quotes || []).map(record => [record.symbol, record]));

  const indexes = INDEXES.map(config => newestFreshRecord(
    currentIndexes.get(config.symbol),
    cachedIndexes.get(config.symbol),
    config.region,
    nowMs,
  )).filter(Boolean);
  const quotes = QUOTE_SYMBOLS.map(symbol => newestFreshRecord(
    currentQuotes.get(symbol),
    cachedQuotes.get(symbol),
    yahooRegion(symbol),
    nowMs,
  )).filter(Boolean);

  return {
    ...snapshot,
    indexes,
    quotes,
    valid: {
      indexes: indexes.length,
      quotes: quotes.length,
      totalIndexes: INDEXES.length,
      totalQuotes: QUOTE_SYMBOLS.length,
    },
  };
}

async function readCached(env) {
  if (!env?.MARKET_CACHE) return null;
  return env.MARKET_CACHE.get(SNAPSHOT_KEY, { type: 'json' });
}

async function refreshAndStore(env) {
  const [snapshot, cached] = await Promise.all([
    buildSnapshot(),
    readCached(env).catch(() => null),
  ]);
  const merged = mergeSnapshotWithCache(snapshot, cached);
  if (acceptableSnapshot(merged) && env?.MARKET_CACHE) {
    await env.MARKET_CACHE.put(SNAPSHOT_KEY, JSON.stringify(merged));
  }
  return merged;
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = origin === 'https://c0h3i3n.github.io'
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? origin
    : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function jsonResponse(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  });
}

async function handleHistoryRequest(request, env, url) {
  const symbol = String(url.searchParams.get('symbol') || '').toUpperCase();
  const range = String(url.searchParams.get('range') || '');
  const interval = String(url.searchParams.get('interval') || '');
  if (!ALLOWED_HISTORY_SYMBOLS.has(symbol)
    || !ALLOWED_HISTORY_QUERIES.has(`${range}:${interval}`)) {
    return jsonResponse({ error: 'Unsupported history query' }, 400, request);
  }

  const key = `market:history:v1:${symbol}:${range}:${interval}`;
  const cached = env?.MARKET_CACHE
    ? await env.MARKET_CACHE.get(key, { type: 'json' }).catch(() => null)
    : null;
  const cachedAt = Date.parse(cached?.generatedAt || '');
  const cacheAgeMs = Number.isFinite(cachedAt) ? Math.max(0, Date.now() - cachedAt) : Infinity;
  if (cached && cacheAgeMs <= HISTORY_MAX_AGE_MS) {
    return jsonResponse({ ...cached, delivery: 'kv' }, 200, request);
  }

  try {
    const fresh = await fetchYahooHistory(symbol, range, interval);
    if (env?.MARKET_CACHE) {
      await env.MARKET_CACHE.put(key, JSON.stringify(fresh), { expirationTtl: 86400 });
    }
    return jsonResponse({ ...fresh, delivery: 'live' }, 200, request);
  } catch (error) {
    console.error('History refresh failed', error);
    if (cached && cacheAgeMs <= HISTORY_FALLBACK_MAX_AGE_MS) {
      return jsonResponse({ ...cached, delivery: 'stale-kv', warning: 'Refresh failed' }, 200, request);
    }
    return jsonResponse({ error: 'History data unavailable' }, 503, request);
  }
}

export async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, request);

  const url = new URL(request.url);
  if (url.pathname === '/api/history') {
    return handleHistoryRequest(request, env, url);
  }
  if (!['/api/market', '/health'].includes(url.pathname)) {
    return jsonResponse({ error: 'Not found' }, 404, request);
  }

  const cached = await readCached(env).catch(() => null);
  const cachedAt = Date.parse(cached?.generatedAt || '');
  const cacheAgeMs = Number.isFinite(cachedAt) ? Math.max(0, Date.now() - cachedAt) : null;
  if (url.pathname === '/health') {
    return jsonResponse({
      ok: Boolean(cached),
      cacheAgeMs,
      generatedAt: cached?.generatedAt || null,
      valid: cached?.valid || null,
    }, cached ? 200 : 503, request);
  }

  if (cached && cacheAgeMs <= SNAPSHOT_MAX_AGE_MS) {
    return jsonResponse({ ...cached, delivery: 'kv' }, 200, request);
  }

  try {
    const fresh = await refreshAndStore(env);
    if (acceptableSnapshot(fresh) || !cached) {
      return jsonResponse({ ...fresh, delivery: 'live' }, acceptableSnapshot(fresh) ? 200 : 206, request);
    }
  } catch (error) {
    console.error('Market refresh failed', error);
  }

  if (cached) {
    return jsonResponse({ ...cached, delivery: 'stale-kv', warning: 'Refresh failed' }, 200, request);
  }
  return jsonResponse({ error: 'Market data unavailable' }, 503, request);
}

export default {
  fetch: handleRequest,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshAndStore(env).catch(error => console.error('Scheduled refresh failed', error)));
  },
};
