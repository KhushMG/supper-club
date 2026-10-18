import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProduct } from "../lib/grocery-prices";
test("retailer price is converted to integer cents without guessing missing prices", () => {
  assert.deepEqual(
    parseProduct({
      data: [
        {
          productId: "001",
          description: "Rice",
          items: [{ size: "16 oz", price: { regular: 2.49, promo: 1.99 } }],
        },
      ],
    }),
    {
      productId: "001",
      description: "Rice",
      size: "16 oz",
      regularCents: 249,
      promoCents: 199,
    },
  );
  assert.equal(
    parseProduct({
      data: [
        { productId: "001", description: "Rice", items: [{ size: "16 oz" }] },
      ],
    }),
    undefined,
  );
});
