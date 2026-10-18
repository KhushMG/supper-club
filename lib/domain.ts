import { z } from "zod";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import type { Preferences, Recipe, Grocery, Plan, Batch, State } from "./types";
export const CUISINES = [
  "Italian",
  "Mexican",
  "Indian",
  "Thai",
  "Mediterranean",
  "Japanese",
  "American",
];
export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const preferenceSchema = z.object({
  cuisines: z
    .array(
      z.enum([
        "Italian",
        "Mexican",
        "Indian",
        "Thai",
        "Mediterranean",
        "Japanese",
        "American",
      ]),
    )
    .min(1)
    .max(7),
  servings: z.number().int().min(1).max(12),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .transform((x) => [...new Set(x)].sort()),
  budgetCents: z.number().int().min(100).max(100000),
  cookingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z
    .string()
    .max(100)
    .refine((x) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: x });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
  zip: z.string().regex(/^\d{5}$/),
  address: z.string().max(300),
  diet: z.enum(["none", "vegetarian", "vegan"]),
  exclusions: z.array(z.string().min(1).max(50)).max(20),
  pantry: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        quantity: z.number().nonnegative().max(100000),
        unit: z.enum(["g", "ml", "each"]),
      }),
    )
    .max(100),
  tipCents: z.number().int().min(0).max(10000),
  recurring: z.boolean(),
});
export const defaults: Preferences = {
  cuisines: ["Italian", "Mexican", "Indian"],
  servings: 2,
  days: [0, 1, 2, 3, 4, 5, 6],
  budgetCents: 20000,
  cookingTime: "18:30",
  timezone: "America/Los_Angeles",
  zip: "98101",
  address: "",
  diet: "none",
  exclusions: [],
  pantry: [],
  tipCents: 300,
  recurring: true,
};
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
export function nextMonday(now = new Date(), timezone = "America/Los_Angeles") {
  const date = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
export function mealDate(week: string, day: number) {
  const d = new Date(week + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}
const fractions: Record<string, string> = {
  "½": " 1/2",
  "¼": " 1/4",
  "¾": " 3/4",
  "⅓": " 1/3",
  "⅔": " 2/3",
  "⅛": " 1/8",
  "⅜": " 3/8",
  "⅝": " 5/8",
  "⅞": " 7/8",
};
const units: Record<string, [string, number]> = {
  lb: ["g", 453.592],
  lbs: ["g", 453.592],
  pound: ["g", 453.592],
  pounds: ["g", 453.592],
  oz: ["g", 28.3495],
  ounce: ["g", 28.3495],
  ounces: ["g", 28.3495],
  g: ["g", 1],
  kg: ["g", 1000],
  cup: ["ml", 240],
  cups: ["ml", 240],
  tbsp: ["ml", 15],
  tablespoon: ["ml", 15],
  tablespoons: ["ml", 15],
  tsp: ["ml", 5],
  teaspoon: ["ml", 5],
  teaspoons: ["ml", 5],
  ml: ["ml", 1],
  l: ["ml", 1000],
  clove: ["each", 1],
  cloves: ["each", 1],
  can: ["each", 1],
  cans: ["each", 1],
  bunch: ["each", 1],
  bunches: ["each", 1],
};
export function ingredient(raw: string) {
  const text = raw
    .replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, (c) => fractions[c])
    .replace(/\([^)]*\)/g, "")
    .replace(/\*/g, "")
    .trim();
  const match = text.match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s+(.+)$/);
  if (!match) throw new Error("Unmeasured ingredient: " + raw);
  const q = match[1]
    .split(/\s+/)
    .reduce(
      (a, b) =>
        a +
        (b.includes("/")
          ? Number(b.split("/")[0]) / Number(b.split("/")[1])
          : Number(b)),
      0,
    );
  let name = match[2].toLowerCase().replace(/\$/g, "").trim(),
    unit = "each",
    factor = 1;
  const token = name.match(/^([a-z]+)\.?\s+/);
  if (token && units[token[1]]) {
    [unit, factor] = units[token[1]];
    name = name.slice(token[0].length);
  }
  name = name
    .replace(
      /^(?:fresh|freshly|dried|grated|cracked|ground|yellow|small|large|medium|extra virgin|boneless|skinless|chopped|diced|minced|frozen|cooked|uncooked)\s+/g,
      "",
    )
    .replace(/,.*$/, "")
    .trim();
  const aliases: [RegExp, string][] = [
    [/\bgarlic\b/, "garlic"],
    [/\bonions?\b/, "onion"],
    [/\bspinach\b/, "spinach"],
    [/\bblack pepper\b/, "black pepper"],
    [/\bsalt\b/, "salt"],
    [/\bchickpeas?\b|garbanzo/, "chickpeas"],
    [/olive oil/, "olive oil"],
    [/\bwater\b/, "water"],
  ];
  for (const [re, value] of aliases)
    if (re.test(name)) {
      name = value;
      break;
    }
  if (!Number.isFinite(q) || q <= 0 || !name)
    throw new Error("Invalid ingredient: " + raw);
  return { name, unit, quantity: q * factor };
}
export function compatible(recipe: Recipe, p: Preferences) {
  const s = recipe.ingredients.join(" ").toLowerCase();
  if (p.exclusions.some((x) => s.includes(x.toLowerCase()))) return false;
  if (
    p.diet !== "none" &&
    /\b(chicken|beef|pork|bacon|sausage|fish|salmon|shrimp|anchov|gelatin|turkey)\w*\b/.test(
      s,
    )
  )
    return false;
  if (
    p.diet === "vegan" &&
    /\b(cheese|parmesan|cream|milk|butter|egg|eggs|honey|yogurt|feta)\b/.test(s)
  )
    return false;
  try {
    recipe.ingredients.forEach(ingredient);
    return true;
  } catch {
    return false;
  }
}
// Deliberately synthetic catalog. No figure from this function is represented as a live retail quote.
export function sandboxBasket(
  meals: { recipe: Recipe }[],
  p: Preferences,
  pantry: Preferences["pantry"],
): Grocery[] {
  const map = new Map<
    string,
    { name: string; unit: string; quantity: number }
  >();
  for (const { recipe } of meals)
    for (const raw of recipe.ingredients) {
      const x = ingredient(raw);
      if (x.name === "water") continue;
      const key = x.name + "|" + x.unit;
      const existing = map.get(key);
      x.quantity *= p.servings / recipe.servings;
      if (existing) existing.quantity += x.quantity;
      else map.set(key, x);
    }
  return [...map.values()]
    .map((x) => {
      const stock = pantry.find(
        (y) => y.name.toLowerCase() === x.name && y.unit === x.unit,
      );
      const pantryUsed = Math.min(stock?.quantity ?? 0, x.quantity);
      if (stock) stock.quantity -= pantryUsed;
      const required = Math.max(0, x.quantity - pantryUsed);
      const spice =
        /salt|pepper|oregano|basil|cumin|paprika|curry|cinnamon|turmeric|chili powder/.test(
          x.name,
        );
      const packageSize =
        x.unit === "each"
          ? 1
          : x.unit === "g"
            ? spice
              ? 50
              : 454
            : spice
              ? 60
              : 500;
      const unitPriceCents = spice
        ? 199
        : /chicken|beef|salmon/.test(x.name)
          ? 699
          : /cheese|cream|parmesan/.test(x.name)
            ? 349
            : /rice|pasta|lentil|beans|chickpea/.test(x.name)
              ? 179
              : x.unit === "each"
                ? 89
                : 249;
      const packages = Math.ceil(required / packageSize - 1e-9);
      const surplus = packages * packageSize - required;
      if (
        surplus > 0 &&
        /pasta|rice|lentil|beans|chickpeas|oil|salt|pepper|oregano|basil|cumin|paprika|cinnamon|turmeric|sugar|flour|soy sauce/.test(
          x.name,
        )
      ) {
        if (stock) stock.quantity += surplus;
        else pantry.push({ name: x.name, unit: x.unit, quantity: surplus });
      }
      return {
        ...x,
        required: Math.round(required * 100) / 100,
        pantryUsed,
        packageSize,
        packages,
        unitPriceCents,
        totalCents: packages * unitPriceCents,
      };
    })
    .filter((x) => x.packages > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function quote(plan: Plan): Plan {
  delete plan.livePrices;
  const p = plan.preferences,
    pantry = structuredClone(p.pantry);
  // A batch spans at most three days; no assumed week-long fresh storage.
  const groups: number[][] = [];
  for (const day of p.days) {
    const last = groups.at(-1);
    if (last && day - last[0] <= 2) last.push(day);
    else groups.push([day]);
  }
  plan.batches = groups.map((days, i) => {
    const groceries = sandboxBasket(
      plan.meals.filter((m) => days.includes(m.day)),
      p,
      pantry,
    );
    const subtotalCents = groceries.reduce((a, x) => a + x.totalCents, 0);
    const feeCents = subtotalCents ? 399 : 0,
      taxCents = Math.ceil(subtotalCents * 0.085),
      tipCents = subtotalCents ? p.tipCents : 0;
    const start = fromZonedTime(
      mealDate(plan.week, days[0]) + "T" + p.cookingTime + ":00",
      p.timezone,
    );
    const deliveryAt = new Date(start.getTime() - 3600000).toISOString();
    return {
      id: plan.id + "-v" + plan.revision + "-" + i,
      days,
      deliveryAt,
      orderAt: new Date(start.getTime() - 25 * 3600000).toISOString(),
      groceries,
      subtotalCents,
      feeCents,
      taxCents,
      tipCents,
      totalCents: subtotalCents + feeCents + taxCents + tipCents,
      status: "scheduled",
    } as Batch;
  });
  plan.totalCents = plan.batches.reduce((a, b) => a + b.totalCents, 0);
  plan.status = plan.totalCents > p.budgetCents ? "infeasible" : "draft";
  plan.issue =
    plan.status === "infeasible"
      ? `This plan is ${money(plan.totalCents - p.budgetCents)} over your cap. Adjust cuisines, pantry stock, or dinner days; nothing will be ordered.`
      : undefined;
  delete plan.approvedAt;
  delete plan.approvedRevision;
  return plan;
}
export function makePlan(
  recipes: Recipe[],
  preferences: Preferences,
  week: string,
  feedback = "",
  mode: Plan["sourceMode"] = "published-recipes",
): Plan {
  const p: Preferences = preferenceSchema.parse(preferences);
  const eligible = recipes.filter(
    (r) => p.cuisines.includes(r.cuisine) && compatible(r, p),
  );
  if (!eligible.length)
    throw new Error(
      "No complete recipes match these preferences. Try another cuisine or dietary selection.",
    );
  const plan: Plan = {
    id: crypto.randomUUID(),
    week,
    revision: 1,
    preferences: p,
    meals: [],
    batches: [],
    totalCents: 0,
    status: "draft",
    sourceMode: mode,
    createdAt: new Date().toISOString(),
    feedback,
  };
  for (const [i, day] of p.days.entries()) {
    const cuisine = p.cuisines[i % p.cuisines.length];
    const candidates = eligible.filter((r) => r.cuisine === cuisine);
    if (!candidates.length)
      throw new Error(
        `No complete ${cuisine} recipes match your dietary preferences. Change that cuisine or use AI browsing.`,
      );
    plan.meals.push({
      day,
      recipe: candidates[Math.floor(i / p.cuisines.length) % candidates.length],
    });
  }
  quote(plan);
  if (plan.status === "infeasible") {
    for (const meal of plan.meals) {
      const options = eligible
        .filter((r) => r.cuisine === meal.recipe.cuisine)
        .map((r) => ({
          r,
          cost: sandboxBasket([{ recipe: r }], p, []).reduce(
            (a, g) => a + g.totalCents,
            0,
          ),
        }))
        .sort((a, b) => a.cost - b.cost);
      meal.recipe = options[0].r;
    }
    quote(plan);
  }
  return plan;
}
export function assertApprovable(p: Plan) {
  if (!["draft", "paused"].includes(p.status))
    throw new Error("This plan is not awaiting approval.");
  if (p.totalCents > p.preferences.budgetCents)
    throw new Error("Weekly budget exceeded.");
  if (
    p.batches.some((b) => b.status !== "scheduled" && b.status !== "cancelled")
  )
    throw new Error("This plan already has orders; create a new week instead.");
  if (p.batches.some((b) => new Date(b.deliveryAt).getTime() <= Date.now()))
    throw new Error("The delivery window has passed. Generate a future week.");
}
export function approve(p: Plan) {
  assertApprovable(p);
  p.status = "approved";
  p.approvedRevision = p.revision;
  p.approvedAt = new Date().toISOString();
  p.batches.forEach((b) => {
    if (b.status === "cancelled") b.status = "scheduled";
  });
}
export function pause(p: Plan) {
  p.status = "paused";
  p.batches.forEach((b) => {
    if (b.status === "scheduled") b.status = "cancelled";
  });
}
export function processDue(p: Plan, now = new Date(), force = false) {
  if (p.status !== "approved" || p.approvedRevision !== p.revision) return 0;
  let count = 0;
  let committed = p.batches
    .filter((b) => ["submitted", "delivered"].includes(b.status))
    .reduce((a, b) => a + b.totalCents, 0);
  for (const b of p.batches) {
    if (b.status === "submitted" && new Date(b.deliveryAt) <= now)
      b.status = "delivered";
    if (b.status !== "scheduled" || (!force && new Date(b.orderAt) > now))
      continue;
    if (new Date(b.deliveryAt) <= now && !force) {
      b.status = "held";
      b.reason = "Delivery window missed. Review before rescheduling.";
      continue;
    }
    if (committed + b.totalCents > p.preferences.budgetCents) {
      b.status = "held";
      b.reason = "Weekly budget cap prevents this order.";
      continue;
    }
    b.status = "submitted";
    b.orderId = "sandbox_" + b.id;
    committed += b.totalCents;
    count++;
  }
  return count;
}
export function log(s: State, message: string) {
  s.events.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    message,
  });
  s.events = s.events.slice(0, 100);
}
