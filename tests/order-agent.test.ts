import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type Stripe from 'stripe';
import { makePlan, approve, processDue } from '../lib/domain';
import { defaults } from "./preferences";
import {recipes} from '../lib/recipes';
import {prepareSimulation} from '../lib/simulation';
import {mutate,readState,database} from '../lib/db';
import {runOrderAgent} from '../lib/order-agent';
process.env.TURSO_DATABASE_URL='file:'+join(tmpdir(),'agent-'+crypto.randomUUID()+'.db');
test('approval drives payment then scheduled orders; failure, retry, duplicate and pause are safe',async()=>{
 const p=makePlan(recipes,{...defaults,budgetCents:50000},'2030-04-01');
 p.pricingSource='kroger';p.retailBasket={environment:'production',storeId:'fixture',storeName:'Test',fetchedAt:new Date().toISOString(),subtotalCents:1000*p.batches.length,unresolved:0,finalTotalCents:null,batches:p.batches.map(b=>({batchId:b.id,lines:[],subtotalCents:1000}))};
 prepareSimulation(p);approve(p);p.autoOrder=true;
 assert.equal(processDue(p,new Date('2030-04-01'),true),0);
 await mutate(s=>{s.plans=[p]});
 const keys:string[]=[];let fail=true;
 const stripe={paymentIntents:{create:async(args:any,options:any)=>{
  keys.push(options.idempotencyKey);
  if(fail){fail=false;throw new Error('network timeout')}
  return {id:'pi_test',livemode:false,amount:args.amount,currency:'usd',metadata:args.metadata,status:'succeeded'};
 }}} as unknown as Stripe;
 // First invocation persists a retryable attempt, never an unpaid order.
 await runOrderAgent(p.id,stripe,new Date('2030-03-30'));
 let s=await readState();assert.equal(s.payments.length,1);assert.ok(s.plans[0].agentError);assert.ok(s.plans[0].batches.every(b=>!b.orderId));
 await runOrderAgent(p.id,stripe,new Date('2030-03-30'));
 assert.equal(keys[0],keys[1]);
 s=await readState();assert.equal(s.payments[0].status,'paid');assert.ok(s.plans[0].batches.every(b=>b.orderId && b.fulfillment?.stage==='confirmed'));
 const now=new Date(p.batches[0].orderAt);
 await runOrderAgent(p.id,stripe,now);
 s=await readState();const ids=s.plans[0].batches.map(b=>b.orderId);assert.ok(ids[0]?.startsWith('sandbox_'));
 await runOrderAgent(p.id,stripe,now);
 assert.deepEqual((await readState()).plans[0].batches.map(b=>b.orderId),ids);assert.equal(keys.length,2);
 await mutate(s=>{s.plans[0].status='paused'});
 await runOrderAgent(p.id,stripe,new Date('2030-04-05'));
 assert.deepEqual((await readState()).plans[0].batches.map(b=>b.orderId),ids);
 // A declined PaymentIntent must not create deliveries; expired slots never call Stripe.
 const declined=structuredClone(p);declined.id=crypto.randomUUID();
 declined.batches.forEach(b=>{delete b.orderId;delete b.fulfillment;b.status='scheduled';});
 await mutate(s=>{s.plans.push(declined)});
 const rejected={paymentIntents:{create:async(args:any)=>({id:'pi_declined',livemode:false,amount:args.amount,currency:'usd',metadata:args.metadata,status:'requires_payment_method'})}} as unknown as Stripe;
 await runOrderAgent(declined.id,rejected,new Date('2030-03-30'));
 const failed=(await readState()).plans.find(x=>x.id===declined.id)!;
 assert.ok(failed.agentError);assert.ok(failed.batches.every(b=>!b.orderId));
 const expired=structuredClone(declined);expired.id=crypto.randomUUID();
 await mutate(s=>{s.plans.push(expired)});
 await runOrderAgent(expired.id,{paymentIntents:{create:async()=>{throw new Error('must not charge')}}} as unknown as Stripe,new Date('2031-01-01'));
 assert.equal((await readState()).payments.some(x=>x.planId===expired.id),false);
 database().close();
});
