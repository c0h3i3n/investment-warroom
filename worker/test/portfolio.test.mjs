import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function service(defaults = [{symbol:'0050.TW',name:'元大台灣50',shares:0,cost:0,region:'TW'}]) {
  const storage = new Map();
  const context = vm.createContext({ console, Date, CONFIG:{DEFAULT_HOLDINGS:defaults},
    localStorage:{getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,String(value))} });
  vm.runInContext(fs.readFileSync(new URL('../../js/portfolio.js',import.meta.url),'utf8'),context);
  return {context,storage};
}

test('a deleted default holding stays deleted', () => {
  const {context} = service();
  assert.equal(vm.runInContext('PortfolioService.getHoldings().length',context),1);
  assert.equal(vm.runInContext('PortfolioService.deleteHolding("0050.TW").ok',context),true);
  assert.equal(vm.runInContext('PortfolioService.getHoldings().length',context),0);
});

test('backup validates data and restores an empty or populated portfolio', () => {
  const {context} = service([]);
  const valid = {schema:'investment-warroom-portfolio',version:1,holdings:[
    {symbol:'NVDA',name:'NVIDIA',shares:2,cost:100,region:'US'}
  ]};
  context.payload = valid;
  assert.equal(vm.runInContext('PortfolioService.importBackup(payload).ok',context),true);
  assert.equal(vm.runInContext('PortfolioService.getHoldings()[0].symbol',context),'NVDA');
  context.payload = {...valid,holdings:[...valid.holdings,...valid.holdings]};
  assert.equal(vm.runInContext('PortfolioService.importBackup(payload).ok',context),false);
  assert.equal(vm.runInContext('PortfolioService.exportBackup().schema',context),'investment-warroom-portfolio');
});

test('mixed currencies retain separate totals', () => {
  const {context} = service([]);
  context.holdings = [
    {symbol:'2330.TW',name:'TSMC',shares:10,cost:1000,region:'TW'},
    {symbol:'NVDA',name:'NVIDIA',shares:2,cost:200,region:'US'},
  ];
  context.quotes = {
    '2330.TW':{price:1100,currency:'TWD',priceType:'indicative',asOf:1},
    NVDA:{price:250,currency:'USD',priceType:'trade',asOf:1},
  };
  const result = JSON.parse(vm.runInContext('JSON.stringify(PortfolioService.calculateStats(holdings,quotes))',context));
  assert.equal(result.mixedCurrency,true);
  assert.equal(result.byCurrency.TWD.totalValue,11000);
  assert.equal(result.byCurrency.USD.totalPnl,100);
  assert.equal(result.byCurrency.TWD.hasIndicative,true);
});
