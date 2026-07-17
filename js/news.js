// ═══════════════════════════════════════
// J.A.R.V.I.S · NEWS INTELLIGENCE FEED
// RSS via rss2json.com (no CORS issues)
// ═══════════════════════════════════════

const NewsService = (() => {

  const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

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
      const resp = await fetch(url, { signal: requestTimeoutSignal(12000) });
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
    const allNews = results.flat();

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

    return deduped.slice(0, 10);
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

  return { getNews };
})();
