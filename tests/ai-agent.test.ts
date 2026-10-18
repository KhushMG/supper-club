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
  cachePut,
  reserveCall,
  usageSummary,
} from "../lib/agent-store";
import { defaults, makePlan, approve } from "../lib/domain";
import { recipes } from "../lib/recipes";
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
