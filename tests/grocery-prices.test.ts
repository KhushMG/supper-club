import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProduct, krogerBaseUrl } from "../lib/grocery-prices";
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

test("Kroger credentials are routed only to the selected official environment", () => {
  const previous = process.env.KROGER_ENVIRONMENT;
  try {
    delete process.env.KROGER_ENVIRONMENT;
    assert.equal(krogerBaseUrl(), "https://api.kroger.com/v1");
    process.env.KROGER_ENVIRONMENT = "certification";
    assert.equal(krogerBaseUrl(), "https://api-ce.kroger.com/v1");
    process.env.KROGER_ENVIRONMENT = "https://untrusted.example";
    assert.throws(() => krogerBaseUrl());
  } finally {
    if (previous === undefined) delete process.env.KROGER_ENVIRONMENT;
    else process.env.KROGER_ENVIRONMENT = previous;
  }
});
