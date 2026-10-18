import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProduct,
  retrievalQueries,
  retrieveIngredient,
} from "../lib/grocery-prices";
import { packageMeasure } from "../lib/kroger-basket";
const product = (description: string, priced = true) => ({
  productId: "123",
  description,
  items: [{ size: "16 oz", ...(priced ? { price: { regular: 2.49 } } : {}) }],
});
test("fallback aliases retrieve equivalent food at the original store", async () => {
  const terms: string[] = [];
  const match = await retrieveIngredient(
    "chickpeas",
    "store",
    async (path, params) => {
      assert.equal(params["filter.locationId"], "store");
      terms.push(params["filter.term"]);
      return {
        data:
          params["filter.term"] === "garbanzo beans"
            ? [product("Garbanzo Beans")]
            : [],
      };
    },
  );
  assert.deepEqual(terms, ["chickpeas", "garbanzo beans"]);
  assert.equal(match.regularCents, 249);
});
test("retrieve a later result page without changing stores", async () => {
  const match = await retrieveIngredient(
    "rice",
    "store",
    async (path, params) =>
      params["filter.start"] === "50"
        ? { data: [product("Rice")] }
        : {
            data: [product("Rice Pudding")],
            meta: { pagination: { total: 70 } },
          },
  );
  assert.equal(match.regularCents, 249);
});
test("product details can supply a missing search price", async () => {
  const calls: string[] = [];
  const match = await retrieveIngredient(
    "rice",
    "store",
    async (path, params) => {
      assert.equal(params["filter.locationId"], "store");
      calls.push(path);
      return path === "products/123"
        ? { data: product("Rice") }
        : { data: [product("Rice", false)] };
    },
  );
  assert.deepEqual(calls, ["products", "products/123"]);
  assert.equal(match.regularCents, 249);
});
test("household tools, blends, and flavored drinks are not ingredient matches", () => {
  for (const [query, name] of [
    ["salt", "Pepper & Salt Mill Set"],
    ["onion", "Pepper Onion Blend"],
    ["ginger", "Ginger Ale"],
    ["parmesan", "Mozzarella & Parmesan Cheese"],
  ])
    assert.equal(parseProduct({ data: [product(name)] }, query), undefined);
  assert.equal(
    parseProduct(
      { data: [{ ...product("Salt"), categories: ["Household"] }] },
      "salt",
    ),
    undefined,
  );
});
test("explicit multipack labels produce the whole pack amount", () => {
  assert.deepEqual(packageMeasure("2 ct / 8 oz each"), {
    unit: "g",
    quantity: 16 * 28.3495,
  });
  assert.deepEqual(packageMeasure("4 sticks / 16 oz"), {
    unit: "g",
    quantity: 16 * 28.3495,
  });
  assert.deepEqual(packageMeasure("6 pk / 7.5 fl oz"), {
    unit: "ml",
    quantity: 6 * 7.5 * 29.5735,
  });
  assert.equal(packageMeasure("7 in"), undefined);
});
test("retrieval cleans preparation noise and known synonyms", () => {
  assert.deepEqual(retrievalQueries("can tomato sauce"), ["tomato sauce"]);
  assert.deepEqual(retrievalQueries("curry powder hot or mild"), [
    "curry powder",
  ]);
  assert.equal(retrievalQueries("kale  0.62)")[0], "kale");
});

test("ingredients mentioned as additions are not standalone ingredient matches", () => {
  assert.equal(
    parseProduct(
      { data: [product("Peas and Carrots with Natural Sea Salt")] },
      "salt",
    ),
    undefined,
  );
  assert.equal(
    parseProduct({ data: [product("Rice with Ginger")] }, "ginger"),
    undefined,
  );
});

test("nonfood categories and scented products cannot supply ingredient prices", () => {
  assert.equal(
    parseProduct(
      {
        data: [
          {
            ...product("Sea Salt & Driftwood Jar Candle"),
            categories: ["Home Decor"],
          },
        ],
      },
      "salt",
    ),
    undefined,
  );
  assert.equal(
    parseProduct(
      { data: [{ ...product("Himalayan Salt"), categories: ["Home"] }] },
      "salt",
    ),
    undefined,
  );
  assert.equal(
    parseProduct(
      { data: [{ ...product("Sea Salt"), categories: ["Baking Goods"] }] },
      "salt",
    )?.regularCents,
    249,
  );
});

test('recipe quantities and preparation notes resolve to purchasable groceries', () => {
  for (const [ingredient, description] of [
    ['14-oz can whole peeled tomatoes', 'Whole Peeled Tomatoes'],
    ['c. basmati rice', 'Basmati Rice'],
    ['lemon wedges', 'Lemons'],
    ['peeled fresh ginger', 'Ginger Root'],
    ['serrano chile', 'Serrano Peppers'],
    ['warmed naan', 'Original Naan Bread'],
    ['pinch red pepper flakes', 'Crushed Red Pepper'],
    ['to serve bread', 'White Bread'],
  ]) assert.equal(parseProduct({data:[product(description)]}, ingredient)?.regularCents,249,ingredient);
});

test('explicit cheese alternatives match either choice instead of requiring both', () => {
  for(const description of ['Sharp Cheddar Cheese','American Cheese'])
    assert.ok(parseProduct({data:[product(description)]},'cheddar or american cheese'));
  for(const description of ['Parmesan Cheese','Pecorino Romano Cheese'])
    assert.ok(parseProduct({data:[product(description)]},'grated parmigiano reggiano or pecorino romano cheese'));
  assert.equal(parseProduct({data:[product('Mozzarella Cheese')]},'cheddar or american cheese'),undefined);
  assert.deepEqual(retrievalQueries('cheddar or american cheese'),['cheddar cheese','american cheese']);
});

test('normalization preserves food form and rejects unsuitable fresh ginger substitutes', () => {
  assert.equal(retrievalQueries('ground beef')[0],'ground beef');
  assert.equal(parseProduct({data:[product('Beef Steak')]},'ground beef'),undefined);
  assert.ok(parseProduct({data:[product('Ground Beef')]},'ground beef'));
  for(const name of ['Ground Ginger','Ginger Tea','Ginger Juice','Crystallized Ginger'])
    assert.equal(parseProduct({data:[product(name)]},'peeled fresh ginger'),undefined);
  assert.equal(parseProduct({data:[product('Jalapeno Peppers')]},'serrano chile'),undefined);
});

test('an explicitly allowed second ingredient is retrieved at the selected store', async () => {
  const terms:string[]=[];
  const match=await retrieveIngredient('cheddar or american cheese','store',async(path,params)=>{
    assert.equal(params['filter.locationId'],'store');terms.push(params['filter.term']);
    return {data:params['filter.term']==='american cheese'?[product('American Cheese')]:[]};
  });
  assert.deepEqual(terms,['cheddar cheese','american cheese']);
  assert.equal(match.regularCents,249);
});
