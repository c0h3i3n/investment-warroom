import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseAnnualCalendar, closureDate, parseTwseNotices, parseTaifexEmergency,
  refreshOfficialCalendar } from '../src/official-calendar.mjs';
import { isFreshTimestamp, isNightSessionOpen, nightTradingDayForTimestamp, expectedNightTradingDay } from '../src/index.mjs';

const now = Date.parse('2026-10-23T03:00:00Z');
const title = '臺灣證券交易所集中交易市場115年10月23日休市一天';
const rss = `<rss><channel><title>TSEC FEED</title><item><title>${title}</title>
  <link>/rwd/zh/news/newsDetail/closure</link><content:encoded>115年10月23日集中交易市場全日休市。</content:encoded>
  <pubDate>Thu, 22 Oct 2026 12:10:00 GMT</pubDate></item></channel></rss>`;
const emergency = '因颱風來襲，115年10月23日(星期五)臺灣期貨交易所集中交易市場休市1日(包含一般交易時段及盤後交易時段)';
const html = `<html><header>臺灣期貨交易所<span>緊急公告</span><div class="bd"><div class="txt">${emergency}</div></div></header></html>`;
const annual = { stat:'ok', queryYear:2026, data: [
  ['2026-01-02','開始交易日','開始交易'], ['2026-02-11','最後交易日','最後交易'],
  ...['01-01','02-12','02-13','02-16','02-17','02-18','10-26','12-25'].map(d => [`2026-${d}`,'休市','依規定放假']),
] };

test('annual table excludes first/last trading dates and rejects wrong year or unknown rows', () => {
  const parsed = parseAnnualCalendar(annual, 2026);
  assert.ok(!parsed.closed.includes('2026-02-11'));
  assert.ok(parsed.closed.includes('2026-02-12'));
  assert.throws(() => parseAnnualCalendar(annual, 2027));
  assert.throws(() => parseAnnualCalendar({...annual, data:[...annual.data,['2026-10-23','待公告','']]},2026));
});

test('official notices require explicit dates, unconditional whole-market closure and trusted URL', () => {
  assert.equal(closureDate(title), '2026-10-23');
  assert.equal(closureDate('2026年10月23日集中交易市場全日休市'), '2026-10-23');
  for (const invalid of [`若臺北市停止上班，${title}`, `${title}，但取消休市`,
    '115年10月23日個股暫停交易', '115年10月32日集中交易市場全日休市',
    '明日集中交易市場休市一天']) assert.equal(closureDate(invalid), null);
  assert.equal(parseTwseNotices(rss, now).closures[0].date, '2026-10-23');
  assert.throws(() => parseTwseNotices(rss.replace('/rwd/zh/news/newsDetail/closure','https://example.com/closure'), now));
  assert.throws(() => parseTwseNotices(rss, now + 11 * 86400000));
  assert.throws(() => parseTwseNotices('<html>maintenance</html>', now));
});

test('TAIFEX parser only applies explicit day AND night closure; conditional notices need review', () => {
  assert.equal(parseTaifexEmergency(html).closures[0].scope, 'TAIFEX');
  const ambiguous = parseTaifexEmergency(html.replace('包含一般交易時段及盤後交易時段','詳公告'));
  assert.equal(ambiguous.closures.length,0);
  assert.equal(ambiguous.unresolved.length,1);
  assert.throws(() => parseTaifexEmergency(html.replace('class="txt"','class="new-layout"')));
});

test('scheduled official check persists closures through an outage, and never confirms open on failure', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => String(url).includes('holidaySchedule') ? Response.json(annual)
    : new Response(String(url).includes('twse') ? rss : html);
  const state = await refreshOfficialCalendar(null, now);
  assert.equal(state.closures.length,2);
  assert.ok(Object.values(state.checks).every(check=>check.ok));
  globalThis.fetch = async () => { throw new Error('offline'); };
  const fallback = await refreshOfficialCalendar(state, now + 300000);
  assert.equal(fallback.closures.length,2);
  assert.equal(fallback.checks.notices.ok,false);
  assert.equal(fallback.checks.notices.checkedAt,now);
  assert.equal(fallback.checks.futures.ok,false);
});

test('emergency closure shares quote freshness but preserves the previous overnight session label', () => {
  MarketCalendar.applyOfficial({schemaVersion:1,date:'2026-10-23',attemptedAt:now,
    annual:{year:2026,closed:MARKET_HOLIDAYS.TW},
    closures:[{date:'2026-10-23',scope:'TW',reason:title}, {date:'2026-10-23',scope:'TAIFEX'}],
    checks:{annual:{ok:true},notices:{ok:true,checkedAt:now},futures:{ok:true}}});
  assert.equal(MarketCalendar.tradingDay('TW',Date.parse('2026-10-23')),false);
  assert.equal(isFreshTimestamp('2026-10-22T05:30:00Z','TW',now),true);
  assert.equal(isFreshTimestamp('2026-10-21T05:30:00Z','TW',now),false);
  assert.equal(isNightSessionOpen(Date.parse('2026-10-22T18:00:00Z')),true); // 10/23 02:00
  assert.equal(isNightSessionOpen(Date.parse('2026-10-23T08:00:00Z')),false); // 10/23 16:00
  assert.equal(new Date(nightTradingDayForTimestamp(Date.parse('2026-10-22T20:59:59Z'))).toISOString().slice(0,10),'2026-10-23');
  assert.equal(new Date(expectedNightTradingDay(Date.parse('2026-10-23T08:00:00Z'))).toISOString().slice(0,10),'2026-10-23');
  assert.equal(MarketCalendar.verification(now).status,'closed-announcement');
  assert.equal(MarketCalendar.verification(now+86400000).checked,false);
  assert.equal(MarketCalendar.verification(Date.parse('2026-10-27T03:00:00Z')).status,'unverified');
});

test('browser consumes the same dated calendar and rejects an older snapshot rollback', () => {
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ Date:Clock, Intl, console, CONFIG:{} });
  for (const file of ['market-calendar','data']) vm.runInContext(fs.readFileSync(new URL(`../../js/${file}.js`,import.meta.url),'utf8'),context);
  context.state = MarketCalendar.officialState();
  assert.equal(vm.runInContext('MarketCalendar.applyOfficial(state)',context),true);
  assert.equal(vm.runInContext('DataService.isFreshRecord({price:100,region:"TW",asOf:"2026-10-22T05:30:00Z"})',context),true);
  assert.equal(vm.runInContext('MarketCalendar.applyOfficial({...state, attemptedAt:state.attemptedAt-1, closures:[]})',context),false);
  assert.equal(vm.runInContext('MarketCalendar.verification(Date.now()).status',context),'closed-announcement');
});

test('backup retains official timestamps, confirmed closures, and direct-source failure transparency', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const checkedAt = now - 60000;
  globalThis.fetch = async url => {
    if (!String(url).includes('github.io')) throw new Error('official network unavailable');
    return Response.json({schemaVersion:1,closures:[{date:'2026-10-23',scope:'TAIFEX',source:'https://www.taifex.com.tw/cht/index'}],
      checks:{futures:{ok:true,checkedAt,error:null}}});
  };
  const state = await refreshOfficialCalendar(null,now);
  assert.equal(state.closures.length,1);
  assert.equal(state.checks.futures.checkedAt,checkedAt);
  assert.equal(state.checks.futures.delivery,'github-official-check');
  assert.equal(state.checks.notices.ok,false);
  const older = await refreshOfficialCalendar(null,now+15*60000);
  assert.equal(older.closures.length,1);
  assert.equal(older.checks.futures.ok,false);
});

test('night direction is disabled while official session verification is unavailable', () => {
  const context = vm.createContext({Intl});
  vm.runInContext(fs.readFileSync(new URL('../../js/night-analysis.js',import.meta.url),'utf8'),context);
  assert.equal(vm.runInContext('NightAnalysis.evaluate({price:48000,changePct:1,status:"open",calendarUnverified:true}).usable',context),false);
});
