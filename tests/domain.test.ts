import { test } from "node:test";
import assert from "node:assert/strict";
import { ingredient, purchaseIngredient, makePlan, approve, quote, processDue, pause, sandboxBasket, nextMonday, compatible, preferenceSchema } from "../lib/domain";
import { defaults } from "./preferences";
import { recipes } from "../lib/recipes";
const prefs = () => ({ ...structuredClone(defaults), budgetCents: 50000 });
const draft = () => makePlan(recipes, prefs(), "2030-04-01");
test("fractions and unit conversions are numeric and measured", () => {
  assert.equal(ingredient("1½ cups rice").quantity, 360);
  assert.equal(ingredient("1/2 lb pasta").quantity, 226.796);
  assert.equal(ingredient("2 cloves garlic").quantity, 2);
  assert.throws(() => ingredient("salt to taste"));
});
test("unmeasured ingredients remain usable for whole-package purchasing", () => {
  const r = { ...recipes[0], ingredients: ["salt to taste"] };
  assert.equal(compatible(r, prefs()), true);
  assert.deepEqual(purchaseIngredient("salt to taste"), {
    name: "salt",
    unit: "package",
    quantity: 1,
  });
});
test("whole packages and pantry subtraction", () => {
  const r = { ...recipes[0], servings: 2, ingredients: ["500 g rice"] };
  const p = { ...prefs(), servings: 2 };
  const basket = sandboxBasket([{ recipe: r }], p, []);
  assert.equal(basket[0].packages, 2);
  assert.equal(basket[0].totalCents, 358);
  const pantry = [{ name: "rice", quantity: 300, unit: "g" }];
  const reduced = sandboxBasket([{ recipe: r }], p, pantry);
  assert.equal(reduced[0].packages, 1);
  assert.equal(pantry[0].quantity, 254);
});
test("exact all-in budget accepted, one cent lower blocked", () => {
  const p = draft();
  p.preferences.budgetCents = p.totalCents;
  quote(p);
  approve(p);
  assert.equal(p.status, "approved");
  const p2 = draft();
  p2.preferences.budgetCents = p2.totalCents - 1;
  quote(p2);
  assert.equal(p2.status, "infeasible");
  assert.throws(() => approve(p2));
});
test("draft, paused and stale approvals cannot order", () => {
  const p = draft();
  assert.equal(processDue(p, new Date(), true), 0);
  approve(p);
  p.revision++;
  assert.equal(processDue(p, new Date(), true), 0);
  p.revision--;
  pause(p);
  assert.equal(processDue(p, new Date(), true), 0);
});
test("duplicate runner calls do not duplicate orders", () => {
  const p = draft();
  approve(p);
  assert.equal(processDue(p, new Date(), true), p.batches.length);
  assert.equal(processDue(p, new Date(), true), 0);
  assert.equal(new Set(p.batches.map((b) => b.orderId)).size, p.batches.length);
});
test("orders stay under cap even when a batch is repriced", () => {
  const p = draft();
  p.preferences.budgetCents = p.totalCents;
  approve(p);
  p.batches[0].totalCents = p.preferences.budgetCents + 1;
  processDue(p, new Date(), true);
  assert.equal(p.batches[0].status, "held");
  assert.ok(
    p.batches
      .filter((b) => b.status === "submitted")
      .reduce((s, b) => s + b.totalCents, 0) <= p.preferences.budgetCents,
  );
});
test("past windows are held, never silently ordered", () => {
  const p = draft();
  approve(p);
  processDue(p, new Date("2031-01-01"));
  assert.ok(p.batches.every((b) => b.status === "held"));
});
test("delivery times respect DST and one hour cooking buffer", () => {
  const a = makePlan(
    recipes,
    { ...prefs(), days: [0], cookingTime: "18:30" },
    "2030-03-04",
  );
  const b = makePlan(
    recipes,
    { ...prefs(), days: [0], cookingTime: "18:30" },
    "2030-03-11",
  );
  assert.equal(new Date(a.batches[0].deliveryAt).getUTCHours(), 1);
  assert.equal(new Date(b.batches[0].deliveryAt).getUTCHours(), 0);
});
test("invalid budget, timezone, cooking time and days rejected", () => {
  for (const changed of [
    { budgetCents: -1 },
    { timezone: "oops" },
    { cookingTime: "25:00" },
    { days: [] },
  ])
    assert.throws(() => preferenceSchema.parse({ ...defaults, ...changed }));
});
test("next Monday uses household local date", () => {
  assert.equal(
    nextMonday(new Date("2026-10-19T01:00:00Z"), "America/Los_Angeles"),
    "2026-10-19",
  );
  assert.equal(
    nextMonday(new Date("2026-10-19T01:00:00Z"), "America/New_York"),
    "2026-10-19",
  );
});

test("total recipe time is capped at 60 minutes for selection and approval", () => {
  assert.equal(compatible({ ...recipes[0], minutes: 60 }, prefs()), true);
  for (const minutes of [61, 90, 0, NaN, Infinity]) {
    assert.equal(compatible({ ...recipes[0], minutes }, prefs()), false);
    const p = draft();
    p.meals[0] = { ...p.meals[0], recipe: { ...p.meals[0].recipe, minutes } };
    assert.throws(() => approve(p), /60 minutes or less/);
  }
});

test("halal and kosher preferences persist and reject common ingredient conflicts",()=>{
  const check=(diet:'halal'|'kosher'|'vegetarian',ingredients:string[])=>compatible({...recipes[0],minutes:30,ingredients},{...prefs(),diet});
  for(const diet of ['halal','kosher'] as const) {
    assert.equal(preferenceSchema.parse({...prefs(),diet}).diet,diet);
    assert.equal(check(diet,['100 g pork']),false);
    assert.equal(check(diet,['100 g chicken','100 g rice']),true);
  }
  assert.equal(check('halal',['100 ml mirin','100 g rice']),false);
  assert.equal(check('halal',['10 ml red wine vinegar','100 g rice']),true);
  assert.equal(check('kosher',['100 g shrimp']),false);
  assert.equal(check('kosher',['100 g chicken','50 g cheese']),false);
  assert.equal(check('kosher',['100 g chicken','50 ml coconut milk']),true);
  assert.equal(check('vegetarian',['100 g chicken']),false);
});
