import { makePlan } from "../../lib/domain";
import { defaults } from "../preferences";
import { readFileSync } from "node:fs";
const recipes = JSON.parse(
  readFileSync(new URL("../../data/recipes.json", import.meta.url), "utf8"),
);
import { test, expect } from "@playwright/test";
test("plan, swap, incomplete Kroger pricing holds purchases, responsive layout", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A good week starts at the table." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit preferences" }).click();
  for (const cuisine of defaults.cuisines) await page.getByRole("button", {name:cuisine,exact:true}).click();
  await page.getByLabel("Weekly budget · all in ($)").fill("500");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Find (my|new) dinners/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Weekly approvals" })
      .getByRole("button", { name: "Approve week & order", exact: false }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Swap Monday dinner" }).click();
  await page.locator(".swap-list button").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Weekly approvals" })
      .getByRole("button", { name: "Approve week & order", exact: false }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Grocery list", exact: true }).click();
  await expect(
    page.getByText("Kroger pricing is unavailable.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Sandbox cost" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "This week", exact: false })
    .first()
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "A good week starts at the table." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/supper-mobile.png",
    fullPage: true,
  });
});

test("completion waits for verified execution and opens the ordered week", async ({
  page,
  request,
}) => {
  const state = await (await request.get("/api/state")).json();
  const plan = makePlan(recipes, defaults, "2030-04-01");
  state.plans = [plan];
  plan.aiRunId = "planner-test";
  plan.status = "draft";
  plan.agentError = undefined;
  plan.agentPaidRevision = undefined;
  plan.totalCents = 1000;
  plan.simulationQuote = {
    revision: plan.revision,
    totalCents: 1000,
    missingItems: [],
    mockItemsCents: 0,
    feeCents: 0,
    taxCents: 0,
  };
  plan.batches.forEach((b: any) => {
    delete b.orderId;
  });
  state.activePlanId = plan.id;
  state.agentRuns = [];
  let verified = false;
  let selected = "";
  await page.route("**/api/state", (route) => {
    if (verified) {
      plan.agentPaidRevision = plan.revision;
      state.agentRuns[0].status = "completed";
    }
    return route.fulfill({ json: state });
  });
  await page.route("**/api/plans/approve", (route) => {
    plan.status = "approved";
    plan.approvedRevision = plan.revision;
    state.agentRuns = [
      {
        id: "execution-test",
        kind: "execution",
        status: "running",
        planId: plan.id,
        revision: plan.revision,
      },
    ];
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/plans/select", (route) => {
    selected = route.request().postDataJSON().planId;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(
    page.getByText("AI agent activity", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Approve week & order" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Aprons off. We’ve got this." }),
  ).toBeVisible();
  await expect(page.locator(".kitchen-toast")).toHaveCount(0);
  verified = true;
  await expect(
    page.getByRole("heading", { name: "Test checkout complete" }),
  ).toBeVisible({ timeout: 10000 });
  await page
    .getByRole("button", { name: "View this week’s deliveries" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(selected).toBe(plan.id);
  await expect(
    page.getByRole("heading", { name: "A little planning. Right on time." }),
  ).toBeVisible();
});

test("planning displays skeleton menus and a toast until the proposal is ready", async ({
  page,
  request,
}) => {
  const state = await (await request.get("/api/state")).json();
  const plan = makePlan(recipes, defaults, "2030-04-01");
  state.plans = [plan];
  state.activePlanId = plan.id;
  state.agentRuns = [
    { id: "planning-loading", kind: "planning", status: "running" },
  ];
  let ready = false;
  await page.route("**/api/state", (route) => {
    state.agentRuns[0].status = ready ? "awaiting_approval" : "running";
    return route.fulfill({ json: state });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Finding your next favorite dinners…" }),
  ).toBeVisible();
  await expect(page.locator(".skeleton-card")).toHaveCount(
    defaults.days.length,
  );
  await expect(page.locator(".kitchen-toast")).toHaveCount(0);
  await expect(page.locator(".loading-emblem")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  ready = true;
  await expect(page.locator(".skeleton-card")).toHaveCount(0, {
    timeout: 10000,
  });
  await expect(page.locator(".kitchen-toast")).toContainText(
    "Your week is ready to review",
  );
});

test("page refresh renders only the loader until data is ready", async ({
  page,
  request,
}) => {
  const state = await (await request.get("/api/state")).json();
  let release: (() => void) | undefined;
  await page.route("**/api/state", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: state });
  });
  await page.goto("/");
  await expect(
    page.getByRole("status", { name: "Loading your kitchen" }),
  ).toBeVisible();
  await expect(
    page.locator(
      ".app-shell, .skeleton-card, .kitchen-toast, .page-loading .spin",
    ),
  ).toHaveCount(0);
  await expect.poll(() => !!release).toBe(true);
  release!();
  await expect(page.locator(".app-shell")).toBeVisible();
  release = undefined;
  await page.getByRole("button", { name: "Refresh plan" }).click();
  await expect(
    page.getByRole("status", { name: "Loading your kitchen" }),
  ).toBeVisible();
  await expect(
    page.locator(
      ".app-shell, .skeleton-card, .kitchen-toast, .page-loading .spin",
    ),
  ).toHaveCount(0);
  await expect.poll(() => !!release).toBe(true);
  release!();
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("cuisine choices survive refresh and stay on one row", async ({
  page,
  request,
}) => {
  const state = await (await request.get("/api/state")).json();
  state.preferences = { ...defaults, cuisines: ["Japanese"] };
  state.agentRuns = [];
  await page.route("**/api/state", (route) => route.fulfill({ json: state }));
  await page.goto("/");
  await page.getByRole("button", { name: "Edit preferences" }).click();
  const japanese = page.getByRole("button", { name: "Japanese", exact: true });
  const thai = page.getByRole("button", { name: "Thai", exact: true });
  await expect(japanese).toHaveAttribute("aria-pressed", "true");
  await thai.click();
  await page.getByRole("button", { name: "Close preferences" }).click();
  await page.getByRole("button", { name: "Refresh plan" }).click();
  await page.getByRole("button", { name: "Edit preferences" }).click();
  await expect(thai).toHaveAttribute("aria-pressed", "true");
  await expect(japanese).toHaveAttribute("aria-pressed", "true");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const rows = await page
      .locator(".cuisine-chips button")
      .evaluateAll(
        (buttons) =>
          new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)))
            .size,
      );
    expect(rows).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("new households have no preselected cuisines or sample meals", async ({page,request}) => {
  const state = await (await request.get('/api/state')).json();
  state.preferences = {...defaults,cuisines:[]};
  state.plans=[]; state.activePlanId=undefined; state.agentRuns=[];
  await page.route('**/api/state', route=>route.fulfill({json:state}));
  let generationRequests=0;
  await page.route('**/api/plans/generate', route=>{generationRequests++;return route.fulfill({json:{}});});
  await page.goto('/');
  await expect(page.locator('.meal-card')).toHaveCount(0);
  await page.getByRole('button',{name:/Find my dinners/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for(const cuisine of ['Italian','Mexican','Indian','Japanese']) {
    await expect(page.getByRole('button',{name:cuisine,exact:true})).toHaveAttribute('aria-pressed','false');
  }
  await expect(page.getByRole('button',{name:'Save preferences',exact:true})).toBeDisabled();
  expect(generationRequests).toBe(0);
});

test("missing photos and non-image responses show a fallback in cards and recipe details", async ({page,request}) => {
  const state=await (await request.get('/api/state')).json();
  const plan=makePlan(recipes,defaults,'2030-04-01');
  plan.meals=plan.meals.map((m,i)=>({...m,recipe:{...m.recipe,image:i===0?'A description of a bowl of curry':'https://photos.example/description'}}));
  state.plans=[plan];state.activePlanId=plan.id;state.agentRuns=[];
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.route('https://photos.example/**',route=>route.fulfill({status:200,contentType:'text/html',body:'A description instead of an image'}));
  await page.goto('/');
  await expect(page.locator('.image-button').first()).toBeVisible();
  for(const card of await page.locator('.image-button').all()) await card.scrollIntoViewIfNeeded();
  await expect(page.locator('.image-button .recipe-photo-fallback')).toHaveCount(plan.meals.length);
  await expect(page.locator('.image-button img')).toHaveCount(0);
  await page.locator('.image-button').first().click();
  await expect(page.locator('.recipe-modal .recipe-photo-fallback')).toBeVisible();
  await expect(page.locator('.recipe-modal img')).toHaveCount(0);
  await page.getByRole('button',{name:'Close recipe',exact:true}).click();
  // A new plan with a valid photo must not inherit the old failure state.
  const image='https://photos.example/valid.svg';
  await page.route(image,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>'}));
  plan.meals[0].recipe.image=image;
  await page.getByRole('button',{name:'Refresh plan',exact:true}).click();
  await expect(page.locator('.image-button img').first()).toBeVisible();
  await expect.poll(()=>page.locator('.image-button img').first().evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
});

test("failed planning explains its budget blocker while preserving the user's cuisines", async ({page,request}) => {
  const state=await (await request.get('/api/state')).json();
  const plan=makePlan(recipes,defaults,'2030-04-01');
  state.preferences={...defaults,cuisines:['Japanese','Thai']};
  state.plans=[plan];state.activePlanId=plan.id;
  state.agentRuns=[{id:'over-budget',kind:'planning',status:'failed',error:'The replacement basket still exceeds your $275 budget. No order was placed.'}];
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.goto('/');
  await page.getByText('Why this plan wasn’t saved',{exact:true}).click();
  await expect(page.locator('details').getByText(state.agentRuns[0].error,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit preferences',exact:true}).click();
  await expect(page.getByRole('button',{name:'Japanese',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'Italian',exact:true})).toHaveAttribute('aria-pressed','false');
});

test("photos stay hidden until loaded and budget cap stays together", async ({page,request}) => {
  const state=await (await request.get('/api/state')).json();
  const plan=makePlan(recipes,{...defaults,budgetCents:27500},'2030-04-01');
  plan.meals=plan.meals.map(m=>({...m,recipe:{...m.recipe,image:'https://photos.example/slow.svg'}}));
  state.plans=[plan];state.activePlanId=plan.id;state.agentRuns=[];
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('https://photos.example/slow.svg',async route=>{
    await pending;
    await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>'});
  });
  await page.goto('/');
  const first=page.locator('.image-button').first();
  await expect(first.locator('img')).toHaveCSS('opacity','0');
  await expect(first.locator('img')).toHaveAttribute('alt','');
  await expect(first.locator('.recipe-photo-fallback')).toBeVisible();
  release();
  await expect(first.locator('img')).toHaveCSS('opacity','1');
  await expect(first.locator('.recipe-photo-fallback')).toHaveCount(0);
  for(const width of [1280,1024,390]) {
    await page.setViewportSize({width,height:900});
    const cap=page.locator('.budget-cap');
    await expect(cap).toHaveCSS('white-space','nowrap');
    expect(await cap.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size;})).toBe(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test("saving preferences does not start planning",async({page,request})=>{
  const state=await(await request.get('/api/state')).json();
  state.agentRuns=[];
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  let saves=0,starts=0;
  await page.route('**/api/preferences',route=>{
    saves++;state.preferences=route.request().postDataJSON();return route.fulfill({json:{ok:true}});
  });
  await page.route('**/api/plans/generate',route=>{starts++;return route.fulfill({json:{runId:'test'}});});
  await page.goto('/');
  await page.getByRole('button',{name:'Edit preferences',exact:true}).click();
  const budget=page.getByLabel('Weekly budget · all in ($)');
  await budget.fill(''); await expect(budget).toHaveValue('');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  expect(saves).toBe(0);
  await budget.fill('275');
  await page.getByLabel('Dietary preference').selectOption('kosher');
  const people=page.getByLabel('People at the table');
  await people.fill(''); await expect(people).toHaveValue(''); await people.fill('2');
  await page.getByText('A few more preferences',{exact:true}).click();
  const tip=page.getByLabel('Tip per delivery ($)');
  await tip.fill(''); await expect(tip).toHaveValue('');
  await expect(page.getByLabel('Timezone').locator('option')).toHaveCount(8);
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(saves).toBe(1);expect(starts).toBe(0);
  expect(state.preferences.diet).toBe('kosher');
  expect(state.preferences.tipCents).toBe(0);
  await page.reload();
  await page.getByRole('button',{name:'Edit preferences',exact:true}).click();
  await expect(page.getByLabel('Weekly budget · all in ($)')).toHaveValue('275');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/Find (my|new) dinners/}).click();
  await expect.poll(()=>starts).toBe(1);
});

test("profile identity appears in the sidebar and account page, with working sign-out",async({page,context})=>{
  const {createHmac}=await import('node:crypto');
  const profile={id:'google:test-account',name:'Alex Cook',email:'member@example.com',provider:'google'};
  const body=Buffer.from(JSON.stringify({purpose:'session',exp:Date.now()+600000,profile})).toString('base64url');
  const signature=createHmac('sha256','browser-test-signing-secret-not-for-production-12345').update(body).digest('base64url');
  await context.addCookies([{name:'supper_session',value:body+'.'+signature,url:'http://localhost:3100',httpOnly:true,sameSite:'Lax'}]);
  await page.goto('/');
  let planningCalls = 0;
  page.on('request', request => { if (request.url().endsWith('/api/plans/generate')) planningCalls++; });
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('button',{name:'Italian',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Japanese',exact:true}).click();
  await page.getByLabel('Dietary preference').selectOption('halal');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('People at the table')).toHaveValue('');
  await page.getByLabel('People at the table').fill('2');
  await expect(page.getByLabel('Time zone').locator('option')).toHaveText(['Eastern','Central','Mountain','Arizona (no daylight saving)','Pacific','Alaska','Aleutian Islands','Hawaii']);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('Weekly budget ($)')).toHaveValue('');
  await page.getByLabel('Weekly budget ($)').fill('200');
  await page.getByLabel('ZIP code').fill('98101');
  await page.getByRole('button',{name:'Save preferences & continue'}).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  expect(planningCalls).toBe(0);
  expect((await (await page.request.get('/api/state')).json()).preferences.diet).toBe('halal');
  await page.reload();
  await expect(page).toHaveURL('http://localhost:3100/');
  const link=page.getByRole('link',{name:'View your profile'});
  await expect(link).toContainText('Alex Cook');
  await expect(link).toContainText('member@example.com');
  await link.click();
  await expect(page.getByRole('heading',{name:'Your profile'})).toBeVisible();
  await expect(page.locator('dd').filter({hasText:'member@example.com'})).toBeVisible();
  await expect(page.getByText('google:test-account',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some(c=>c.name==='supper_session')).toBe(false);
});

test("recipe popup cleans publisher punctuation and remains readable on mobile", async ({page,request}) => {
  const state=await (await request.get('/api/state')).json();
  const plan=makePlan(recipes,defaults,'2030-04-01');
  const ingredients=['½ lb steak (flank or other cut) (, thinly sliced)','1 lb fresh wide rice noodles ((sen yai))','1 lb Chinese broccoli (gai lan) ( , cut into 2-inch pieces)','2 eggs (, beaten)','White pepper (, to taste)','|'];
  plan.meals[0].recipe={...plan.meals[0].recipe,servings:4,ingredients};
  state.plans=[plan]; state.activePlanId=plan.id; state.agentRuns=[];
  await page.route('**/api/state',r=>r.fulfill({json:state}));
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:800});
    await page.goto('/'); await page.locator('.image-button').first().click();
    const dialog=page.locator('.recipe-modal');
    await expect(dialog.locator('.ingredients li')).toHaveText(['½ lb steak (flank or other cut), thinly sliced','1 lb fresh wide rice noodles (sen yai)','1 lb Chinese broccoli (gai lan), cut into 2-inch pieces','2 eggs, beaten','White pepper, to taste']);
    await expect(dialog).toContainText('original 4-serving recipe');
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    const source=dialog.getByRole('link',{name:'Cook with the original recipe'});
    await source.scrollIntoViewIfNeeded(); await expect(source).toBeInViewport();
    await page.getByRole('button',{name:'Close recipe',exact:true}).click();
    await expect(dialog).toHaveCount(0);
  }
});
