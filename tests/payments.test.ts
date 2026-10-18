import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptPayment, testStripe } from "../lib/stripe";
import { defaults } from "../lib/domain";
import type { State } from "../lib/types";
function fixture() {
  const state: State = {
    preferences: defaults,
    plans: [],
    events: [],
    payments: [
      {
        id: "p",
        planId: "plan",
        revision: 1,
        amountCents: 5000,
        status: "open",
        createdAt: "2026-01-01",
        expiresAt: 0,
        sessionId: "cs_test_123",
      },
    ],
  };
  const session = {
    id: "cs_test_123",
    livemode: false,
    payment_status: "paid",
    amount_total: 5000,
    currency: "usd",
    metadata: { paymentId: "p", planId: "plan", revision: "1" },
  };
  return { state, session };
}
test("verified test payment records once despite duplicate deliveries", () => {
  const { state, session } = fixture();
  acceptPayment(state, session);
  acceptPayment(state, session);
  assert.equal(state.payments[0].status, "paid");
  assert.equal(state.events.length, 1);
});
test("reject live events, wrong amount/currency/identity/revision", () => {
  for (const changed of [
    { livemode: true },
    { amount_total: 5001 },
    { currency: "eur" },
    { id: "cs_test_wrong" },
    { metadata: { paymentId: "p", planId: "plan", revision: "2" } },
  ]) {
    const { state, session } = fixture();
    assert.throws(() => acceptPayment(state, { ...session, ...changed }));
    assert.equal(state.payments[0].status, "open");
  }
});
test("unpaid checkout is never counted as paid", () => {
  const { state, session } = fixture();
  acceptPayment(state, { ...session, payment_status: "unpaid" });
  assert.equal(state.payments[0].status, "open");
});
test("Stripe live secret is rejected before any API call", () => {
  const old = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_live_not_a_key";
  assert.throws(() => testStripe());
  if (old) process.env.STRIPE_SECRET_KEY = old;
  else delete process.env.STRIPE_SECRET_KEY;
});
