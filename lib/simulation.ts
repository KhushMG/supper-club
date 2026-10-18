import type { Plan } from "./types";

export type SimulationQuote = {
  revision: number;
  missingItems: { name: string; amountCents: number }[];
  mockItemsCents: number;
  feeCents: number;
  taxCents: number;
  totalCents: number;
};

// These are demo fixtures, never retailer quotes or real ordering authorization.
export function prepareSimulation(plan: Plan, incrementRevision = true) {
  if (!plan.retailBasket || plan.pricingError)
    throw new Error("Refresh Kroger prices before preparing a simulation.");
  if (plan.batches.some(b => b.orderId))
    throw new Error("This plan already has simulated orders. Create a new week.");
  const missing = new Set<string>();
  const missingItems: SimulationQuote["missingItems"] = [];
  let feeCents = 0, taxCents = 0;
  for (const batch of plan.batches) {
    const retail = plan.retailBasket.batches.find(b => b.batchId === batch.id);
    if (!retail) throw new Error("Refresh prices for all deliveries first.");
    let mock = 0;
    for (const line of retail.lines) {
      if (line.totalCents === undefined && !missing.has(line.name)) {
        missing.add(line.name);
        missingItems.push({name: line.name, amountCents: 500});
        mock += 500;
      }
    }
    batch.subtotalCents = retail.subtotalCents + mock;
    batch.feeCents = batch.subtotalCents > 0 ? 599 : 0;
    batch.taxCents = Math.round(batch.subtotalCents * 0.08);
    batch.tipCents = 0;
    batch.totalCents = batch.subtotalCents + batch.feeCents + batch.taxCents;
    feeCents += batch.feeCents;
    taxCents += batch.taxCents;
  }
  if (incrementRevision) plan.revision++;
  delete plan.agentPaidRevision;
  delete plan.agentError;
  plan.totalCents = plan.batches.reduce((sum,b) => sum + b.totalCents, 0);
  plan.simulationQuote = {
    revision: plan.revision, missingItems, mockItemsCents: missingItems.length * 500,
    feeCents, taxCents, totalCents: plan.totalCents,
  };
  plan.status = "draft";
  delete plan.approvedRevision;
  delete plan.approvedAt;
  plan.issue = plan.totalCents > plan.preferences.budgetCents
    ? "Simulation exceeds your weekly budget. Change the plan before approving."
    : "Simulation only: real product prices plus mock missing items, delivery and tax. No real groceries will be ordered.";
}
export function validSimulation(plan: Plan) {
  const q = plan.simulationQuote;
  return !!q && q.revision === plan.revision && q.totalCents === plan.totalCents &&
    plan.totalCents === plan.batches.reduce((sum,b) => sum + b.totalCents, 0);
}
