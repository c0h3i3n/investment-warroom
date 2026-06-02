// ═══════════════════════════════════════
// J.A.R.V.I.S · WARROOM CONFIGURATION v3.1
// ═══════════════════════════════════════

const CONFIG = {
  // ── CORS Proxies (tried in order) ──
  CORS_PROXIES: [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://cors-anywhere.herokuapp.com/',
  ],

  // ── Yahoo Finance API Endpoints ──
  YAHOO_CHART: 'https://query1.finance.yahoo.com/v8/finance/chart/',
  YAHOO_QUOTE: 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=',

  // ── TWSE MIS API (real-time Taiwan stocks) ──
  MIS_BASE: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp',

  // ── RSS Feeds ──
  RSS_FEEDS: [
    { name: '鉅亨網', url: 'https://news.cnyes.com/express/rss', region: 'TW' },
    { name: 'MoneyDJ', url: 'https://www.moneydj.com/rss/shownews.aspx?type=1', region: 'TW' },
  ],

  // ── Market Hours (Taipei time, minutes from midnight) ──
  TW_OPEN:  540,
  TW_CLOSE: 810,
  US_PRE:   960,
  US_OPEN:  1290,
  US_CLOSE: 1440,

  // ── Major Indexes ──
  INDEXES: [
    { id: 'tai', symbol: '^TWII',   misKey: 'tse_t00.tw', name: '加權指數 TAIEX',    region: 'TW', currency: 'NT$' },
    { id: 'otc', symbol: '^TWOII',  misKey: 'otc_o00.tw', name: 'OTC 櫃買指數',      region: 'TW', currency: 'NT$' },
    { id: 'spx', symbol: '^GSPC',   misKey: null,         name: 'S&P 500',           region: 'US', currency: '$'   },
    { id: 'ndx', symbol: '^IXIC',   misKey: null,         name: 'NASDAQ',            region: 'US', currency: '$'   },
    { id: 'sox', symbol: '^SOX',    misKey: null,         name: '費城半導體 SOX',    region: 'US', currency: '$'   },
  ],

  // ── Default Watchlist ──
  DEFAULT_WATCHLIST: [
    { symbol: '0050.TW',   name: '元大台灣50',          region: 'TW' },
    { symbol: '00679B.TW', name: '元大美債20年',        region: 'TW' },
    { symbol: '00878.TW',  name: '國泰永續高股息',      region: 'TW' },
    { symbol: '00929.TW',  name: '復華台灣科技優息',    region: 'TW' },
    { symbol: '00933B.TW', name: '國泰10Y+金融債',      region: 'TW' },
    { symbol: '00937B.TW', name: '群益ESG投等債20+',    region: 'TW' },
    { symbol: '2330.TW',   name: '台積電',              region: 'TW' },
    { symbol: 'NVDA',      name: '輝達',                region: 'US' },
    { symbol: 'TSLA',      name: '特斯拉',              region: 'US' },
  ],

  // ── Default Portfolio Holdings ──
  DEFAULT_HOLDINGS: [
    { symbol: '0050.TW',   name: '元大台灣50',          shares: 0, cost: 0, region: 'TW' },
    { symbol: '00679B.TW', name: '元大美債20年',        shares: 0, cost: 0, region: 'TW' },
    { symbol: '00878.TW',  name: '國泰永續高股息',      shares: 0, cost: 0, region: 'TW' },
    { symbol: '00929.TW',  name: '復華台灣科技優息',    shares: 0, cost: 0, region: 'TW' },
    { symbol: '00933B.TW', name: '國泰10Y+金融債',      shares: 0, cost: 0, region: 'TW' },
    { symbol: '00937B.TW', name: '群益ESG投等債20+',    shares: 0, cost: 0, region: 'TW' },
    { symbol: '2330.TW',   name: '台積電',              shares: 0, cost: 0, region: 'TW' },
  ],

  // ── Refresh intervals (ms) ──
  REFRESH_QUOTES:      60000,
  REFRESH_INDEXES:     60000,
  REFRESH_NEWS:       300000,
  REFRESH_INDICATORS: 300000,
};
