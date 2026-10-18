import {test,expect} from '@playwright/test';
import {createClient} from '@libsql/client';
import {makePlan,approve} from '../../lib/domain';
import {defaults} from '../preferences';
import {readFileSync} from 'node:fs';
const recipes=JSON.parse(readFileSync(new URL('../../data/recipes.json',import.meta.url),'utf8'));
import {prepareSimulation} from '../../lib/simulation';
import {placeSimulatedOrders} from '../../lib/simulated-provider';

test('confirmed delivery persists, fast demo advances after navigation, and cancellation persists',async({page,request})=>{
 await request.get('/api/state');
 const db=createClient({url:process.env.E2E_DATABASE_URL!});
 const before=String((await db.execute('SELECT state FROM household WHERE id=1')).rows[0].state);
 const state=JSON.parse(before);
 const plan=makePlan(recipes,{...defaults,budgetCents:50000},'2030-04-01');
 plan.pricingSource='kroger';plan.retailBasket={environment:'production',storeId:'test',storeName:'Demo store',fetchedAt:new Date().toISOString(),subtotalCents:1000*plan.batches.length,unresolved:0,finalTotalCents:null,batches:plan.batches.map(b=>({batchId:b.id,lines:[{name:'rice',unit:'g',required:100,pantryUsed:0,productId:'rice',packages:1,totalCents:1000}],subtotalCents:1000}))};
 prepareSimulation(plan);approve(plan);plan.agentPaidRevision=plan.revision;placeSimulatedOrders(plan);
 state.plans.push(plan);
 await db.execute({sql:'UPDATE household SET state=? WHERE id=1',args:[JSON.stringify(state)]});
 try {
   await page.goto(`/deliveries/${plan.id}`);
   await expect(page.locator('.delivery-status').first()).toHaveText('Confirmed');
   await expect(page.getByText('Demo mode · No real groceries purchased').first()).toBeVisible();
   await page.getByText('Demo controls',{exact:true}).click();
   await page.getByRole('button',{name:'Run fast delivery demo'}).click();
   await expect(page.getByText('Fast demo · simulated arrival',{exact:false}).first()).toBeVisible();
   // Simulate elapsed wall time in durable provider data, not a UI-only fake.
   const saved=JSON.parse(String((await db.execute('SELECT state FROM household WHERE id=1')).rows[0].state));
   const p=saved.plans.find((p:any)=>p.id===plan.id);
   for(const b of p.batches) b.fulfillment.shoppingAt=new Date(Date.now()-1000).toISOString();
   await db.execute({sql:'UPDATE household SET state=? WHERE id=1',args:[JSON.stringify(saved)]});
   await page.goto('/deliveries');await page.goto(`/deliveries/${plan.id}`);
   await expect(page.locator('.delivery-status').first()).toHaveText('Shopping');
   const cancel=await request.post('/api/sandbox/cancel',{headers:{Origin:'http://localhost:3100'},data:{planId:plan.id,batchId:plan.batches[0].id}});
   expect(cancel.ok()).toBe(true);
   await page.reload();await expect(page.locator('.delivery-status').first()).toHaveText('Cancelled');
   const card=page.locator('.delivery-record-card').nth(1);
   await card.getByRole('button',{name:'Next stage: Out for delivery',exact:true}).click();
   await expect(card.locator('.delivery-status')).toHaveText('Out for delivery');
   await page.reload();
   await expect(card.locator('.delivery-status')).toHaveText('Out for delivery');
   await card.getByRole('button',{name:'Next stage: Delivered',exact:true}).click();
   await expect(card.locator('.delivery-status')).toHaveText('Delivered');
   await expect(card.getByRole('status')).toHaveText('Delivery complete. Your order and receipt are saved.');
   await expect(card.getByRole('button',{name:/Next stage/})).toHaveCount(0);
   await page.setViewportSize({width:390,height:844});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 } finally {
   await db.execute({sql:'UPDATE household SET state=? WHERE id=1',args:[before]});db.close();
 }
});
