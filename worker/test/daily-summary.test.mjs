import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=file=>fs.readFileSync(new URL(`../../js/${file}.js`,import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source('indicators'),ctx);
const summary=vm.runInContext('IndicatorsService.summarizeDaily',ctx);
const base={price:100,ma20:110,ma60:105,rsi:45,macd:{histogram:-.2},stoch:{k:30,d:35},volume:{ratio:.72}};

test('daily summary describes trend, momentum and volume independently',()=>{
  const weak=summary(base);
  assert.equal(weak.headline,'趨勢偏弱；動能偏弱');
  assert.match(weak.volume,/72%（非方向訊號）/);
  assert.match(weak.explanation,/不加權評分/);
  assert.equal(summary({...base,price:120,rsi:55,macd:{histogram:.2},stoch:{k:40,d:35}}).headline,'趨勢偏強；動能偏強');
  assert.equal(summary({...base,stoch:{k:40,d:35}}).headline,'趨勢偏弱；動能訊號分歧');
  assert.equal(summary({...base,price:107}).headline,'均線位置分歧；動能偏弱');
  assert.equal(summary({...base,rsi:50,macd:{histogram:0},stoch:{k:35,d:35}}).headline,'趨勢偏弱；動能中性');
});
test('summary never coerces missing values or counts absent volume',()=>{
  for(const key of ['price','ma20','ma60','rsi','macd','stoch']) {
    assert.equal(summary({...base,[key]:null}),null);
  }
  assert.equal(summary({...base,rsi:NaN}),null);
  assert.match(summary({...base,volume:null}).volume,/不足/);
  assert.match(summary({...base,volume:{ratio:0}}).volume,/0%/);
});
test('historical and lagging data cannot display current summary even when it exists',()=>{
  for(const meta of [{historical:true},{lagSessions:1}]) {
    const grid={innerHTML:'',appendChild(){}};
    const context=vm.createContext({document:{getElementById:id=>id==='ind-grid'?grid:null,createElement:()=>({})}});
    vm.runInContext(source('ui'),context);
    context.data={symbol:'0050.TW',asOf:Date.parse('2026-10-28T01:00:00Z'),
      historyMeta:meta,summary:summary(base),indicators:[{name:'RSI',value:'45',signal:'動能偏弱'}]};
    vm.runInContext('UI.renderIndicators(data)',context);
    assert.match(grid.innerHTML,/摘要判斷暫停/);
    assert.doesNotMatch(grid.innerHTML,/趨勢偏弱；動能偏弱/);
  }
});
test('refresh feedback persists with time, counts, loading and partial/error distinctions',()=>{
  const output={textContent:'',dataset:{}};
  const context=vm.createContext({Intl,Date,setTimeout(){},document:{getElementById:id=>id==='refresh-result'?output:null,
    querySelector:()=>null,createElement:()=>({setAttribute(){}}),body:{appendChild(){}}}});
  vm.runInContext(source('ui'),context);
  vm.runInContext('UI.setRefreshing(true)',context);
  assert.equal(output.dataset.state,'loading');
  vm.runInContext('UI.setRefreshing(false)',context);
  vm.runInContext('UI.refreshResult({fresh:16,total:16,changed:false})',context);
  assert.equal(output.dataset.state,'success');
  assert.match(output.textContent,/16\/16.*來源暫無新的報價/);
  assert.match(output.textContent,/此時間不是報價成交時間/);
  const lastResult=output.textContent;
  vm.runInContext('UI.setRefreshing(true,false); UI.setRefreshing(false)',context);
  assert.equal(output.textContent,lastResult);
  assert.equal(output.dataset.state,'success');
  vm.runInContext('UI.refreshResult({fresh:12,total:16,failed:true})',context);
  assert.equal(output.dataset.state,'warning');
  vm.runInContext('UI.refreshResult({fresh:0,total:16})',context);
  assert.equal(output.dataset.state,'error');
});
