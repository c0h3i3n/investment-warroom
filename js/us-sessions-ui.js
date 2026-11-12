// An independent request path: extended-hours data never blocks the main dashboard.
const UsSessionsUI = (() => {
  const S=UsMarketSessions;
  let snapshot=null,selected='',generation=0,loading=false,failed=false,started=false;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=time=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(time));
  const et=time=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(time));
  function syncSymbols() {
    const select=document.getElementById('us-session-symbol');
    if(!select) return false;
    const watch=Array.isArray(window._watchlistQuotes)?window._watchlistQuotes:CONFIG.DEFAULT_WATCHLIST;
    const items=watch.filter(item=>item.region==='US'&&S.validSymbol(item.symbol));
    const signature=items.map(item=>item.symbol+':'+item.name).join('|');
    if(select.dataset.options!==signature) {
      select.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=item.symbol;option.textContent=`${item.symbol} · ${item.name||item.symbol}`;return option;}));
      select.dataset.options=signature;
    }
    const previous=selected;
    if(!items.some(item=>item.symbol===selected)) selected=items.find(item=>item.symbol==='NVDA')?.symbol||items[0]?.symbol||'';
    select.value=selected;
    select.disabled=!selected;
    if(previous!==selected) {snapshot=null;generation++;}
    return previous!==selected;
  }
  function render() {
    const container=document.getElementById('us-session-cards');
    if(!container) return;
    const now=Date.now(),clock=S.context(now);
    const age=now-Date.parse(snapshot?.generatedAt||'');
    const usable=snapshot?.symbol===selected&&age>=0&&age<=(clock.phase==='closed'?4*86400000:15*60000);
    const data=S.view(usable?snapshot:null,now);
    document.getElementById('us-session-phase').textContent=`目前美東時段：${S.names[data.phase]}`;
    document.getElementById('us-session-date').textContent=`美東交易日 ${data.sessionDay}${data.phase==='closed'?' · 最近交易日':''}${data.earlyClose?' · 提早收盤日':''} · 下列時間為台北時間`;
    const labels={upcoming:'尚未開始',unavailable:'尚無有效資料',ended:'時段已結束',delayed:'資料延遲',active:'延遲資料'};
    container.innerHTML=['pre','regular','post'].map(key=>{
      const slot=data.slots[key],quote=slot.quote;
      const pct=slot.changePct,cls=pct>0?'up':pct<0?'down':'flat';
      const change=pct===null?'漲跌基準暫缺':`${pct>0?'▲':pct<0?'▼':'—'} ${Math.abs(pct).toFixed(2)}%`;
      const detail=quote?`${quote.kind==='regular-quote'?'正常盤報價時間':'分時資料時間'} ${fmt(quote.asOf)}`:loading?'正在取得此時段資料…':slot.state==='upcoming'?'此交易日時段尚未開始':'來源尚未提供此交易日的有效報價';
      return `<article class="us-session-card${data.phase===key?' current':''}">
        <div class="us-session-card-head"><h3>${S.names[key]}</h3><span>${labels[slot.state]}</span></div>
        <div class="us-session-hours">美東 ${et(slot.start)}–${et(slot.end)}<br>台北 ${fmt(slot.start)}–${fmt(slot.end)}</div>
        <div class="us-session-price">${quote?'$'+quote.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'--'}</div>
        <div class="us-session-change ${cls}">${quote?change:'—'} <small>${key==='post'?'較當日正常盤收盤':'較前一交易日收盤'}</small></div>
        <div class="us-session-source">${esc(detail)}</div>
        <div class="us-session-kind">${quote?.kind==='5m-close'?'5分鐘分時參考價，非逐筆成交價':key==='regular'?'正常交易時段報價':'延長交易時段'}</div>
      </article>`;
    }).join('');
    const output=document.getElementById('us-session-status');
    const warning=failed||snapshot?.warning;
    output.textContent=!selected?'自選股目前沒有美股，新增美股後即可查看。':loading?`正在取得 ${selected} 的美股時段資料…`
      :warning?'美股時段資料更新失敗；僅保留仍有效且已標示時間的資料，可重新整理此區。'
      :snapshot?`${selected} · Yahoo Finance · 資料取得 ${fmt(Date.parse(snapshot.generatedAt))}（台北時間）${snapshot.delivery==='cache'?' · 快取':''}`:'尚無可用的美股時段資料。';
    output.dataset.state=warning?'warning':loading?'loading':'ready';
    const button=document.getElementById('us-session-refresh');
    button.disabled=loading||!selected;button.textContent=loading?'更新中…':'更新美股';
  }
  async function refresh() {
    if(!started) return;
    syncSymbols();
    const ticket=++generation,symbol=selected;
    if(!symbol) {loading=false;render();return;}
    loading=true;failed=false;render();
    try {
      const response=await fetch(`${CONFIG.MARKET_API.replace(/\/$/,'')}/api/us-sessions?symbol=${encodeURIComponent(symbol)}`,{
        cache:'no-store',headers:{Accept:'application/json'},signal:requestTimeoutSignal(12000)});
      if(!response.ok) throw new Error('US session service unavailable');
      const result=await response.json();
      if(result?.schemaVersion!==1||result.symbol!==symbol||!Number.isFinite(Date.parse(result.generatedAt))
        ||Date.parse(result.generatedAt)>Date.now()+60000||!result.sessions) throw new Error('Invalid US session data');
      if(ticket!==generation) return;
      snapshot=result;
    } catch {
      if(ticket!==generation) return;
      failed=true;
    } finally {
      if(ticket===generation) {loading=false;render();}
    }
  }
  function selectSymbol(symbol) {
    syncSymbols();
    const select=document.getElementById('us-session-symbol');
    if(!S.validSymbol(symbol)||!Array.from(select.options).some(option=>option.value===symbol)) return false;
    selected=symbol;snapshot=null;
    refresh();
    return true;
  }
  function init() {
    if(!document.getElementById('us-session-cards')) return;
    started=true;
    document.getElementById('us-session-symbol').addEventListener('change',event=>selectSymbol(event.target.value));
    document.getElementById('watch-us-sessions-link')?.addEventListener('click',event=>{
      if(!selectSymbol(event.currentTarget.dataset.symbol)) event.preventDefault();
    });
    document.getElementById('us-session-refresh').addEventListener('click',refresh);
    refresh();
    setInterval(()=>{if(!document.hidden) refresh();},60000);
    setInterval(()=>{if(!document.hidden) render();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) refresh();});
  }
  document.addEventListener('DOMContentLoaded',init);
  return {refresh,syncSymbols};
})();
window.UsSessionsUI=UsSessionsUI;
