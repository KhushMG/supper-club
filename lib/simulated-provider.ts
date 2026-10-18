import type { Batch, Plan } from "./types";
import { validSimulation } from "./simulation";

export type Fulfillment = {
  provider: "supper-simulator";
  stage: "confirmed" | "shopping" | "out_for_delivery" | "delivered" | "cancelled";
  confirmedAt: string;
  shoppingAt: string;
  outForDeliveryAt: string;
  deliveredAt: string;
  demo: boolean;
  manual?: boolean;
  events: { stage: Fulfillment["stage"]; at: string }[];
};
export const fulfillmentLabels: Record<Fulfillment["stage"], string> = {
  confirmed: "Confirmed", shopping: "Shopping", out_for_delivery: "Out for delivery",
  delivered: "Delivered", cancelled: "Cancelled",
};

// A provider adapter: only frozen, approved, fully priced baskets can be submitted.
// Called inside the household transaction, so retries cannot duplicate an order.
export function placeSimulatedOrders(plan: Plan, now = new Date()) {
  if (!validSimulation(plan) || plan.status !== "approved" ||
      plan.approvedRevision !== plan.revision || plan.agentPaidRevision !== plan.revision ||
      (plan.aiRunId && plan.aiExecutionRevision !== plan.revision))
    throw new Error("An approved quote and verified test payment are required.");
  if (plan.totalCents > plan.preferences.budgetCents) throw new Error("Weekly budget exceeded.");
  const pending = plan.batches.filter(b => !b.orderId && b.status === "scheduled");
  if (pending.some(b => Date.parse(b.deliveryAt) <= now.getTime()))
    throw new Error("Delivery slot expired. Choose a future week before ordering.");
  for (const batch of pending) {
    batch.orderId = `sandbox_${batch.id}`;
    batch.status = "submitted";
    const end = Date.parse(batch.deliveryAt);
    batch.fulfillment = {
      provider: "supper-simulator", stage: "confirmed", confirmedAt: now.toISOString(),
      shoppingAt: new Date(Math.max(now.getTime(), end - 90 * 60000)).toISOString(),
      outForDeliveryAt: new Date(Math.max(now.getTime(), end - 30 * 60000)).toISOString(),
      deliveredAt: batch.deliveryAt, demo: false,
      events: [{stage: "confirmed", at: now.toISOString()}],
    };
  }
  return pending.length;
}

export function advanceFulfillment(plan: Plan, now = new Date()) {
  let changes = 0;
  for (const batch of plan.batches) {
    const f = batch.fulfillment;
    if (!f || f.manual || batch.status === "cancelled" || f.stage === "cancelled") continue;
    for (const [stage, at] of [
      ["shopping", f.shoppingAt], ["out_for_delivery", f.outForDeliveryAt], ["delivered", f.deliveredAt],
    ] as const) {
      if (Date.parse(at) <= now.getTime() && !f.events.some(e => e.stage === stage)) {
        f.stage = stage;
        f.events.push({stage, at});
        if (stage === "delivered") batch.status = "delivered";
        changes++;
      }
    }
  }
  return changes;
}

export function startDeliveryDemo(plan: Plan, now = new Date()) {
  advanceFulfillment(plan, now);
  const eligible = plan.batches.filter(b => b.fulfillment && b.status === "submitted" && !b.fulfillment.demo);
  if (!eligible.length) throw new Error("No confirmed deliveries available for a demo.");
  for (const b of eligible) {
    const f = b.fulfillment!;
    f.demo = true;
    f.shoppingAt = new Date(now.getTime() + 30000).toISOString();
    f.outForDeliveryAt = new Date(now.getTime() + 90000).toISOString();
    f.deliveredAt = new Date(now.getTime() + 150000).toISOString();
  }
}

export function cancelSimulatedOrder(batch: Batch, now = new Date()) {
  if (batch.status === "delivered" || batch.fulfillment?.stage === "out_for_delivery")
    throw new Error("This delivery can no longer be cancelled.");
  if (batch.status === "cancelled") return;
  batch.status = "cancelled";
  if (batch.fulfillment) {
    batch.fulfillment.stage = "cancelled";
    batch.fulfillment.events.push({stage: "cancelled", at: now.toISOString()});
  }
}

// Compare-and-advance makes repeat clicks/retries safe, even across browser tabs.
export function nextDeliveryStage(batch: Batch, expectedStage: Fulfillment["stage"], now = new Date()) {
  const f = batch.fulfillment;
  if (!f || !batch.orderId) throw new Error("Approve and place the test order first.");
  if (f.stage !== expectedStage) return false;
  if (batch.status !== "submitted" || f.stage === "cancelled" || f.stage === "delivered")
    throw new Error("This delivery has already ended.");
  const next = {confirmed:"shopping", shopping:"out_for_delivery", out_for_delivery:"delivered"} as const;
  const stage = next[f.stage];
  f.manual = true;
  f.demo = true;
  f.stage = stage;
  const at = now.toISOString();
  if (stage === "shopping") f.shoppingAt = at;
  if (stage === "out_for_delivery") f.outForDeliveryAt = at;
  if (stage === "delivered") {f.deliveredAt = at;batch.status = "delivered";}
  f.events.push({stage, at});
  return true;
}
