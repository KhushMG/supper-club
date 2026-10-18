import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startPlanning,
  startExecution,
  driveAgent,
  agentTool,
} from "../lib/ai-agent";
import { getRun, saveRun } from "../lib/agent-runs";
import {
  cached,
  cacheKey,
  cachePut,
  reserveCall,
  usageSummary,
} from "../lib/agent-store";
import { makePlan, approve } from "../lib/domain";
import { defaults } from "./preferences";
import { recipes } from "../lib/recipes";
import { prepareSimulation } from "../lib/simulation";
import { readState, database, mutate } from "../lib/db";
process.env.TURSO_DATABASE_URL =
  "file:" + join(tmpdir(), "ai-agent-" + crypto.randomUUID() + ".db");
process.env.OPENAI_API_KEY = "test-only";
test("agent uses observed tool errors to choose its next tool; planning cannot execute orders", async () => {
  const original = globalThis.fetch;
  let count = 0;
  const requests: any[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    count++;
    return Response.json({
      output: [
        {
          type: "function_call",
          call_id: "call_" + count,
          name: count === 1 ? "save_proposal" : "report_blocker",
          arguments: JSON.stringify(
            count === 1
              ? { summary: "Invented total" }
              : { reason: "Need valid priced recipes before approval" },
          ),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  };
  try {
    const r = await startPlanning(
      { ...defaults, cuisines: ["Japanese"], recurring: false },
      "offline test",
    );
    assert.equal((await startPlanning(defaults, "double click")).id, r.id);
    await assert.rejects(
      () => agentTool(r, "submit_test_order", {}),
      /Unknown tool/,
    );
    assert.deepEqual((await readState()).preferences.cuisines, ["Japanese"]);
    await driveAgent(r.id);
    const saved = await getRun(r.id);
    assert.equal(saved?.status, "failed");
    assert.equal(count, 2);
    assert.ok(
      JSON.stringify(requests[1].input).includes(
        "Build a priced basket within budget",
      ),
    );
    assert.equal((await readState()).payments.length, 0);
    await driveAgent(r.id);
    assert.equal(count, 2);
  } finally {
    globalThis.fetch = original;
  }
});
test("unknown recipe IDs, missing days, stale approval and over-budget proposals are rejected", async () => {
  const r = await startPlanning(defaults, "validation test");
  r.catalog = recipes;
  await assert.rejects(() =>
    agentTool(r, "build_basket", { meals: [], selections: [] }),
  );
  await assert.rejects(
    () =>
      agentTool(r, "build_basket", {
        meals: defaults.days.map((day) => ({ day, recipeId: "invented" })),
        selections: [],
      }),
    /Unknown recipe/,
  );
  const p = makePlan(recipes, defaults, "2030-04-01");
  p.totalCents = defaults.budgetCents + 1;
  p.simulationQuote = {
    revision: p.revision,
    missingItems: [],
    mockItemsCents: 0,
    feeCents: 0,
    taxCents: 0,
    totalCents: p.totalCents,
  };
  r.candidate = p;
  await assert.rejects(
    () => agentTool(r, "save_proposal", { summary: "Over cap" }),
    /within budget/,
  );
  r.kind = "execution";
  r.planId = "not-approved";
  r.revision = 1;
  await assert.rejects(() => agentTool(r, "submit_test_order", {}), /Approval/);
  r.kind = "planning";
  r.status = "failed";
  await saveRun(r);
});
test("execution agent selects payment/order tool, verifies results and finishes without another charge", async () => {
  const p = makePlan(
    recipes,
    { ...defaults, budgetCents: 50000 },
    "2030-04-01",
  );
  p.simulationQuote = {
    revision: p.revision,
    totalCents: p.totalCents,
    missingItems: [],
    mockItemsCents: 0,
    feeCents: 0,
    taxCents: 0,
  };
  p.aiRunId = "prior-planning-run";
  p.autoOrder = true;
  approve(p);
  await mutate((s) => {
    s.plans.push(p);
    s.payments.push({
      id: "paid-fixture",
      planId: p.id,
      revision: p.revision,
      amountCents: p.totalCents,
      status: "paid",
      createdAt: new Date().toISOString(),
      expiresAt: 0,
    });
  });
  const original = globalThis.fetch;
  let count = 0;
  const names = [
    "inspect_approved_plan",
    "submit_test_order",
    "get_order_status",
    "finish",
  ];
  globalThis.fetch = async () =>
    Response.json({
      output: [
        {
          type: "function_call",
          call_id: "execution_" + count,
          name: names[count++],
          arguments: JSON.stringify(
            count === 4
              ? { summary: "Verified test payment and scheduled orders" }
              : {},
          ),
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  try {
    const r = await startExecution(p);
    await driveAgent(r.id);
    assert.equal((await getRun(r.id))?.status, "completed");
    const state = await readState();
    const saved = state.plans.find((x) => x.id === p.id)!;
    assert.equal(saved.aiExecutionRevision, p.revision);
    assert.equal(saved.agentPaidRevision, p.revision);
    assert.equal(state.payments.filter((x) => x.planId === p.id).length, 1);
    await driveAgent(r.id);
    assert.equal(count, 4);
  } finally {
    globalThis.fetch = original;
  }
});
test("search configuration errors stop immediately instead of spending more retry calls", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    if (body.tools[0].type === "web_search")
      return Response.json(
        { error: { message: "Unsupported parameter" } },
        { status: 400 },
      );
    return Response.json({
      output: [
        {
          type: "function_call",
          call_id: "bad-search",
          name: "search_recipes",
          arguments: JSON.stringify({
            cuisine: "Italian",
            query: "test specific pasta",
          }),
        },
      ],
    });
  };
  try {
    const run = await startPlanning(
      defaults,
      "configuration failure regression",
    );
    await driveAgent(run.id);
    assert.equal((await getRun(run.id))?.status, "failed");
    assert.equal(requests, 2);
    assert.match((await getRun(run.id))?.error || "", /Unsupported parameter/);
  } finally {
    globalThis.fetch = original;
  }
});
test("a valid priced proposal survives the model turn limit without another API call or order approval", async () => {
  const run = await startPlanning(
    { ...defaults, budgetCents: 50000 },
    "recover ready proposal",
  );
  const plan = makePlan(recipes, run.preferences, run.week);
  plan.simulationQuote = {
    revision: plan.revision,
    totalCents: plan.totalCents,
    missingItems: [],
    mockItemsCents: 0,
    feeCents: 0,
    taxCents: 0,
  };
  run.candidate = plan;
  run.calls = 8;
  await saveRun(run);
  const payments = (await readState()).payments.length;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Unexpected paid API request");
  };
  try {
    await driveAgent(run.id);
  } finally {
    globalThis.fetch = original;
  }
  const saved = await getRun(run.id);
  assert.equal(saved?.status, "awaiting_approval");
  const state = await readState();
  const proposal = state.plans.find((p) => p.id === saved?.planId)!;
  assert.equal(proposal.status, "draft");
  assert.equal(proposal.approvedRevision, undefined);
  assert.equal(state.payments.length, payments);
  await driveAgent(run.id);
  assert.equal(
    (await readState()).plans.filter((p) => p.aiRunId === run.id).length,
    1,
  );

  const invalid = await startPlanning(
    defaults,
    "over budget recovery rejected",
  );
  invalid.candidate = structuredClone(plan);
  invalid.candidate.week = invalid.week;
  invalid.candidate.totalCents = invalid.preferences.budgetCents + 1;
  invalid.calls = 8;
  await saveRun(invalid);
  await driveAgent(invalid.id);
  assert.equal((await getRun(invalid.id))?.status, "failed");
  assert.equal(
    (await readState()).plans.some((p) => p.aiRunId === invalid.id),
    false,
  );
});
test("a valid proposal survives the context size limit without a paid request", async () => {
  const run = await startPlanning({ ...defaults, budgetCents: 50000 }, "context recovery");
  const plan = makePlan(recipes, run.preferences, run.week);
  plan.simulationQuote = {
    revision: plan.revision, totalCents: plan.totalCents,
    missingItems: [], mockItemsCents: 0, feeCents: 0, taxCents: 0,
  };
  run.candidate = plan;
  run.input.push({ role: "user", content: "x".repeat(50000) });
  await saveRun(run);
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("Unexpected paid API request");
  };
  try {
    await driveAgent(run.id);
  } finally {
    globalThis.fetch = original;
  }
  const saved = await getRun(run.id);
  assert.equal(requests, 0);
  assert.equal(saved?.status, "awaiting_approval");
  assert.equal(saved?.error, undefined);
  const proposal = (await readState()).plans.find(p => p.id === saved?.planId)!;
  assert.equal(proposal.status, "draft");
  assert.equal(proposal.approvedRevision, undefined);
});
test("recipe search reports fetched-but-rejected pages and keeps their publishers available", async () => {
  const run = await startPlanning(defaults, "diagnose invalid sources");
  const slow = { ...recipes[0], source: "https://food.example/slow", minutes: 1470 };
  const broken = { ...recipes[0], source: "https://food.example/broken", minutes: 30, ingredients: ["0"] };
  for (const recipe of [slow, broken]) {
    await cachePut("recipe-v2:" + cacheKey({url: recipe.source, cuisine: defaults.cuisines[0]}), recipe, 60000);
  }
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({output:[{type:"message", content:[{text:JSON.stringify({recipes:[slow,broken].map(r=>({url:r.source,cuisine:defaults.cuisines[0]}))})}]}]});
  try {
    await assert.rejects(() => agentTool(run, "search_recipes", {cuisine:defaults.cuisines[0],query:"quick dinner rejection fixture"}), error => {
      assert.match(String(error), /1470 minutes/);
      assert.match(String(error), /Cannot read a published ingredient/);
      return true;
    });
    assert.deepEqual(run.unavailablePublishers, []);
    assert.equal(run.catalog.length, 0);
  } finally {
    globalThis.fetch = original;
    run.status = "failed";
    await saveRun(run);
  }
});
test("a within-budget test proposal with missing retailer matches saves with mock costs disclosed", async () => {
  const run = await startPlanning({ ...defaults, budgetCents: 50000 }, "simulation missing prices");
  const plan = makePlan(recipes, run.preferences, run.week);
  plan.retailBasket = {
    environment: "production", storeId: "test", storeName: "Fixture",
    fetchedAt: new Date().toISOString(), subtotalCents: 0, unresolved: 1, finalTotalCents: null,
    batches: plan.batches.map(b => ({batchId: b.id, subtotalCents: 0, lines: [{name: "capers", unit:"each",required:1,pantryUsed:0,issue:"No suitable product found"}]})),
  };
  prepareSimulation(plan);
  run.candidate = plan;
  const result = await agentTool(run, "save_proposal", {summary:"Test proposal includes labeled mock caper costs, delivery and tax."});
  assert.equal((result as {saved:boolean}).saved, true);
  const saved = (await readState()).plans.find(p=>p.id===run.planId)!;
  assert.equal(saved.simulationQuote?.mockItemsCents, 500);
  assert.equal(saved.status, "draft");
  assert.equal(saved.approvedRevision, undefined);
  await saveRun(run);
});
test("over-budget basket forces new recipe research, then reprices and saves without raising the cap", async () => {
  const preferences = {...defaults,cuisines:["Italian"],budgetCents:10000};
  const run = await startPlanning(preferences, "keep budget fixed");
  const expensive = {...recipes[0],id:"expensive",cuisine:"Italian",servings:2,minutes:30,ingredients:["100 g rice"]};
  const cheaper = {...expensive,id:"cheaper",title:"Quick beans",ingredients:["100 g beans"],source:"https://food.example/cheap-beans"};
  run.catalog=[expensive];
  for (const [name,cents] of [["rice",10000],["beans",100]] as const) {
    await cachePut("kroger-v2:"+cacheKey({environment:"production",zip:preferences.zip,names:[name]}),{
      provider:"Kroger",environment:"production",storeId:"fixture",storeName:"Fixture",fetchedAt:new Date().toISOString(),
      items:[{ingredient:name,productId:name,description:name,size:"16 oz",regularCents:cents}],
    },60000);
  }
  const meals=(recipeId:string)=>preferences.days.map(day=>({day,recipeId}));
  await agentTool(run,"build_basket",{meals:meals(expensive.id),selections:[]});
  assert.ok(run.candidate!.totalCents>preferences.budgetCents);
  assert.equal(run.budgetResearchRequired,true);
  await assert.rejects(()=>agentTool(run,"report_blocker",{reason:"Raise budget"}),/Research a cheaper dinner/);
  await assert.rejects(()=>agentTool(run,"build_basket",{meals:meals(expensive.id),selections:[]}),/Search for a different/);
  await cachePut("recipe-v2:"+cacheKey({url:cheaper.source,cuisine:"Italian"}),cheaper,60000);
  run.calls=7;
  await saveRun(run);
  const original=globalThis.fetch;
  let modelCalls=0;
  globalThis.fetch=async (_url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(body.tools[0].type==="web_search") return Response.json({output:[{type:"message",content:[{text:JSON.stringify({recipes:[{url:cheaper.source,cuisine:"Italian"}]})}]}]});
    modelCalls++;
    if(modelCalls===1) assert.deepEqual(body.tools.map((t:{name:string})=>t.name),["search_recipes"]);
    const name=modelCalls===1?"search_recipes":modelCalls===2?"build_basket":"save_proposal";
    const args=modelCalls===1?{cuisine:"Italian",query:"quick beans"}:modelCalls===2?{meals:meals(cheaper.id),selections:[]}:{summary:"New cheaper dinners fit the unchanged budget."};
    return Response.json({output:[{type:"function_call",call_id:"budget-"+modelCalls,name,arguments:JSON.stringify(args)}]});
  };
  try { await driveAgent(run.id); } finally {globalThis.fetch=original;}
  const saved=await getRun(run.id);
  assert.equal(saved?.status,"awaiting_approval");
  assert.equal(saved?.budgetResearchAttempts,1);
  assert.equal(saved?.preferences.budgetCents,10000);
  const plan=(await readState()).plans.find(p=>p.id===saved?.planId)!;
  assert.ok(plan.totalCents<=10000);
  assert.ok(plan.meals.every(m=>m.recipe.id==="cheaper"));
  assert.equal(plan.approvedRevision,undefined);
});
test("server cache expires and requests can exceed 20 per day while enforcing the lifetime cap", async () => {
  await cachePut("test", { answer: 42 }, 1000);
  assert.deepEqual(await cached("test"), { answer: 42 });
  await cachePut("expired", { answer: 42 }, -1);
  assert.equal(await cached("expired"), undefined);
  const before = await usageSummary();
  for (let i = before.calls; i < 200; i++) await reserveCall();
  await assert.rejects(() => reserveCall(), /spending guard/);
  assert.equal((await usageSummary()).calls, 200);
  database().close();
});
