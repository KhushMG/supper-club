import Stripe from "stripe";
import { mutate, readState } from "./db";
import { log } from "./domain";
import type { Payment, State } from "./types";
export function testStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new Error(
      "Add a Stripe sk_test_ secret key to enable test checkout. Live keys are rejected.",
    );
  return new Stripe(key, { maxNetworkRetries: 2 });
}
export function acceptPayment(
  state: State,
  session: {
    id: string;
    livemode: boolean;
    payment_status: string;
    amount_total: number | null;
    currency: string | null;
    metadata: Record<string, string> | null;
  },
) {
  if (session.livemode) throw new Error("Live Stripe payments are disabled.");
  const p = state.payments.find((p) => p.id === session.metadata?.paymentId);
  if (
    !p ||
    p.sessionId !== session.id ||
    p.planId !== session.metadata?.planId ||
    String(p.revision) !== session.metadata?.revision ||
    p.amountCents !== session.amount_total ||
    session.currency !== "usd"
  )
    throw new Error("Payment does not match the saved checkout.");
  if (session.payment_status === "paid" && p.status !== "paid") {
    p.status = "paid";
    log(
      state,
      "Stripe test payment confirmed. No real money moved and no grocery purchase was made.",
    );
  }
  return p;
}
export async function createCheckout(
  planId: string,
  origin: string,
  stripe: Stripe = testStripe(),
) {
  const attempt = await mutate((state) => {
    const plan = state.plans.find((p) => p.id === planId);
    if (
      !plan ||
      plan.status !== "approved" ||
      plan.approvedRevision !== plan.revision
    )
      throw new Error("Approve this plan before starting checkout.");
    if (plan.totalCents > plan.preferences.budgetCents || plan.totalCents < 50)
      throw new Error("Plan total cannot be charged.");
    const existing = state.payments.find(
      (p) =>
        p.planId === planId &&
        p.revision === plan.revision &&
        p.status !== "expired",
    );
    if (existing) return existing;
    const p: Payment = {
      id: crypto.randomUUID(),
      planId,
      revision: plan.revision,
      amountCents: plan.totalCents,
      returnOrigin: origin,
      status: "creating",
      createdAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    state.payments.push(p);
    return p;
  });
  if (attempt.status === "paid")
    throw new Error("This plan already has a successful test payment.");
  if (attempt.sessionId) {
    const session = await stripe.checkout.sessions.retrieve(attempt.sessionId);
    if (session.livemode) throw new Error("Live session rejected.");
    if (session.payment_status === "paid") {
      await mutate((s) => acceptPayment(s, session));
      throw new Error("Payment already completed. Refresh to see the receipt.");
    }
    if (session.status === "expired") {
      await mutate((s) => {
        const p = s.payments.find((p) => p.id === attempt.id)!;
        p.status = "expired";
      });
      throw new Error("Checkout expired. Start a new checkout.");
    }
    return { url: session.url };
  }
  // Keep creation parameters stable across uncertain retries, including the expiration.
  if (attempt.expiresAt < Math.floor(Date.now() / 1000) + 1800)
    throw new Error(
      "Unresolved checkout attempt. Reconcile it with Stripe before retrying.",
    );
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        allowed_payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: attempt.amountCents,
              product_data: {
                name: "Supper Club — sandbox weekly groceries",
                description:
                  "TEST PAYMENT ONLY. No groceries will be purchased.",
              },
            },
            quantity: 1,
          },
        ],
        client_reference_id: attempt.id,
        metadata: {
          paymentId: attempt.id,
          planId: attempt.planId,
          revision: String(attempt.revision),
        },
        success_url:
          (attempt.returnOrigin || origin) +
          "/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: (attempt.returnOrigin || origin) + "/?checkout=cancelled",
        expires_at: attempt.expiresAt,
      },
      { idempotencyKey: "supper-test-" + attempt.id },
    );
    if (session.livemode || !session.url)
      throw new Error("Unexpected checkout response.");
    await mutate((s) => {
      const p = s.payments.find((p) => p.id === attempt.id)!;
      p.sessionId = session.id;
      p.url = session.url!;
      p.status = "open";
      delete p.error;
      log(s, "Stripe test checkout created for the approved weekly total.");
    });
    return { url: session.url };
  } catch (e) {
    await mutate((s) => {
      const p = s.payments.find((p) => p.id === attempt.id)!;
      p.error =
        "Checkout creation did not finish. Retry safely with the same attempt.";
    });
    throw e;
  }
}
export async function reconcile(sessionId: string) {
  if (!/^cs_test_[\w]+$/.test(sessionId))
    throw new Error("Invalid test session.");
  const state = await readState();
  if (!state.payments.some((p) => p.sessionId === sessionId))
    throw new Error("Unknown checkout session.");
  const session = await testStripe().checkout.sessions.retrieve(sessionId);
  return mutate((s) => {
    const p = acceptPayment(s, session);
    if (session.status === "expired" && p.status !== "paid")
      p.status = "expired";
    return p;
  });
}
