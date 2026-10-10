// ═══════════════════════════════════════
// J.A.R.V.I.S · NEWS INTELLIGENCE FEED
// RSS via rss2json.com (no CORS issues)
// ═══════════════════════════════════════

const NewsService = (() => {

  const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  function decodeHeadline(value) {
    const named = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };
    let result = String(value || '');
    for (let pass = 0; pass < 2; pass += 1) {
      const decoded = result.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
        const lower = entity.toLowerCase();
        if (lower in named) return named[lower];
        const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        return code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
      });
      if (decoded === result) break;
      result = decoded;
    }
    return result;
  }

  function prepareNews(items, watchlist = []) {
    const aliases = {
      '2330.TW':['台積電','TSMC'], '0050.TW':['0050','台灣50'],
      NVDA:['輝達','NVIDIA'], TSLA:['特斯拉','TESLA'], SPCX:['SPACEX','太空探索'],
    };
    const matches = (title, term) => {
      if (/^[A-Z0-9.]+$/i.test(term)) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, 'i').test(title);
      }
      return term.length >= 2 && title.includes(term);
    };
    const classify = title => {
      if (/加密|虛擬貨幣|比特幣|以太|區塊鏈|\b(BTC|ETH|FET|AXS|GLMR|SAND|SuperVerse|LayerZero)\b/i.test(title)) return 'CRYPTO';
      if (/台股|臺股|台積電|TSMC|0050|台灣50|鴻海|聯發科|聯電|櫃買|金管會/i.test(title)) return 'TW';
      if (/美股|華爾街|那斯達克|NASDAQ|S&P|道瓊|輝達|NVIDIA|特斯拉|TESLA|SPACEX|蘋果|APPLE/i.test(title)) return 'US';
      return 'INTL';
    };
    const sorted = (Array.isArray(items) ? items : []).filter(n => n && typeof n.headline === 'string')
      .map(n => {
        const headline = decodeHeadline(n.headline);
        const categories = Array.isArray(n.categories) ? n.categories.filter(c => typeof c === 'string').join(' ') : '';
        const sourceCategory = /加密|虛擬貨幣|區塊鏈|crypto/i.test(categories) ? 'CRYPTO'
          : /台股|臺股/.test(categories) ? 'TW' : /美股/.test(categories) ? 'US' : null;
        const knownCryptoBulletin = /盤中速報\s*[-－—]\s*(Mina|Pixels)\b/i.test(headline);
        const region = sourceCategory || (knownCryptoBulletin ? 'CRYPTO' : classify(headline));
        const related = watchlist.some(w => [w.symbol?.replace(/\.TW$/, ''), w.name, ...(aliases[w.symbol] || [])]
          .filter(Boolean).some(term => matches(headline, term)));
        const score = related ? 3 : /半導體|晶片|晶圓|央行|聯準會|利率|通膨|美債|台股|美股/i.test(headline) ? 2 : region === 'CRYPTO' ? 0 : 1;
        return { ...n, headline, region:region === 'INTL' && ['TW','US'].includes(n.feedRegion) ? n.feedRegion : region, related, score };
      }).sort((a,b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0));
    const seen = new Set();
    return sorted.filter(n => {
      const bulletin = n.headline.match(/盤中速報\s*[-－—]\s*(.+?)(?:大漲|大跌|上漲|下跌)/);
      const key = bulletin ? `bulletin:${bulletin[1].trim().toUpperCase()}` : n.headline.replace(/[\s\p{P}]/gu, '').toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a,b) => b.score - a.score || Number(b.publishedAt || 0) - Number(a.publishedAt || 0)).slice(0,10);
  }

  // ── Fetch a single RSS feed via rss2json ──
  async function fetchFeed(feedConfig) {
    try {
      const url = RSS2JSON + encodeURIComponent(feedConfig.url);
      const resp = await fetch(url, { signal: requestTimeoutSignal(12000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.status !== 'ok' || !data.items) throw new Error('rss2json failed');

      return data.items.slice(0, 10).map(item => {
        const pubDate = item.pubDate ? new Date(item.pubDate) : null;
        const publishedAt = pubDate && Number.isFinite(pubDate.getTime()) ? pubDate.getTime() : null;
        const time = publishedAt
          ? pubDate.toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
          : '--:--';
        const source = (item.author || feedConfig.name || '').replace(/\(.*\)/, '').trim().slice(0, 12);

        const headline = truncate(decodeHeadline(item.title), 80);
        return {
          region: feedConfig.region,
          feedRegion: /\/(tw_stock|us_stock)$/.test(feedConfig.url) ? feedConfig.region : 'INTL',
          categories: Array.isArray(item.categories) ? item.categories : [],
          headline,
          source: source || feedConfig.name,
          time,
          publishedAt,
          link: item.link || '',
        };
      });
    } catch (e) {
      console.warn(`RSS ${feedConfig.name}:`, e.message);
      return [];
    }
  }

  // ── Fetch all feeds and merge ──
  async function fetchAllFeeds() {
    const results = await Promise.all(CONFIG.RSS_FEEDS.map(f => fetchFeed(f)));
    const allNews = results.flat().sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0));

    if (allNews.length === 0) {
      console.info('No current RSS feeds available');
      return [];
    }

    // Deduplicate
    const seen = new Set();
    const deduped = allNews.filter(n => {
      const k = n.headline.slice(0, 30);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return deduped.slice(0, 30);
  }

  // ── Get news (cached or fresh) ──
  let cachedNews = null;
  let lastFetch = 0;
  let requestEpoch = 0;

  async function getNews(forceRefresh = false) {
    if (!forceRefresh && cachedNews && (Date.now() - lastFetch) < CONFIG.REFRESH_NEWS) {
      return cachedNews;
    }
    const requestId = ++requestEpoch;
    const news = await fetchAllFeeds();
    if (requestId === requestEpoch) {
      cachedNews = news;
      lastFetch = Date.now();
    }
    return news;
  }

  return { getNews, prepareNews };
})();
