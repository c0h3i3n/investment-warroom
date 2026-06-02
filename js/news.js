// ═══════════════════════════════════════
// J.A.R.V.I.S · NEWS INTELLIGENCE FEED
// RSS feed fetching via CORS proxy
// ═══════════════════════════════════════

const NewsService = (() => {

  // ── Fallback news when feeds are unavailable ──
  const FALLBACK_NEWS = [
    { region:'US',  headline:'Fed 6月會議紀要：通膨降溫跡象明顯，市場預期年內降息兩次概率升至72%', source:'Reuters',  time:'09:12', impact:'pos' },
    { region:'TW',  headline:'台積電法說：CoWoS 封裝產能明年再翻倍，AI 伺服器需求持續強勁，上調全年展望', source:'經濟日報', time:'08:45', impact:'pos' },
    { region:'INTL',headline:'美國 5月 CPI 年增 3.3%，低於預期 3.5%，美元指數走弱，黃金攀升至 $2,380', source:'Bloomberg',time:'08:30', impact:'neu' },
    { region:'TW',  headline:'外資今日買超 82 億，聚焦半導體族群，聯電、日月光同步走強；融資餘額創近月新低', source:'MoneyDJ',  time:'09:20', impact:'pos' },
    { region:'US',  headline:'NVDA 宣布新一代 Blackwell Ultra GPU 提前量產，預計 Q3 出貨；AI 算力競賽再升溫', source:'CNBC',     time:'07:58', impact:'pos' },
    { region:'INTL',headline:'日圓急貶至 158，日銀緊急召開會議；亞股匯市波動加劇，新台幣走貶 0.3%', source:'FT',       time:'07:30', impact:'neg' },
  ];

  // ── Parse RSS XML ──
  function parseRSS(xmlText, sourceName, region) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const items = doc.querySelectorAll('item');
    const news = [];

    items.forEach((item, i) => {
      if (i >= 5) return; // max 5 per source
      const title = item.querySelector('title')?.textContent || '';
      const pubDate = item.querySelector('pubDate')?.textContent || '';
      const time = pubDate ? formatRssDate(pubDate) : '--:--';

      // Determine impact based on keywords
      let impact = 'neu';
      const tl = title.toLowerCase();
      if (/漲|飆|突破|創高|上調|樂觀|surge|rally|record|upgrade/i.test(tl)) impact = 'pos';
      if (/跌|崩|暴跌|下修|警|risk|crash|downgrade|plunge/i.test(tl)) impact = 'neg';

      news.push({
        region,
        headline: truncate(title, 80),
        source: sourceName,
        time,
        impact,
      });
    });

    return news;
  }

  function formatRssDate(dateStr) {
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return '--:--'; }
  }

  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  // ── Fetch a single RSS feed ──
  async function fetchFeed(feedConfig) {
    try {
      const proxyUrl = CONFIG.CORS_PROXY + encodeURIComponent(feedConfig.url);
      const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const xmlText = await resp.text();
      return parseRSS(xmlText, feedConfig.name, feedConfig.region);
    } catch (e) {
      console.warn(`RSS feed ${feedConfig.name} failed:`, e.message);
      return [];
    }
  }

  // ── Fetch all feeds and merge ──
  async function fetchAllFeeds() {
    const allNews = [];
    for (const feed of CONFIG.RSS_FEEDS) {
      const items = await fetchFeed(feed);
      allNews.push(...items);
    }

    if (allNews.length === 0) {
      console.info('No RSS feeds available, using fallback news');
      return [...FALLBACK_NEWS];
    }

    // Sort by recency (by time string, simple sort)
    // Deduplicate similar headlines
    return dedupeNews(allNews).slice(0, 10);
  }

  function dedupeNews(news) {
    const seen = new Set();
    return news.filter(n => {
      const key = n.headline.slice(0, 30);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Get news (cached or fresh) ──
  let cachedNews = null;
  let lastFetch = 0;

  async function getNews(forceRefresh = false) {
    if (!forceRefresh && cachedNews && (Date.now() - lastFetch) < CONFIG.REFRESH_NEWS) {
      return cachedNews;
    }
    cachedNews = await fetchAllFeeds();
    lastFetch = Date.now();
    return cachedNews;
  }

  // ── Public API ──
  return {
    getNews,
    FALLBACK_NEWS,
  };
})();
