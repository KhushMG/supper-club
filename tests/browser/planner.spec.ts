import { defaults, makePlan } from "../../lib/domain";
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
  await page.getByLabel("Weekly budget · all in ($)").fill("500");
  await page.getByRole("button", { name: "Build my dinner plan" }).click();
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
  await expect(page.locator(".kitchen-toast")).toContainText(
    "Your week is approved",
  );
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
  await expect(page.locator(".kitchen-toast")).toContainText("Chef’s on it!");
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
    page.locator(".app-shell, .skeleton-card, .kitchen-toast, .page-loading .spin"),
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
    page.locator(".app-shell, .skeleton-card, .kitchen-toast, .page-loading .spin"),
  ).toHaveCount(0);
  await expect.poll(() => !!release).toBe(true);
  release!();
  await expect(page.locator(".app-shell")).toBeVisible();
});
