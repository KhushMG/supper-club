import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecipePage, durationMinutes } from "../lib/recipes";
import { ingredient, purchaseIngredient, recipeCompatibilityIssue, defaults } from "../lib/domain";
const recipe = {
  "@type": "Recipe",
  name: "Rice &amp; beans",
  recipeIngredient: ["1&#189; cups rice", "Salt to taste"],
  recipeYield: "4 servings",
  totalTime: "PT30M",
};
const page = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const parse = (html: string) =>
  parseRecipePage(html, "https://food.example/rice?utm_source=test", "Mexican");
test("nested JSON-LD, entities and optional images parse without changing quantities", () => {
  const r = parse(
    page({ "@graph": [{ "@type": "WebPage", mainEntity: recipe }] }),
  );
  assert.equal(r.title, "Rice & beans");
  assert.equal(r.ingredients[0], "1½ cups rice");
  assert.equal(r.image, "");
  assert.equal(r.servings, 4);
  assert.equal(r.source, "https://food.example/rice");
  assert.equal(ingredient(r.ingredients[0]).quantity, 360);
  assert.deepEqual(purchaseIngredient(r.ingredients[1]), {
    name: "salt",
    quantity: 1,
    unit: "package",
  });
});
test("incomplete or malformed blocks do not hide later complete recipes", () => {
  const html =
    '<script type="application/ld+json">not json</script>' +
    page([{ "@type": "Recipe", name: "Incomplete" }, recipe]);
  assert.equal(parse(html).title, "Rice & beans");
});
test("type arrays, schema URLs, alternate yields and prep plus cook duration work", () => {
  const r = parse(
    page({
      ...recipe,
      "@type": ["Thing", "https://schema.org/Recipe"],
      recipeYield: ["12 tacos", "4 servings"],
      totalTime: undefined,
      prepTime: "PT15M",
      cookTime: "PT1H",
      image: [{ url: "/rice.jpg" }],
    }),
  );
  assert.equal(r.servings, 4);
  assert.equal(r.minutes, 75);
  assert.equal(r.image, "https://food.example/rice.jpg");
});
test("script spacing and duration units are accepted", () => {
  const html = `<script TYPE = 'application/ld+json; charset=utf-8'>${JSON.stringify(recipe)}</script>`;
  assert.equal(parse(html).minutes, 30);
  assert.equal(durationMinutes("P1DT1H30M"), 1530);
  assert.equal(durationMinutes("PT90S"), 2);
  assert.equal(durationMinutes("PT1.5H"), 90);
});
test("collections, missing quantities and malformed ingredients are explicit failures", () => {
  assert.throws(
    () => parse(page({ "@type": "ItemList", name: "Dinners" })),
    /no structured/,
  );
  for (const bad of [
    { name: "" },
    { recipeYield: undefined },
    { totalTime: undefined },
    { recipeIngredient: [{}] },
    { recipeIngredient: [""] },
  ])
    assert.throws(
      () => parse(page({ ...recipe, ...bad })),
      /Incomplete recipe/,
    );
  assert.throws(() => purchaseIngredient("1/0 cups rice"));
  assert.throws(() => purchaseIngredient(""));
});
test("ranges use upper quantity and compact metric units remain measured", () => {
  assert.equal(ingredient("2–3 tbsp olive oil").quantity, 45);
  assert.equal(ingredient("2 to 3 tbsp olive oil").quantity, 45);
  assert.equal(ingredient("250g rice").quantity, 250);
  assert.equal(ingredient("1⁄2 cup rice").quantity, 120);
});

test("reported total cannot hide a longer prep plus cook duration", () => {
  const r = parse(
    page({
      ...recipe,
      totalTime: "PT30M",
      prepTime: "PT45M",
      cookTime: "PT30M",
    }),
  );
  assert.equal(r.minutes, 75);
});

test("rejected recipes report actual duration and ingredient errors to the planner", () => {
  const tooSlow = parse(page({ ...recipe, totalTime: "P1DT30M" }));
  assert.match(recipeCompatibilityIssue(tooSlow, defaults)!, /1470 minutes/);
  const broken = parse(page({ ...recipe, recipeIngredient: ["0"] }));
  assert.match(recipeCompatibilityIssue(broken, defaults)!, /Cannot read a published ingredient/);
  assert.equal(recipeCompatibilityIssue(parse(page(recipe)), defaults), undefined);
});
