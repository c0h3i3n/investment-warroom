import fs from 'node:fs/promises';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {inspectData,makeReport} from './lib/data-consistency.mjs';

export async function readJson(url,fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))) {
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const r=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'warroom-data-audit/1.0'},
        cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!r.ok) {
        const error=new Error(`HTTP ${r.status}`);
        error.retryable=r.status===429||r.status>=500;
        throw error;
      }
      return await r.json();
    } catch(e) {
      if(attempt===1||e.retryable===false) throw e;
      await pause(1500);
    }
  }
}

export async function collectData(base,scope,fetcher=fetch) {
  const data={scope,sessions:{},errors:{}};
  const tasks=[['market','/api/market'],['calendar','/api/market-calendar'],
    ...scope.quotes.filter(q=>q.region==='US').map(q=>[q.symbol,`/api/us-sessions?symbol=${encodeURIComponent(q.symbol)}`])];
  // Three requests at a time; inspect the public API, never fan out directly to exchanges.
  let cursor=0;
  await Promise.all(Array.from({length:3},async()=>{
    while(cursor<tasks.length) {
      const [key,path]=tasks[cursor++];
      try {
        const value=await readJson(base+path,fetcher);
        if(key==='market'||key==='calendar') data[key]=value;
        else data.sessions[key]=value;
      } catch {data.errors[key]=`${key} 資料取得失敗，重試後仍無法驗證`;}
    }
  }));
  return data;
}

async function main() {
  const context=vm.createContext({});
  vm.runInContext(await fs.readFile(new URL('../js/config.js',import.meta.url),'utf8'),context);
  const config=vm.runInContext('CONFIG',context);
  const scope={quotes:config.DEFAULT_WATCHLIST.map(({symbol,region})=>({symbol,region})),
    indexes:config.INDEXES.map(({symbol,region})=>({symbol,region}))};
  const file=new URL('../data/audit.json',import.meta.url);
  const previous=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);
  const data=await collectData(config.MARKET_API.replace(/\/$/,''),scope);
  const now=Date.now(),report=makeReport(inspectData(data,now),scope,previous,now);
  await fs.writeFile(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checkedAt:report.checkedAt,counts:report.counts}));
  for(const c of report.checks.filter(c=>['pending','warning'].includes(c.status))) console.log(`${c.status}: ${c.id}: ${c.message}`);
  if(process.env.GITHUB_STEP_SUMMARY) {
    const summary=`資料一致性巡檢：${report.status}\n\n查核時間：${report.checkedAt}\n\n通過 ${report.counts.pass}／未比對 ${report.counts.skip}／待確認 ${report.counts.pending}／持續異常 ${report.counts.warning}\n`;
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
  }
  // Publish every result, including failures. The workflow flags confirmed issues AFTER publishing.
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await main();
