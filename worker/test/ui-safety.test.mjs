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
});
