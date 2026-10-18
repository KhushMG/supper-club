import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makePlan, defaults, approve, processDue} from '../lib/domain';
import {recipes} from '../lib/recipes';
import {prepareSimulation, validSimulation} from '../lib/simulation';
function fixture() {
  const p = makePlan(recipes, {...defaults,budgetCents:50000}, '2030-04-01');
  p.pricingSource = 'kroger';
  p.retailBasket = {environment:'production',storeId:'test',storeName:'Fixture',fetchedAt:new Date().toISOString(),
    subtotalCents:p.batches.length*1000, unresolved:p.batches.length,finalTotalCents:null,
    batches:p.batches.map(b=>({batchId:b.id,subtotalCents:1000,lines:[
      {name:'rice',unit:'g',required:100,pantryUsed:0,packages:1,totalCents:1000},
      {name:'tomatoes',unit:'g',required:100,pantryUsed:0,issue:'No price'},
    ]}))};
  return p;
}
test('simulation preserves real price evidence, labels mock items, and orders idempotently',()=>{
  const p=fixture();const evidence=JSON.stringify(p.retailBasket);
  prepareSimulation(p);
  assert.equal(JSON.stringify(p.retailBasket),evidence);
  assert.equal(p.simulationQuote?.mockItemsCents,500);
  assert.equal(p.simulationQuote?.missingItems.length,1);
  assert.equal(p.totalCents, p.batches.length*(1000+599+80)+540);
  assert.ok(validSimulation(p));
  approve(p);
  assert.equal(processDue(p,new Date('2030-04-01'),true),p.batches.length);
  assert.equal(processDue(p,new Date('2030-04-01'),true),0);
  assert.ok(p.batches.every(b=>b.orderId?.startsWith('sandbox_')));
});
test('simulation cannot bypass budget cap or stale quote checks',()=>{
  const p=fixture();prepareSimulation(p);
  p.preferences.budgetCents=p.totalCents-1;
  assert.throws(()=>approve(p),/budget/);
  p.preferences.budgetCents=p.totalCents;
  approve(p);
  p.revision++;
  assert.equal(validSimulation(p),false);
  assert.equal(processDue(p,new Date(),true),0);
});
test('simulation requires a fetched basket',()=>{
  const p=fixture();delete p.retailBasket;
  assert.throws(()=>prepareSimulation(p),/Refresh Kroger/);
});
