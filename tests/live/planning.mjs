// Opt-in integration test: real search/pricing calls and one new draft; never approves or pays.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
const baseURL = process.env.LIVE_TEST_URL || 'https://supper-club-umber.vercel.app';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(chrome) ? chrome : undefined) });
try {
  const context = await browser.newContext({ baseURL });
  const login = await context.request.post('/api/login', { headers: { Origin: baseURL }, data: { password: process.env.APP_PASSWORD } });
  assert.ok(login.ok(), `Login HTTP ${login.status()}`);
  const getState = async () => {
    const response = await context.request.get('/api/state');
    assert.ok(response.ok());
    return response.json();
  };
  const before = await getState();
  const resumeId=process.env.LIVE_TEST_RUN_ID;
  assert.ok(!before.agentRuns.some(r => r.status === 'running' && r.id !== resumeId), 'Another run is active; do not interfere');
  const previous = before.plans.find(p => p.id === before.activePlanId);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  let runId=resumeId;
  if(resumeId) {
    const response=await context.request.post('/api/agent/continue',{headers:{Origin:baseURL},data:{runId:resumeId}});
    assert.ok(response.ok(),`Resume HTTP ${response.status()}`);
  } else {
    const generate = page.waitForResponse(r => r.url().endsWith('/api/plans/generate') && r.request().method() === 'POST', {timeout: 30000});
    await page.getByRole('button', { name: /Find (new|my) dinners/ }).click();
    const response = await generate;
    assert.ok(response.ok(), `Generate HTTP ${response.status()}`);
    ({runId}=await response.json());
  }
  assert.ok(runId, 'Must use the AI planning path');
  console.log(JSON.stringify({startedRun:runId}));
  let state, run, steps = 0;
  const deadline = Date.now() + 300000;
  do {
    await page.waitForTimeout(3000);
    state = await getState();
    run = state.agentRuns.find(r=>r.id===runId);
    if (run?.trace.length > steps) {
      console.log(JSON.stringify({steps:run.trace.slice(steps)}));
      steps = run.trace.length;
    }
  } while (run?.status === 'running' && Date.now() < deadline);
  assert.equal(run?.status, 'awaiting_approval', run?.error || 'Planning did not complete');
  const plan = state.plans.find(p=>p.id===run.planId);
  assert.equal(state.activePlanId, plan.id);
  assert.notEqual(plan.id, previous?.id);
  assert.equal(plan.status, 'draft');
  assert.equal(plan.approvedRevision, undefined);
  assert.equal(state.payments.length, before.payments.length);
  assert.deepEqual(plan.preferences.cuisines, before.preferences.cuisines);
  assert.ok(plan.totalCents <= plan.preferences.budgetCents);
  assert.equal(plan.retailBasket?.unresolved, 0, "Every ingredient needs a retailer price");
  assert.equal(plan.simulationQuote?.mockItemsCents, 0);
  assert.ok(run.trace.some(step=>step.tool==='build_basket'), "Must actually build a basket");
  assert.equal(plan.meals.length, plan.preferences.days.length);
  if (process.env.LIVE_TEST_REQUIRE_VARIETY === '1') assert.equal(new Set(plan.meals.map(m=>m.recipe.title.toLowerCase())).size, plan.meals.length, 'Every dinner must be distinct in this scenario');
  assert.ok(run.trace.some(step=>step.display), 'Agent actions must have a user-facing description');
  for (const cuisine of plan.preferences.cuisines) assert.ok(plan.meals.some(m=>m.recipe.cuisine===cuisine));
  for (const {recipe} of plan.meals) {
    assert.ok(recipe.minutes > 0 && recipe.minutes <= 60);
    assert.ok(recipe.ingredients.length > 0 && recipe.source.startsWith('https://'));
  }
  assert.ok(plan.meals.some(m=>!previous?.meals.some(old=>old.recipe.id===m.recipe.id)), 'Must find a new meal');
  await expect(page.locator('.skeleton-card')).toHaveCount(0, {timeout:15000});
  await expect(page.getByText('The latest dinner search didn’t finish.', {exact:false})).toHaveCount(0);
  await expect(page.getByRole('button', {name:/Approve week & order/})).toBeEnabled();
  assert.deepEqual(errors, []);
  mkdirSync('test-results', {recursive:true});
  await page.screenshot({path:'test-results/live-planning.png', fullPage:true});
  console.log(JSON.stringify({passed:true,runId,totalCents:plan.totalCents,meals:plan.meals.map(m=>({title:m.recipe.title,minutes:m.recipe.minutes,cuisine:m.recipe.cuisine}))}));
} finally { await browser.close(); }
