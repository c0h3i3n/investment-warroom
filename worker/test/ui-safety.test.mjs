import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('stale night data hides old prices and basis instead of presenting them as current', () => {
  const elements = {
    'night-market-content': { innerHTML:'' },
    nightOrb: { className:'' },
    nightLabel: { textContent:'' },
  };
  const context = vm.createContext({
    document: { getElementById: id => elements[id] || null },
    NightAnalysis: { evaluate: () => assert.fail('stale night data must not be analyzed') },
  });
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js', import.meta.url), 'utf8'), context);
  context.night = {
    status:'closed', stale:true, contract:'202610', source:'TAIFEX MIS',
    asOf:Date.parse('2026-09-24T23:56:35+08:00'), price:47877, basis:-147.6,
  };
  vm.runInContext('UI.renderNightMarket(night, [])', context);
  assert.match(elements['night-market-content'].innerHTML, /夜盤資料已逾時/);
  assert.doesNotMatch(elements['night-market-content'].innerHTML, /47,877|-147\.60|現貨基差/);
  assert.equal(elements.nightLabel.textContent, 'NIGHT STALE');
});

test('a rounded zero index change does not display a down arrow', () => {
  const element = { innerHTML:'' };
  const context = vm.createContext({
    document: { getElementById: id => id === 'index-cards' ? element : null },
    CONFIG: { INDEXES:[{id:'sox',name:'SOX'}] },
    setTimeout: () => {},
  });
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js', import.meta.url), 'utf8'), context);
  context.index = { id:'sox',region:'US',name:'SOX',price:12628.62,changePct:-0.004,unit:'PTS' };
  vm.runInContext('UI.renderIndexCards([index])', context);
  assert.match(element.innerHTML, /— 0\.00%/);
  assert.doesNotMatch(element.innerHTML, /▼ 0\.00%/);
});

test('featured quotes show their source time and distinguish an indicative price', () => {
  const element = { innerHTML:'', querySelector:() => null };
  const context = vm.createContext({
    document:{ getElementById:id => id === 'featured-row' ? element : null },
    window:{ _featuredQuotes:[{
      symbol:'2330.TW', name:'台積電', price:2502.5, change:22.5,
      changePct:0.91, priceType:'indicative', source:'TWSE MIS',
      asOf:Date.parse('2026-10-01T11:20:00+08:00'),
    }] },
    setTimeout:() => {},
  });
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js', import.meta.url), 'utf8'), context);
  vm.runInContext('UI.renderFeatured()', context);
  assert.match(element.innerHTML, /中間報價 · TWSE MIS · 10\/01\s+11:20/);
  assert.match(element.innerHTML, /≈2502\.50/);
});

test('technical indicators identify the completed session and actual retrieval time', () => {
  const grid = { innerHTML:'', appendChild(node) { this.status = node.textContent; } };
  const label = { textContent:'' };
  const context = vm.createContext({
    document:{
      getElementById:id => ({ 'ind-grid':grid, 'ind-label':label })[id] || null,
      createElement:() => ({ style:{ cssText:'' }, textContent:'' }),
    },
  });
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js', import.meta.url), 'utf8'), context);
  context.data = {
    symbol:'0050.TW', asOf:Date.parse('2026-09-30T01:00:00Z'),
    indicators:[{ name:'MA · 20', value:'110.0', signal:'BELOW ✗', color:'dn' }],
    historyMeta:{ source:'Yahoo Finance', generatedAt:'2026-10-01T02:27:57Z', excludedIncomplete:true },
  };
  vm.runInContext('UI.renderIndicators(data)', context);
  assert.match(grid.status, /技術指標截至 2026\/09\/30 完整日線/);
  assert.match(grid.status, /資料取得 10\/01\s+10:27/);
  assert.match(grid.status, /盤中日線未納入/);
  assert.doesNotMatch(grid.status, /計算/);
  context.data.historyMeta.lagSessions = 1;
  context.data.historyMeta.expectedSession = '2026-10-01';
  vm.runInContext('UI.renderIndicators(data)', context);
  assert.match(grid.innerHTML, /日線落後 1 個交易日/);
  assert.match(grid.innerHTML, /110.0/);
  assert.doesNotMatch(grid.innerHTML, /BELOW/);
  assert.match(grid.innerHTML, /歷史數值 · 訊號暫停/);
});

test('RSS headlines decode entities without inserting markup into the UI', async () => {
  const context = vm.createContext({
    CONFIG: { RSS_FEEDS:[{ name:'Test',url:'https://example.test/rss',region:'US' }], REFRESH_NEWS:300000 },
    requestTimeoutSignal: () => undefined,
    fetch: async () => ({ ok:true, json:async () => ({ status:'ok',items:[{
      title:'S&amp;amp;P 500 &lt;script&gt;alert(1)&lt;/script&gt;',
      pubDate:'2026-10-01T02:00:00Z',link:'https://example.test/story',
    }] }) }),
    console,
  });
  vm.runInContext(fs.readFileSync(new URL('../../js/news.js', import.meta.url), 'utf8'), context);
  const news = await vm.runInContext('NewsService.getNews(true)', context);
  assert.equal(news[0].headline, 'S&P 500 <script>alert(1)</script>');
  const element = { innerHTML:'' };
  context.document = { getElementById: id => id === 'news-feed' ? element : null };
  context.news = news;
  vm.runInContext(fs.readFileSync(new URL('../../js/ui.js', import.meta.url), 'utf8'), context);
  vm.runInContext('UI.renderNews(news)', context);
  assert.match(element.innerHTML, /S&amp;P 500 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(element.innerHTML, /<script>/);
  assert.doesNotMatch(element.innerHTML, /n-impact|粗分/);
});
