// ═══════════════════════════════════════
// J.A.R.V.I.S · NEWS INTELLIGENCE FEED
// RSS via rss2json.com (no CORS issues)
// ═══════════════════════════════════════

const NewsService = (() => {

  const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

  // ── Fallback news when feeds are unavailable ──
  const FALLBACK_NEWS = [
    { region:'US',  headline:'Fed 6月會議紀要：通膨降溫跡象明顯，市場預期年內降息兩次概率升至72%', source:'Reuters',  time:'09:12', impact:'pos' },
    { region:'TW',  headline:'台積電法說：CoWoS 封裝產能明年再翻倍，AI 伺服器需求持續強勁，上調全年展望', source:'經濟日報', time:'08:45', impact:'pos' },
    { region:'INTL',headline:'美國 5月 CPI 年增 3.3%，低於預期 3.5%，美元指數走弱，黃金攀升至 $2,380', source:'Bloomberg',time:'08:30', impact:'neu' },
    { region:'TW',  headline:'外資今日買超 82 億，聚焦半導體族群，聯電、日月光同步走強；融資餘額創近月新低', source:'MoneyDJ',  time:'09:20', impact:'pos' },
    { region:'US',  headline:'NVDA 宣布新一代 Blackwell Ultra GPU 提前量產，預計 Q3 出貨；AI 算力競賽再升溫', source:'CNBC',     time:'07:58', impact:'pos' },
    { region:'INTL',headline:'日圓急貶至 158，日銀緊急召開會議；亞股匯市波動加劇，新台幣走貶 0.3%', source:'FT',       time:'07:30', impact:'neg' },
  ];

  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  function detectImpact(title) {
    const tl = title.toLowerCase();
    if (/漲|飆|突破|創高|上調|樂觀|surge|rally|record|upgrade/i.test(tl)) return 'pos';
    if (/跌|崩|暴跌|下修|警|risk|crash|downgrade|plunge/i.test(tl)) return 'neg';
    return 'neu';
  }

  // ── Fetch a single RSS feed via rss2json ──
  async function fetchFeed(feedConfig) {
    try {
      const url = RSS2JSON + encodeURIComponent(feedConfig.url);
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.status !== 'ok' || !data.items) throw new Error('rss2json failed');

      return data.items.slice(0, 5).map(item => {
        const pubDate = item.pubDate ? new Date(item.pubDate) : null;
        const time = pubDate
          ? pubDate.toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
          : '--:--';
        const source = (item.author || feedConfig.name || '').replace(/\(.*\)/, '').trim().slice(0, 12);

        return {
          region: feedConfig.region,
          headline: truncate(item.title || '', 80),
          source: source || feedConfig.name,
          time,
          impact: detectImpact(item.title || ''),
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
    const allNews = results.flat();

    if (allNews.length === 0) {
      console.info('No RSS feeds, using fallback');
      return [...FALLBACK_NEWS];
    }

    // Deduplicate
    const seen = new Set();
    const deduped = allNews.filter(n => {
      const k = n.headline.slice(0, 30);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return deduped.slice(0, 10);
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

  return { getNews, FALLBACK_NEWS };
})();
