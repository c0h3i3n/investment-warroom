import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {QUOTE_SYMBOLS} from '../src/index.mjs';
const ctx=vm.createContext({});
for(const file of ['config','watchlist-tools']) vm.runInContext(fs.readFileSync(new URL(`../../js/${file}.js`,import.meta.url),'utf8'),ctx);
const defaults=vm.runInContext('CONFIG.DEFAULT_WATCHLIST',ctx);
const migrate=vm.runInContext('WatchlistTools.addTechDefaults',ctx);
const tech=['MSFT','GOOGL','AMZN','AAPL','AMD','TSM'];
test('new technology stocks exist in browser, backend and static backup',()=>{
  const script=fs.readFileSync(new URL('../../scripts/fetch_data.py',import.meta.url),'utf8');
  const backup=script.match(/^watch_symbols = (.*)$/m)[1];
  for(const symbol of tech) {
    assert.equal(defaults.filter(item=>item.symbol===symbol&&item.region==='US').length,1);
    assert.ok(QUOTE_SYMBOLS.includes(symbol));
    assert.ok(backup.includes(`'${symbol}'`));
  }
  assert.equal(new Set(QUOTE_SYMBOLS).size,QUOTE_SYMBOLS.length);
});
test('existing lists gain stocks once without duplicates, renames or order changes',()=>{
  const old=[{symbol:'MSFT',name:'我的微軟',region:'US'},{symbol:'META',name:'Meta',region:'US'}];
  const updated=migrate(old,defaults,4);
  assert.equal(updated.length,7);
  assert.deepEqual(Array.from(updated.slice(0,2)),old);
  assert.equal(updated.filter(item=>item.symbol==='MSFT').length,1);
  const removed=updated.filter(item=>item.symbol!=='AMD');
  assert.equal(migrate(removed,defaults,6),removed);
  assert.equal(migrate(old,defaults,6),old);
});
test('migration respects the existing 25-stock limit and never evicts stocks',()=>{
  const full=Array.from({length:25},(_,i)=>({symbol:`X${i}`,name:'Custom',region:'US'}));
  assert.deepEqual(Array.from(migrate(full,defaults,4)),full);
  const almost=full.slice(0,24),result=migrate(almost,defaults,4);
  assert.equal(result.length,25);
  assert.deepEqual(Array.from(result.slice(0,24)),almost);
});


test('version 5 lists gain TSM once while previously removed technology stocks stay removed',()=>{
  const old=[{symbol:'NVDA',name:'我的輝達',region:'US'}];
  const updated=migrate(old,defaults,5);
  assert.deepEqual(Array.from(updated.map(item=>item.symbol)),['NVDA','TSM']);
  assert.equal(updated[0],old[0]);
  assert.equal(migrate(updated,defaults,5).filter(item=>item.symbol==='TSM').length,1);
  const removed=updated.filter(item=>item.symbol!=='TSM');
  assert.equal(migrate(removed,defaults,6),removed);
});
