import { placeSimulatedOrders } from "./simulated-provider";
import type Stripe from "stripe";
import { mutate } from "./db";
import { log } from "./domain";
import { validSimulation } from "./simulation";
import { testStripe } from "./stripe";
import type { Payment, Plan } from "./types";

function ready(p: Plan | undefined): p is Plan {
  return (
    !!p &&
    (!p.aiRunId || p.aiExecutionRevision === p.revision) &&
    p.autoOrder === true &&
    p.status === "approved" &&
    p.approvedRevision === p.revision &&
    validSimulation(p) &&
    p.totalCents >= 50 &&
    p.totalCents <= p.preferences.budgetCents
  );
}
// Durable payment attempt + Stripe idempotency protects retries and concurrent runners.
export async function runOrderAgent(
  planId: string,
  stripe?: Stripe,
  now = new Date(),
) {
  const attempt = await mutate((s) => {
    const p = s.plans.find((p) => p.id === planId);
    if (!ready(p)) return;
    if (p.batches.some(b => !b.orderId && b.status === "scheduled" && Date.parse(b.deliveryAt) <= now.getTime())) {
      p.agentError = "Delivery slot expired. Create a future week before checkout.";
      return;
    }
    const existing = s.payments.find(
      (x) =>
        x.planId === p.id &&
        x.revision === p.revision &&
        x.status !== "expired",
    );
    if (existing) {
      if (existing.amountCents !== p.totalCents) throw new Error("Approved payment amount changed.");
      return structuredClone(existing);
    }
    const payment: Payment = {
      id: crypto.randomUUID(),
      planId: p.id,
      revision: p.revision,
      amountCents: p.totalCents,
      status: "creating",
      createdAt: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1000) + 3600,
      agent: true,
    };
    s.payments.push(payment);
    log(s, "Ordering agent started automatic Stripe test payment.");
    return payment;
  });
  if (!attempt) return;
  try {
    if (attempt.status !== "paid") {
      if (!attempt.agent)
        throw new Error(
          "Complete or expire the existing manual checkout before automatic payment.",
        );
      // Never create a second payment after Stripe's idempotency retention window.
      if (
        !attempt.intentId &&
        now.getTime() - Date.parse(attempt.createdAt) > 23 * 3600000
      )
        throw new Error("Payment outcome needs review before retrying.");
      const api = stripe ?? testStripe();
      const intent = attempt.intentId
        ? await api.paymentIntents.retrieve(attempt.intentId)
        : await api.paymentIntents.create(
            {
              amount: attempt.amountCents,
              currency: "usd",
              payment_method: "pm_card_visa",
              allowed_payment_method_types: ["card"],
              confirm: true,
              description:
                "Supper Club automated SIMULATION — no groceries purchased",
              metadata: {
                paymentId: attempt.id,
                planId: attempt.planId,
                revision: String(attempt.revision),
              },
            },
            { idempotencyKey: "supper-agent-" + attempt.id },
          );
      if (
        intent.livemode ||
        intent.amount !== attempt.amountCents ||
        intent.currency !== "usd" ||
        intent.metadata.paymentId !== attempt.id ||
        intent.metadata.planId !== attempt.planId ||
        intent.metadata.revision !== String(attempt.revision)
      )
        throw new Error("Test payment verification failed.");
      await mutate((s) => {
        const payment = s.payments.find((x) => x.id === attempt.id)!;
        payment.intentId = intent.id;
        if (intent.status === "succeeded") {
          payment.status = "paid";
          delete payment.error;
          log(
            s,
            "Ordering agent verified Stripe test payment. Simulated grocery orders are ready to confirm.",
          );
        }
      });
      if (intent.status !== "succeeded")
        throw new Error("Test payment did not succeed; orders remain held.");
    }
    await mutate((s) => {
      const p = s.plans.find((p) => p.id === planId);
      const payment = s.payments.find((x) => x.id === attempt.id);
      if (
        !ready(p) ||
        p.revision !== attempt.revision ||
        payment?.status !== "paid"
      )
        return;
      p.agentPaidRevision = p.revision;
      delete p.agentError;
      const count = placeSimulatedOrders(p, now);
      if (count)
        log(
          s,
          `Ordering agent submitted ${count} simulated grocery order(s). No Kroger purchase was made.`,
        );
    });
  } catch (error) {
    await mutate((s) => {
      const p = s.plans.find((p) => p.id === planId);
      if (p && p.revision === attempt.revision)
        p.agentError =
          "Automatic checkout needs attention. The scheduled agent will retry safely; no unpaid orders will be submitted.";
      const payment = s.payments.find((x) => x.id === attempt.id);
      if (payment)
        payment.error = "Automatic test checkout is pending or needs review.";
      log(
        s,
        "Ordering agent paused submission because payment could not be confirmed.",
      );
    });
  }
}
