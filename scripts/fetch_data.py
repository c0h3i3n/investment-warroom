#!/usr/bin/env python3
"""Fetch validated market snapshots for the static GitHub Pages fallback."""

import http.cookiejar
import json
import os
import sys
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo

TAIPEI = ZoneInfo('Asia/Taipei')
NEW_YORK = ZoneInfo('America/New_York')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'data')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

OTC_MAP = {'00679B.TW': '00679B.TWO', '00933B.TW': '00933B.TWO', '00937B.TW': '00937B.TWO'}
OTC_REVERSE = {value: key for key, value in OTC_MAP.items()}
OTC_CODES = {
    '00679B', '00687B', '00712', '00713', '00751B', '00864B', '00933B',
    '00937B', '00942B', '00945B', '00948B', '00950B', '00951B', '00952B',
    '00953B', '00956B', '00957B', '00958B', '00959B', '00960B', '00961B',
    '00962B', '00963B', '00964B', '00965B',
}
PROXIES = ['https://api.allorigins.win/raw?url=', 'https://corsproxy.io/?']


def cache_bust(url):
    separator = '&' if '?' in url else '?'
    return f'{url}{separator}_wr={int(datetime.now(timezone.utc).timestamp() * 1000)}'


def get(url, timeout=12):
    try:
        req = urllib.request.Request(
            cache_bust(url),
            headers={'User-Agent': UA, 'Accept': 'application/json', 'Cache-Control': 'no-cache'},
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read())
    except Exception:
        return None


def get_with_proxy(url, timeout=18):
    data = get(url, timeout=timeout)
    if data:
        return data
    fresh_target = cache_bust(url)
    for proxy in PROXIES:
        data = get(proxy + quote(fresh_target, safe=''), timeout=timeout)
        if data:
            return data
    return None


def iso_from_epoch(value, milliseconds=False):
    try:
        epoch = float(value) / (1000 if milliseconds else 1)
        if epoch <= 0:
            return None
        return datetime.fromtimestamp(epoch, timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def parse_mis_time(item):
    epoch = iso_from_epoch(item.get('tlong'), milliseconds=True)
    if epoch:
        return epoch
    try:
        local = datetime.strptime(f"{item['d']} {item['t']}", '%Y%m%d %H:%M:%S').replace(tzinfo=TAIPEI)
        return local.astimezone(timezone.utc).isoformat()
    except (KeyError, TypeError, ValueError):
        return None


def market_open(region, now=None):
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(TAIPEI if region == 'TW' else NEW_YORK)
    if local.weekday() >= 5:
        return False
    minutes = local.hour * 60 + local.minute
    return 540 <= minutes <= 810 if region == 'TW' else 570 <= minutes <= 960


def fresh(as_of, region):
    try:
        source_time = datetime.fromisoformat(as_of.replace('Z', '+00:00')).astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        return False
    age = datetime.now(timezone.utc) - source_time
    if age < -timedelta(minutes=5):
        return False
    limit = timedelta(minutes=20) if market_open(region) else timedelta(days=7)
    return age <= limit


def region_for_symbol(symbol):
    return 'TW' if symbol in ('^TWII', '^TWOII') or symbol.endswith(('.TW', '.TWO')) else 'US'


def yahoo_crumb():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    try:
        opener.open(urllib.request.Request('https://fc.yahoo.com/', headers={'User-Agent': UA}), timeout=8)
    except Exception:
        pass
    try:
        response = opener.open(
            urllib.request.Request('https://query2.finance.yahoo.com/v1/test/getcrumb', headers={'User-Agent': UA}),
            timeout=8,
        )
        return response.read().decode().strip(), '; '.join(f'{c.name}={c.value}' for c in jar)
    except Exception:
        return None, None


def parse_yahoo_items(items):
    output = {}
    for item in items:
        yahoo_symbol = item.get('symbol', '')
        symbol = OTC_REVERSE.get(yahoo_symbol, yahoo_symbol)
        price = item.get('regularMarketPrice')
        as_of = iso_from_epoch(item.get('regularMarketTime'))
        region = region_for_symbol(symbol)
        if not isinstance(price, (int, float)) or price <= 0 or not fresh(as_of, region):
            continue
        output[symbol] = {
            'symbol': symbol,
            'price': price,
            'change': round(item.get('regularMarketChange') or 0, 2),
            'changePct': round(item.get('regularMarketChangePercent') or 0, 2),
            'asOf': as_of,
            'source': 'Yahoo Finance',
            'priceType': 'trade',
        }
    return output


def yahoo_quotes(symbols):
    crumb, cookie = yahoo_crumb()
    yahoo_symbols = [OTC_MAP.get(symbol, symbol) for symbol in symbols]
    batch = ','.join(yahoo_symbols)
    urls = [
        f'https://query2.finance.yahoo.com/v7/finance/quote?symbols={batch}&crumb={quote(crumb or "")}',
        f'https://query1.finance.yahoo.com/v7/finance/quote?symbols={batch}',
    ]
    output = {}
    for url in urls:
        headers = {'User-Agent': UA, 'Accept': 'application/json', 'Cache-Control': 'no-cache'}
        if cookie and 'crumb=' in url:
            headers['Cookie'] = cookie
        try:
            request = urllib.request.Request(cache_bust(url), headers=headers)
            with urllib.request.urlopen(request, timeout=12) as response:
                data = json.loads(response.read())
            output.update(parse_yahoo_items(data.get('quoteResponse', {}).get('result', [])))
            if len(output) == len(symbols):
                return output
        except Exception:
            continue

    data = get_with_proxy(f'https://query1.finance.yahoo.com/v7/finance/quote?symbols={batch}', timeout=18)
    if data:
        output.update(parse_yahoo_items(data.get('quoteResponse', {}).get('result', [])))
    return output


def parse_mis_quote(item):
    code = item.get('c')
    traded = item.get('z')
    if not code:
        return None
    price_type = 'trade'
    try:
        if traded and traded != '-':
            price = float(traded)
        else:
            bids = [float(value) for value in item.get('b', '').split('_') if value]
            asks = [float(value) for value in item.get('a', '').split('_') if value]
            if not bids or not asks:
                return None
            price = round((bids[0] + asks[0]) / 2, 4)
            price_type = 'indicative'
        previous = float(item.get('y') or price)
    except (TypeError, ValueError):
        return None
    as_of = parse_mis_time(item)
    if price <= 0 or not fresh(as_of, 'TW'):
        return None
    symbol = f'{code}.TW'
    return {
        'symbol': symbol,
        'price': price,
        'change': round(price - previous, 2),
        'changePct': round((price - previous) / previous * 100, 2) if previous else 0,
        'asOf': as_of,
        'source': 'TWSE MIS',
        'priceType': price_type,
    }


def mis_quotes(symbols):
    keys = []
    for symbol in symbols:
        code = symbol.split('.')[0]
        exchange = 'otc' if code in OTC_CODES else 'tse'
        keys.append(f'{exchange}_{code}.tw')
    url = f'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch={"|".join(keys)}&json=1&delay=0'
    data = get_with_proxy(url, timeout=18)
    if not data or data.get('rtcode') != '0000':
        return {}
    parsed = [parse_mis_quote(item) for item in data.get('msgArray', [])]
    return {item['symbol']: item for item in parsed if item}


def mis_indexes():
    url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw|otc_o00.tw&json=1&delay=0'
    data = get_with_proxy(url, timeout=18)
    output = {}
    for item in (data or {}).get('msgArray', []):
        symbol = '^TWII' if item.get('ch') == 't00.tw' else '^TWOII' if item.get('ch') == 'o00.tw' else None
        traded = item.get('z')
        if not symbol or not traded or traded == '-':
            continue
        try:
            price = float(traded)
            previous = float(item.get('y') or price)
        except (TypeError, ValueError):
            continue
        as_of = parse_mis_time(item)
        if price > 0 and fresh(as_of, 'TW'):
            output[symbol] = {
                'symbol': symbol,
                'price': price,
                'change': round(price - previous, 2),
                'changePct': round((price - previous) / previous * 100, 2) if previous else 0,
                'asOf': as_of,
                'source': 'TWSE MIS',
                'priceType': 'trade',
            }
    return output


def atomic_json(filename, payload):
    os.makedirs(DATA_DIR, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=DATA_DIR, delete=False) as handle:
            temp_name = handle.name
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, os.path.join(DATA_DIR, filename))
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


generated_at = datetime.now(timezone.utc).isoformat()

index_config = [
    ('tai', '^TWII', '加權指數 TAIEX', 'TW', 'NT$'),
    ('otc', '^TWOII', 'OTC 櫃買指數', 'TW', 'NT$'),
    ('spx', '^GSPC', 'S&P 500', 'US', '$'),
    ('ndx', '^IXIC', 'NASDAQ', 'US', '$'),
    ('sox', '^SOX', '費城半導體 SOX', 'US', '$'),
]
index_data = yahoo_quotes([item[1] for item in index_config])
index_data.update(mis_indexes())
indexes = []
for identifier, symbol, name, region, currency in index_config:
    market = index_data.get(symbol, {})
    indexes.append({
        'id': identifier,
        'symbol': symbol,
        'name': name,
        'region': region,
        'currency': currency,
        'price': market.get('price'),
        'change': market.get('change'),
        'changePct': market.get('changePct'),
        'asOf': market.get('asOf'),
        'source': market.get('source'),
        'priceType': market.get('priceType'),
    })

watch_symbols = ['0050.TW', '2330.TW', '00679B.TW', '00878.TW', '00929.TW', '00933B.TW', '00937B.TW', '009800.TW', 'NVDA', 'TSLA']
yahoo_data = yahoo_quotes(watch_symbols)
tw_data = mis_quotes([symbol for symbol in watch_symbols if symbol.endswith('.TW')])
quotes = []
for symbol in watch_symbols:
    market = tw_data.get(symbol) or yahoo_data.get(symbol) or {}
    quotes.append({
        'symbol': symbol,
        'name': '',
        'price': market.get('price'),
        'change': market.get('change'),
        'changePct': market.get('changePct'),
        'asOf': market.get('asOf'),
        'source': market.get('source'),
        'priceType': market.get('priceType'),
    })

valid_indexes = sum(1 for item in indexes if item.get('price') and item.get('asOf'))
valid_quotes = sum(1 for item in quotes if item.get('price') and item.get('asOf'))
if valid_indexes < 3 or valid_quotes < 5:
    print(f'❌ Refusing partial snapshot: indexes={valid_indexes}/5 quotes={valid_quotes}/10', file=sys.stderr)
    print('   Missing indexes: ' + ', '.join(item['symbol'] for item in indexes if not item.get('price')), file=sys.stderr)
    print('   Missing quotes: ' + ', '.join(item['symbol'] for item in quotes if not item.get('price')), file=sys.stderr)
    sys.exit(1)

atomic_json('indexes.json', {'timestamp': generated_at, 'generatedAt': generated_at, 'data': indexes})
atomic_json('quotes.json', {'timestamp': generated_at, 'generatedAt': generated_at, 'data': quotes})

rss_feeds = [
    ('鉅亨', 'https://news.cnyes.com/rss/v1/news/category/headline', 'TW'),
    ('台股', 'https://news.cnyes.com/rss/v1/news/category/tw_stock', 'TW'),
    ('美股', 'https://news.cnyes.com/rss/v1/news/category/us_stock', 'US'),
]
news_items = []
for source, rss_url, region in rss_feeds:
    rss2json = f'https://api.rss2json.com/v1/api.json?rss_url={quote(rss_url)}'
    data = get(rss2json, timeout=12)
    if not data or data.get('status') != 'ok':
        continue
    for item in data.get('items', [])[:4]:
        title = item.get('title', '')
        lowered = title.lower()
        positive = ['漲', '飆', '突破', '創高', '上調', '樂觀', 'surge', 'rally', 'record', 'upgrade']
        negative = ['跌', '崩', '暴跌', '下修', '警', 'risk', 'crash', 'downgrade', 'plunge']
        impact = 'pos' if any(word in lowered for word in positive) else 'neg' if any(word in lowered for word in negative) else 'neu'
        news_items.append({
            'region': region,
            'headline': title[:80] + '…' if len(title) > 80 else title,
            'source': source,
            'time': '--:--',
            'impact': impact,
            'link': item.get('link', ''),
        })

seen = set()
news = []
for item in news_items:
    key = item['headline'][:30]
    if key not in seen:
        seen.add(key)
        news.append(item)
if news:
    atomic_json('news.json', {'timestamp': generated_at, 'generatedAt': generated_at, 'data': news[:12]})

print(f'✅ {datetime.now(TAIPEI).strftime("%H:%M:%S")}  Idx:{valid_indexes}/5  Q:{valid_quotes}/10  News:{len(news[:12])}')
