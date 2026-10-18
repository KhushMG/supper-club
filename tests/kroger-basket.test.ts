import { test } from "node:test";
import assert from "node:assert/strict";
import {
  retailIngredient,
  packageMeasure,
  matchRetailLine,
  retailRequirements,
  priceRetailBatches,
} from "../lib/kroger-basket";
import { parseProduct } from "../lib/grocery-prices";
import { makePlan, defaults, approve, processDue } from "../lib/domain";
import { recipes } from "../lib/recipes";
test("container weights count every can and preserve needed units", () => {
  const x = retailIngredient("2 15oz. cans black beans");
  assert.equal(x.name, "black beans");
  assert.equal(x.unit, "g");
  assert.equal(x.quantity, 30 * 28.3495);
  assert.equal(
    retailIngredient("2 (15 oz.) cans black beans").quantity,
    x.quantity,
  );
  assert.equal(retailIngredient("2 cloves garlic").unit, "clove");
});
test("retail packages round up using actual size and price", () => {
  const p = {
    ingredient: "rice",
    productId: "1",
    description: "Rice",
    size: "16 oz",
    regularCents: 249,
  };
  const line = matchRetailLine(
    { name: "rice", unit: "g", required: 500, pantryUsed: 0 },
    p,
  );
  assert.equal(line.packages, 2);
  assert.equal(line.totalCents, 498);
});
test("missing prices stay unresolved; incompatible units buy a whole package", () => {
  const line = { name: "rice", unit: "ml", required: 240, pantryUsed: 0 };
  assert.equal(matchRetailLine(line).totalCents, undefined);
  const r = matchRetailLine(line, {
    ingredient: "rice",
    size: "16 oz",
    regularCents: 249,
  });
  assert.equal(r.unitPriceCents, 249);
  assert.equal(r.totalCents, 249);
  assert.equal(r.packages, 1);
  assert.ok(r.quantityNote);
  assert.equal(r.issue, undefined);
  assert.equal(packageMeasure("about 1 lb"), undefined);
  assert.equal(packageMeasure("2 x 16 oz"), undefined);
  assert.deepEqual(packageMeasure("12 ct"), { unit: "each", quantity: 12 });
});
test("product search rejects unrelated first result", () => {
  const result = parseProduct(
    {
      data: [
        {
          productId: "wrong",
          description: "Rice pudding",
          items: [{ size: "16 oz", price: { regular: 1 } }],
        },
        {
          productId: "right",
          description: "Black Beans",
          items: [{ size: "15 oz", price: { regular: 2 } }],
        },
      ],
    },
    "black beans",
  );
  assert.equal(result?.productId, "right");
  assert.equal(
    parseProduct(
      {
        data: [
          {
            productId: "wrong",
            description: "Red Beans",
            items: [{ price: { regular: 1 } }],
          },
        ],
      },
      "black beans",
    ),
    undefined,
  );
});
test("requirements use original recipe amounts without imaginary package surplus", () => {
  const recipe = { ...recipes[0], servings: 1, ingredients: ["1 lb rice"] };
  const plan = makePlan(
    [recipe],
    {
      ...defaults,
      cuisines: [recipe.cuisine],
      servings: 1,
      days: [0, 3],
      pantry: [{ name: "rice", unit: "g", quantity: 100 }],
    },
    "2030-04-01",
  );
  const batches = retailRequirements(plan);
  assert.equal(batches[0].lines[0].required, 353.592);
  assert.equal(batches[1].lines[0].required, 453.592);
});
test("Kroger product subtotals cannot authorize or simulate all-in orders", () => {
  const plan = makePlan(recipes, defaults, "2030-04-01");
  plan.pricingSource = "kroger";
  assert.throws(() => approve(plan), /final checkout quote/);
  plan.status = "approved";
  plan.approvedRevision = plan.revision;
  assert.equal(processDue(plan, new Date("2030-04-01"), true), 0);
});

test("ingredient matching does not substitute prepared foods with similar names", () => {
  assert.equal(
    parseProduct(
      {
        data: [
          {
            productId: "wrong",
            description: "Rice Pudding",
            items: [{ size: "16 oz", price: { regular: 2 } }],
          },
        ],
      },
      "rice",
    ),
    undefined,
  );
});

 test("whole packages are shared across deliveries and exact shortfalls buy more", () => {
  const batches = [0,1,2].map(i => ({batchId: String(i), subtotalCents: 0, lines: [
    {name: "salt", unit: "ml", required: 5, pantryUsed: 0},
    {name: "rice", unit: "g", required: 200, pantryUsed: 0},
  ]}));
  const result = priceRetailBatches(batches, [
    {ingredient: "salt", productId: "salt", size: "500 g", regularCents: 100},
    {ingredient: "rice", productId: "rice", size: "500 g", regularCents: 200},
  ]);
  assert.deepEqual(result.map(b => b.lines.map(l => l.packages)), [[1,1],[0,0],[0,1]]);
  assert.equal(result.reduce((sum,b)=>sum+b.subtotalCents,0),500);
 });
