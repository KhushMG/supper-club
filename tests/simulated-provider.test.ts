import {test} from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, approve } from '../lib/domain';
import {defaults} from './preferences';
import {recipes} from '../lib/recipes';
import {prepareSimulation,validSimulation} from '../lib/simulation';
import {placeSimulatedOrders,advanceFulfillment,startDeliveryDemo,cancelSimulatedOrder} from '../lib/simulated-provider';
function fixture() {
 const p=makePlan(recipes,{...defaults,budgetCents:50000},'2030-04-01');
 p.pricingSource='kroger';
 p.retailBasket={environment:'production',storeId:'test',storeName:'Test',fetchedAt:'2030-03-30T00:00:00Z',subtotalCents:1000*p.batches.length,unresolved:0,finalTotalCents:null,batches:p.batches.map(b=>({batchId:b.id,subtotalCents:1000,lines:[{name:'rice',unit:'g',required:100,pantryUsed:0,productId:'rice',packages:1,totalCents:1000}]}))};
 prepareSimulation(p);approve(p);p.agentPaidRevision=p.revision;return p;
}
const now=new Date('2030-03-30T12:00:00Z');
test('provider confirms durable future orders immediately and retries return the same orders',()=>{
 const p=fixture();assert.equal(placeSimulatedOrders(p,now),p.batches.length);
 const saved=JSON.parse(JSON.stringify(p));
 assert.equal(placeSimulatedOrders(saved,now),0);
 assert.deepEqual(saved.batches,p.batches);
 assert.ok(p.batches.every(b=>b.fulfillment?.stage==='confirmed'));
});
test('fast fulfillment catches up after downtime, stores ordered events once, and preserves actual slots',()=>{
 const p=fixture();placeSimulatedOrders(p,now);const arrival=p.batches[0].deliveryAt;
 startDeliveryDemo(p,now);
 advanceFulfillment(p,new Date(now.getTime()+40000));assert.equal(p.batches[0].fulfillment?.stage,'shopping');
 advanceFulfillment(p,new Date(now.getTime()+100000));assert.equal(p.batches[0].fulfillment?.stage,'out_for_delivery');
 assert.throws(()=>cancelSimulatedOrder(p.batches[0]),/no longer/);
 const restored=JSON.parse(JSON.stringify(p));
 advanceFulfillment(restored,new Date(now.getTime()+200000));
 assert.equal(restored.batches[0].status,'delivered');
 assert.equal(restored.batches[0].fulfillment.events.length,4);
 assert.equal(advanceFulfillment(restored,new Date(now.getTime()+200000)),0);
 assert.equal(restored.batches[0].deliveryAt,arrival);
});
test('unpaid, altered, expired and over-budget orders cannot submit',()=>{
 const p=fixture();delete p.agentPaidRevision;assert.throws(()=>placeSimulatedOrders(p,now),/payment/);
 p.agentPaidRevision=p.revision;p.preferences.budgetCents=1;assert.throws(()=>placeSimulatedOrders(p,now),/budget/);
 p.preferences.budgetCents=50000;assert.throws(()=>placeSimulatedOrders(p,new Date('2031-01-01')),/expired/);
 p.retailBasket!.batches[0].lines[0].totalCents=5000;
 assert.equal(validSimulation(p),false);assert.throws(()=>placeSimulatedOrders(p,now),/quote/);
 assert.ok(p.batches.every(b=>!b.orderId));
});
test('cancellation remains cancelled during retries and scheduled fulfillment',()=>{
 const p=fixture();placeSimulatedOrders(p,now);cancelSimulatedOrder(p.batches[0],now);
 cancelSimulatedOrder(p.batches[0],now);placeSimulatedOrders(p,now);
 advanceFulfillment(p,new Date('2031-01-01'));
 assert.equal(p.batches[0].status,'cancelled');assert.equal(p.batches[0].fulfillment?.events.length,2);
});
