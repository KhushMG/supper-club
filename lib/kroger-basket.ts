import { ingredient } from "./domain";
import { livePrices, type LivePrices } from "./grocery-prices";
import type { Plan } from "./types";
export type RetailLine = {
  name: string;
  unit: string;
  required: number;
  pantryUsed: number;
  productId?: string;
  description?: string;
  size?: string;
  unitPriceCents?: number;
  packages?: number;
  totalCents?: number;
  issue?: string;
};
export type RetailBasket = {
  environment: "production" | "certification";
  fetchedAt: string;
  storeName: string;
  storeId: string;
  batches: { batchId: string; lines: RetailLine[]; subtotalCents: number }[];
  subtotalCents: number;
  unresolved: number;
  // Product APIs do not quote delivery, tax, slots, or the final charge.
  finalTotalCents: null;
};
export function retailIngredient(raw: string) {
  // Preserve container weights before the generic parser removes parentheses.
  const container = raw.match(
    /^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)\s+\(?(\d+(?:\.\d+)?)\s*(oz|lb|g|ml|fl\s*oz)\.?\)?\s*(?:cans?|jars?|packages?)\s+(.+)$/i,
  );
  if (container) {
    const count = ingredient(container[1] + " each item").quantity;
    const volume = /fl/i.test(container[3]);
    const x = ingredient(
      `${Number(container[2]) * count} ${volume ? "ml" : container[3]} ${container[4]}`,
    );
    if (volume) x.quantity *= 29.5735;
    return x;
  }
  const x = ingredient(raw);
  // Cloves and bunches cannot be equated with a retail bulb or bag.
  if (/^\S+\s+cloves?\b/i.test(raw)) x.unit = "clove";
  if (/^\S+\s+bunch(?:es)?\b/i.test(raw)) x.unit = "bunch";
  return x;
}
export function retailRequirements(plan: Plan): RetailBasket["batches"] {
  const pantry = structuredClone(plan.preferences.pantry);
  return plan.batches.map((batch) => {
    const items = new Map<string, RetailLine>();
    for (const meal of plan.meals.filter((m) => batch.days.includes(m.day))) {
      for (const raw of meal.recipe.ingredients) {
        const x = retailIngredient(raw);
        if (x.name === "water") continue;
        const key = x.name + "|" + x.unit;
        const required =
          (x.quantity * plan.preferences.servings) / meal.recipe.servings;
        const current = items.get(key);
        if (current) current.required += required;
        else
          items.set(key, {
            name: x.name,
            unit: x.unit,
            required,
            pantryUsed: 0,
          });
      }
    }
    const lines = [...items.values()]
      .map((line) => {
        const stock = pantry.find(
          (p) => p.name.toLowerCase() === line.name && p.unit === line.unit,
        );
        line.pantryUsed = Math.min(stock?.quantity || 0, line.required);
        if (stock) stock.quantity -= line.pantryUsed;
        line.required -= line.pantryUsed;
        return line;
      })
      .filter((line) => line.required > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { batchId: batch.id, lines, subtotalCents: 0 };
  });
}
export function packageMeasure(
  size: string,
): { unit: string; quantity: number } | undefined {
  const text = size.toLowerCase().trim();
  // Explicit each-sized multipacks; the price covers the whole pack.
  const multiple = text.match(
    /^(\d+)\s*(?:ct|pk|pack)\s*\/\s*(\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|oz|lb|g|ml|l))(?:\s+each)?$/,
  );
  if (multiple) {
    const inner = packageMeasure(multiple[2]);
    return inner
      ? { ...inner, quantity: inner.quantity * Number(multiple[1]) }
      : undefined;
  }
  const sticks = text.match(
    /^\d+\s*sticks?\s*\/\s*(\d+(?:\.\d+)?\s*(?:oz|g|lb))$/,
  );
  if (sticks) return packageMeasure(sticks[1]);
  const match = text.match(
    /^(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|lb|lbs|g|kg|ml|l|ct|count|each)\.?$/,
  );
  if (!match || Number(match[1]) <= 0) return;
  const unit = match[2].replace(/[.\s]/g, "");
  const units: Record<string, [string, number]> = {
    floz: ["ml", 29.5735],
    oz: ["g", 28.3495],
    lb: ["g", 453.592],
    lbs: ["g", 453.592],
    g: ["g", 1],
    kg: ["g", 1000],
    ml: ["ml", 1],
    l: ["ml", 1000],
    ct: ["each", 1],
    count: ["each", 1],
    each: ["each", 1],
  };
  const [normalized, factor] = units[unit];
  return { unit: normalized, quantity: Number(match[1]) * factor };
}
export function matchRetailLine(
  line: RetailLine,
  product?: LivePrices["items"][number],
): RetailLine {
  if (!product || product.regularCents === undefined || product.error)
    return {
      ...line,
      issue: product?.error || "No matching priced product found",
    };
  const result = {
    ...line,
    productId: product.productId,
    description: product.description,
    size: product.size,
    unitPriceCents: product.regularCents,
  };
  const pack = packageMeasure(product.size || "");
  if (!pack || pack.unit !== line.unit)
    return {
      ...result,
      issue: "Package quantity needs review; no unit conversion assumed",
    };
  const packages = Math.ceil(line.required / pack.quantity - 1e-9);
  return { ...result, packages, totalCents: packages * product.regularCents };
}
export async function buildRetailBasket(plan: Plan): Promise<RetailBasket> {
  const batches = retailRequirements(plan);
  const prices = await livePrices(plan, [
    ...new Set(batches.flatMap((b) => b.lines.map((l) => l.name))),
  ]);
  for (const batch of batches) {
    batch.lines = batch.lines.map((line) =>
      matchRetailLine(
        line,
        prices.items.find((p) => p.ingredient === line.name),
      ),
    );
    batch.subtotalCents = batch.lines.reduce(
      (sum, line) => sum + (line.totalCents ?? 0),
      0,
    );
  }
  return {
    environment: prices.environment || "production",
    fetchedAt: prices.fetchedAt,
    storeName: prices.storeName,
    storeId: prices.storeId,
    batches,
    subtotalCents: batches.reduce((s, b) => s + b.subtotalCents, 0),
    unresolved: batches
      .flatMap((b) => b.lines)
      .filter((l) => l.totalCents === undefined).length,
    finalTotalCents: null,
  };
}
export async function pricePlan(plan: Plan) {
  try {
    plan.retailBasket = await buildRetailBasket(plan);
    delete plan.pricingError;
  } catch {
    delete plan.retailBasket;
    plan.pricingError =
      "Kroger pricing is unavailable. Refresh prices to complete the shopping list.";
  }
  plan.pricingSource = "kroger";
  // Remove legacy synthetic amounts; numeric totals below are priced subtotals only.
  const requirements = plan.retailBasket?.batches ?? retailRequirements(plan);
  for (const batch of plan.batches) {
    const lines = requirements.find((b) => b.batchId === batch.id)?.lines ?? [];
    batch.groceries = lines.map((line) => ({
      name: line.name,
      unit: line.unit,
      required: line.required,
      pantryUsed: line.pantryUsed,
      packageSize: packageMeasure(line.size || "")?.quantity ?? 0,
      packages: line.packages ?? 0,
      unitPriceCents: line.unitPriceCents ?? 0,
      totalCents: line.totalCents ?? 0,
      pricingIssue:
        line.issue ??
        (line.totalCents === undefined ? "Price unavailable" : undefined),
    }));
    batch.subtotalCents = lines.reduce(
      (sum, line) => sum + (line.totalCents ?? 0),
      0,
    );
    batch.feeCents = 0;
    batch.taxCents = 0;
    batch.tipCents = 0;
    batch.totalCents = batch.subtotalCents;
  }
  plan.totalCents = plan.batches.reduce((sum, b) => sum + b.subtotalCents, 0);
  plan.issue =
    plan.totalCents > plan.preferences.budgetCents
      ? "Priced groceries already exceed the weekly cap. Change meals or quantities before continuing."
      : "Purchases are on hold until products, quantities, and all checkout charges are confirmed.";
  // Invalidate approval: a product quote is not an all-in checkout quote.
  if (!plan.batches.some((b) => b.orderId)) {
    plan.status = "draft";
    delete plan.approvedRevision;
    delete plan.approvedAt;
  }
}
