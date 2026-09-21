import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(new URL('../../js/night-analysis.js', import.meta.url), 'utf8'), context);

function evaluate(night, indexes) {
  context.night = night;
  context.indexes = indexes;
  return JSON.parse(vm.runInContext('JSON.stringify(NightAnalysis.evaluate(night,indexes))', context));
}

test('night analysis uses TX as the primary signal and US indexes as confirmation', () => {
  const result = evaluate({ price:48000, changePct:0.58, stale:false }, [
    { symbol:'^GSPC', changePct:0.3 }, { symbol:'^IXIC', changePct:0.4 }, { symbol:'^SOX', changePct:0.6 },
  ]);
  assert.equal(result.label, '偏多');
  assert.equal(result.score, 5);
  assert.equal(result.drivers.length, 4);
});

test('stale night quotes never produce a directional label', () => {
  const result = evaluate({ price:48000, changePct:-2, stale:true }, []);
  assert.equal(result.usable, false);
  assert.equal(result.label, '資料不足');
});

test('slightly delayed night quotes retain a directional label', () => {
  const result = evaluate({ price:48000, changePct:0.58, stale:false, delayed:true }, []);
  assert.equal(result.usable, true);
  assert.equal(result.label, '偏多');
});
