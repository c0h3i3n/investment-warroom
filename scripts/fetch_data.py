#!/usr/bin/env python3
"""J.A.R.V.I.S Data Fetch — GitHub Actions auto-update for static backup."""
import json, os, re, sys, time, urllib.request, http.cookiejar
from datetime import datetime, timezone, timedelta

TZ = timezone(timedelta(hours=8))
DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

OTC_MAP = {'00679B.TW':'00679B.TWO','00933B.TW':'00933B.TWO','00937B.TW':'00937B.TWO'}
OTC_CODES = {'00679B','00687B','00712','00713','00751B','00864B','00933B','00937B','00942B','00945B','00948B','00950B','00951B','00952B','00953B','00956B','00957B','00958B','00959B','00960B','00961B','00962B','00963B','00964B','00965B'}
PROXIES = ['https://api.allorigins.win/raw?url=', 'https://corsproxy.io/?']

def get(url, timeout=12):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except: return None

def get_proxy(url, timeout=20):
    data = get(url, timeout=timeout)
    if data: return data
    for p in PROXIES:
        try:
            data = get(p + urllib.request.quote(url, safe=''), timeout=timeout)
            if data: return data
        except: continue
    return None

def yahoo_crumb():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    try: opener.open(urllib.request.Request('https://fc.yahoo.com/', headers={'User-Agent': UA}), timeout=8)
    except: pass
    try:
        resp = opener.open(urllib.request.Request('https://query2.finance.yahoo.com/v1/test/getcrumb', headers={'User-Agent': UA}), timeout=8)
        return resp.read().decode().strip(), '; '.join(f'{c.name}={c.value}' for c in cj)
    except: return None, None

def yahoo_quotes(symbols):
    crumb, cookie = yahoo_crumb()
    ys = [OTC_MAP.get(s, s) for s in symbols]
    batch = ','.join(ys)
    rev = {v: k for k, v in OTC_MAP.items()}
    
    for url_tpl in [
        f'https://query2.finance.yahoo.com/v7/finance/quote?symbols={batch}&crumb={crumb}',
        f'https://query1.finance.yahoo.com/v7/finance/quote?symbols={batch}',
    ]:
        headers = {'User-Agent': UA, 'Accept': 'application/json'}
        if cookie and 'crumb' in url_tpl: headers['Cookie'] = cookie
        try:
            req = urllib.request.Request(url_tpl, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as r:
                data = json.loads(r.read())
            out = {}
            for r in data.get('quoteResponse', {}).get('result', []):
                s = rev.get(r['symbol'], r['symbol'])
                out[s] = {'symbol': s, 'price': r.get('regularMarketPrice'),
                    'change': round(r.get('regularMarketChange', 0) or 0, 2),
                    'changePct': round(r.get('regularMarketChangePercent', 0) or 0, 2)}
            if out: return out
        except: continue
    
    # Proxy fallback
    url = f'https://query1.finance.yahoo.com/v7/finance/quote?symbols={batch}'
    data = get_proxy(url, timeout=25)
    if data:
        out = {}
        for r in data.get('quoteResponse', {}).get('result', []):
            s = rev.get(r['symbol'], r['symbol'])
            out[s] = {'symbol': s, 'price': r.get('regularMarketPrice'),
                'change': round(r.get('regularMarketChange', 0) or 0, 2),
                'changePct': round(r.get('regularMarketChangePercent', 0) or 0, 2)}
        return out
    return {}

def mis_quote(symbol):
    code = symbol.split('.')[0]
    ex = 'otc' if code in OTC_CODES else 'tse'
    url = f'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch={ex}_{code}.tw&json=1&delay=0'
    data = get(url, timeout=8) or get_proxy(url, timeout=15)
    if not data or data.get('rtcode') != '0000': return None
    items = data.get('msgArray', [])
    if not items: return None
    item = items[0]
    z = item.get('z')
    p = None
    if z and z != '-': p = float(z)
    else:
        bids = [float(v) for v in item.get('b', '').split('_') if v]
        asks = [float(v) for v in item.get('a', '').split('_') if v]
        if bids and asks: p = round((bids[0] + asks[0]) / 2, 2)
        elif bids: p = bids[0]
    if not p: return None
    prev = float(item.get('y', p))
    return {'symbol': symbol, 'price': p, 'change': round(p - prev, 2),
            'changePct': round((p - prev) / prev * 100, 2) if prev else 0}

# Main
ts = datetime.now(TZ).isoformat()

# Indexes
idx_config = [
    ('tai','^TWII','加權指數 TAIEX','TW','NT$'),
    ('otc','^TWOII','OTC 櫃買指數','TW','NT$'),
    ('spx','^GSPC','S&P 500','US','$'),
    ('ndx','^IXIC','NASDAQ','US','$'),
    ('sox','^SOX','費城半導體 SOX','US','$'),
]
yh = yahoo_quotes([i[1] for i in idx_config])

# MIS for TW indexes
for sym, mk, mch in [('^TWII','tse_t00.tw','t00.tw'), ('^TWOII','otc_o00.tw','o00.tw')]:
    url = f'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch={mk}&json=1&delay=0'
    data = get(url, timeout=8) or get_proxy(url, timeout=15)
    if data:
        for item in data.get('msgArray', []):
            if item.get('ch') == mch:
                p = item.get('z')
                if p and p != '-':
                    p = float(p); r = float(item.get('y', p))
                    yh[sym] = {'price': p, 'change': round(p - r, 2), 'changePct': round((p - r) / r * 100, 2)}

indexes = []
for id_, sym, name, region, curr in idx_config:
    d = yh.get(sym, {})
    indexes.append({'id': id_, 'name': name, 'region': region, 'currency': curr,
        'price': d.get('price'), 'change': d.get('change', 0), 'changePct': d.get('changePct', 0)})

# Quotes
W = ['0050.TW','00679B.TW','00878.TW','00929.TW','00933B.TW','00937B.TW','2330.TW','NVDA','TSLA']
yq = yahoo_quotes(W)
quotes = []
for sym in W:
    m = mis_quote(sym) if sym.endswith('.TW') else None
    time.sleep(0.3)
    y = yq.get(sym, {})
    if m:
        quotes.append({'symbol': sym, 'name': '', **m})
    elif y.get('price'):
        quotes.append({'symbol': sym, 'name': '', 'price': y['price'], 'change': y.get('change', 0), 'changePct': y.get('changePct', 0)})
    else:
        quotes.append({'symbol': sym, 'name': '', 'price': None, 'change': 0, 'changePct': 0})

os.makedirs(DIR, exist_ok=True)
json.dump({'timestamp': ts, 'data': indexes}, open(os.path.join(DIR, 'indexes.json'), 'w'), ensure_ascii=False, indent=2)
json.dump({'timestamp': ts, 'data': quotes}, open(os.path.join(DIR, 'quotes.json'), 'w'), ensure_ascii=False, indent=2)
print(f'✅ {datetime.now(TZ).strftime("%H:%M:%S")}  Idx:{sum(1 for i in indexes if i.get("price"))}/{len(indexes)}  Q:{sum(1 for q in quotes if q.get("price"))}/{len(quotes)}')
