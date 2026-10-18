import { test } from "node:test";
import assert from "node:assert/strict";
import { compactInput } from "../lib/agent-model";
test("repeated basket revisions retain only the latest product details and preserve errors", () => {
  const products = Array.from({ length: 40 }, (_, i) => ({
    ingredient: `ingredient ${i}`,
    productId: `p${i}`,
    product: "A product with a sufficiently descriptive retail name",
    packages: 1,
    cents: 100,
    alternatives: Array.from({ length: 4 }, (_, j) => ({
      productId: `p${i}-${j}`,
      description: "A different package for this ingredient",
      size: "16 oz",
      regularCents: 100 + j,
    })),
  }));
  const input = [
    {
      role: "user",
      content: "Use the selected cuisines; weekly budget 27500 cents",
    },
    ...[30000, 29000, 26154].map((total) => ({
      type: "function_call_output",
      call_id: String(total),
      output: JSON.stringify({
        totalCents: total,
        budgetCents: 27500,
        withinBudget: total <= 27500,
        products: [...products, ...products, ...products],
      }),
    })),
    {
      type: "function_call_output",
      call_id: "error",
      output: JSON.stringify({
        error: "Include every requested dinner day exactly once.",
      }),
    },
  ];
  const original = JSON.stringify(input),
    compact = compactInput(input);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 30000);
  assert.equal(JSON.stringify(input), original);
  const old = JSON.parse((compact[1] as any).output),
    latest = JSON.parse((compact[3] as any).output);
  assert.equal(old.products, undefined);
  assert.equal(old.totalCents, 30000);
  assert.equal(latest.totalCents, 26154);
  assert.equal(latest.products.length, 40);
  assert.equal(latest.products[0].packages, 3);
  assert.equal(latest.products[0].cents, 300);
  assert.match((compact[4] as any).output, /every requested dinner day/);
});

test("long budget-research history leaves room for the tool schema and instructions", () => {
  const recipeResults = Array.from({length:6},(_,round)=>({
    type:"function_call_output",call_id:`search-${round}`,
    output:JSON.stringify({recipes:Array.from({length:8},(_,i)=>({
      id:`recipe-${round}-${i}`,title:"A complete published dinner recipe",cuisine:"Thai",minutes:30,
      source:`https://publisher.example/${'long-recipe-path-'.repeat(10)}${i}`,
      fetchedAt:new Date().toISOString(),servings:4,
      ingredients:Array.from({length:12},()=>"1 tablespoon a carefully described ingredient, finely chopped"),
    }))}),
  }));
  const basket={type:"function_call_output",call_id:"basket",output:JSON.stringify({
    totalCents:30000,budgetCents:27500,withinBudget:false,
    products:Array.from({length:50},(_,i)=>({ingredient:`food ${i}`,productId:`p${i}`,product:"A package of food",packages:1,cents:500,
      alternatives:Array.from({length:4},(_,j)=>({productId:`p${i}-${j}`,size:"16 oz",regularCents:500+j,description:"A descriptive product label"})),
    })),
  })};
  const result=compactInput([...recipeResults,basket]);
  assert.ok(Buffer.byteLength(JSON.stringify(result))+8000<45000);
  assert.equal(JSON.parse((result[0] as any).output).recipes[0].id,"recipe-0-0");
  assert.equal(JSON.parse((result.at(-1) as any).output).products.length,50);
});
