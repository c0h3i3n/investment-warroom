// A dated server-side inspection, separate from the browser's live quote status.
globalThis.DataAudit = (() => {
  const MAX_AGE=45*60000, states=['pass','skip','pending','warning'];
  const labels={pass:'通過',skip:'未比對',pending:'待確認',warning:'持續異常'};
  let report=null,failed=false,loading=false;
  function view(value,now=Date.now()) {
    const checked=Date.parse(value?.checkedAt),expires=Date.parse(value?.expiresAt);
    const valid=value?.schemaVersion===1&&Array.isArray(value.checks)&&value.checks.length>0
      &&value.checks.every(c=>states.includes(c.status)&&typeof c.message==='string'&&typeof c.id==='string')
      &&states.every(s=>value.counts?.[s]===value.checks.filter(c=>c.status===s).length)
      &&Array.isArray(value.scope?.quotes)&&Array.isArray(value.scope?.indexes)
      &&Number.isFinite(checked)&&checked<=now+60000&&Number.isFinite(expires)
      &&expires>checked&&expires-checked<=MAX_AGE;
    if(!valid) return {state:'unavailable',label:'尚無有效巡檢報告'};
    if(now>expires||now-checked>MAX_AGE) return {state:'stale',label:'巡檢逾時，待確認',checked};
    const state=value.counts.warning?'warning':value.counts.pending?'pending':value.counts.skip?'partial':'ok';
    return {state,label:{ok:'通過',partial:'已檢查，部分未比對',pending:'有項目待確認',warning:'發現持續異常'}[state],checked};
  }
  function render() {
    const root=document.getElementById('data-audit');
    if(!root) return;
    const v=view(report),body=document.getElementById('data-audit-detail');
    root.dataset.state=v.state;
    document.getElementById('data-audit-status').textContent=v.label;
    document.getElementById('data-audit-time').textContent=v.checked?' · '+new Intl.DateTimeFormat('zh-TW',{
      timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,
    }).format(new Date(v.checked))+'（台北時間）':'';
    body.replaceChildren();
    function line(text) {const p=document.createElement('p');p.textContent=text;body.appendChild(p);}
    if(!v.checked) {line('尚未取得可驗證的巡檢結果；不代表資料已通過檢查。');return;}
    line(`範圍：預設 ${report.scope.quotes.length} 檔自選股、${report.scope.indexes.length} 項指數、美股三時段與官方行事曆。瀏覽器自行新增的股票未包含在排程巡檢內。`);
    line(`通過 ${report.counts.pass} 項 · 未比對 ${report.counts.skip} 項 · 待確認 ${report.counts.pending} 項 · 持續異常 ${report.counts.warning} 項。`);
    if(v.state==='stale') line('這是上次巡檢結果，已超過有效時間；目前狀態尚未確認。');
    if(failed) line('最新巡檢報告暫時無法讀取，保留上次結果及原始時間。');
    const attention=report.checks.filter(c=>c.status!=='pass').sort((a,b)=>states.indexOf(b.status)-states.indexOf(a.status));
    if(attention.length) {
      const list=document.createElement('ul');
      for(const c of attention) {const li=document.createElement('li');li.textContent=`${labels[c.status]}：${c.message}`;list.appendChild(li);}
      body.appendChild(list);
    }
    line('約每 15 分鐘及發布後檢查；排程可能延遲，45 分鐘未更新即標示逾時。不同來源時間不直接比價，連續兩次異常才升級警示。');
    line('檢查資料一致性與時效，並非獨立行情來源的正確性認證。');
  }
  async function refresh() {
    if(loading) return;
    loading=true;
    try {
      const response=await fetch('data/audit.json',{cache:'no-store',signal:requestTimeoutSignal(10000)});
      if(!response.ok) throw new Error('Audit unavailable');
      const next=await response.json();
      if(view(next).state==='unavailable') throw new Error('Invalid audit');
      // A slower CDN response must not roll back a newer report.
      if(!report||Date.parse(next.checkedAt)>=Date.parse(report.checkedAt)) report=next;
      failed=false;
    } catch {failed=true;}
    finally {loading=false;render();}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    if(!document.getElementById('data-audit')) return;
    refresh();
    setInterval(()=>{if(!document.hidden) refresh();},5*60000);
    setInterval(()=>{if(!document.hidden) render();},60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) refresh();});
  });
  return {view};
})();
