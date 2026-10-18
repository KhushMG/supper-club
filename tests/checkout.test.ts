import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckout } from "../lib/stripe";
import { mutate, readState, database } from "../lib/db";
import { makePlan, defaults, approve } from "../lib/domain";
import { recipes } from "../lib/recipes";
process.env.TURSO_DATABASE_URL =
  "file:" + join(tmpdir(), "supper-checkout-" + crypto.randomUUID() + ".db");
test("checkout sends approved server total to Stripe and reuses uncertain attempts", async () => {
  const p = makePlan(
    recipes,
    { ...defaults, budgetCents: 50000 },
    "2030-04-01",
  );
  approve(p);
  await mutate((s) => {
    s.plans = [p];
  });
  const calls: {
    body: Stripe.Checkout.SessionCreateParams;
    key: string | undefined;
  }[] = [];
  let fail = true;
  let saved: Record<string, unknown> | undefined;
  const stripe = {
    checkout: {
      sessions: {
        create: async (
          body: Stripe.Checkout.SessionCreateParams,
          opts: Stripe.RequestOptions,
        ) => {
          calls.push({ body, key: opts.idempotencyKey });
          if (fail) {
            fail = false;
            throw new Error("Simulated ambiguous network timeout");
          }
          saved = {
            id: "cs_test_example",
            url: "https://checkout.stripe.com/test",
            livemode: false,
            payment_status: "unpaid",
            status: "open",
          };
          return saved;
        },
        retrieve: async () => saved,
      },
    },
  } as unknown as Stripe;
  await assert.rejects(() =>
    createCheckout(p.id, "http://localhost:3000", stripe),
  );
  const creating = (await readState()).payments[0];
  assert.equal(creating.status, "creating");
  const response = await createCheckout(p.id, "http://localhost:3000", stripe);
  assert.equal(response.url, "https://checkout.stripe.com/test");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(
    calls[0].body.line_items?.[0].price_data?.unit_amount,
    p.totalCents,
  );
  await createCheckout(p.id, "http://localhost:3000", stripe);
  assert.equal(calls.length, 2);
  assert.equal((await readState()).payments.length, 1);
  database().close();
});
