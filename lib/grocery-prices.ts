import { z } from "zod";
import type { Plan } from "./types";
export type LivePrices = {
  provider: "Kroger";
  environment?: "production" | "certification";
  storeId: string;
  storeName: string;
  fetchedAt: string;
  items: {
    ingredient: string;
    productId?: string;
    description?: string;
    size?: string;
    regularCents?: number;
    promoCents?: number;
    error?: string;
  }[];
};
const item = z.object({
  productId: z.string(),
  description: z.string(),
  items: z
    .array(
      z.object({
        size: z.string().optional(),
        price: z
          .object({
            regular: z.number().nonnegative().optional(),
            promo: z.number().nonnegative().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
export function parseProduct(data: unknown, search?: string) {
  const parsed = z.object({ data: z.array(item) }).parse(data);
  const tokens = search
    ?.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t &&
        ![
          "and",
          "with",
          "fresh",
          "dried",
          "ground",
          "chopped",
          "diced",
          "minced",
          "canned",
        ].includes(t),
    );
  const product = parsed.data.find((p) => {
    const description = p.description
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .map((t) => t.replace(/s$/, ""));
    const unexpectedForm =
      tokens &&
      [
        "spray",
        "pudding",
        "soup",
        "sauce",
        "chips",
        "snack",
        "bread",
        "cracker",
        "dressing",
        "marinade",
        "seasoning",
      ].some((form) => description.includes(form) && !tokens.includes(form));
    return (
      !unexpectedForm &&
      (!tokens ||
        tokens.every((t) => description.includes(t.replace(/s$/, "")))) &&
      p.items?.some((i) => i.price?.regular !== undefined)
    );
  });
  if (!product) return undefined;
  const sku = product.items!.find((i) => i.price?.regular !== undefined)!;
  return {
    productId: product.productId,
    description: product.description,
    size: sku.size,
    regularCents: Math.round(sku.price!.regular! * 100),
    promoCents: sku.price?.promo
      ? Math.round(sku.price.promo * 100)
      : undefined,
  };
}
export function krogerEnvironment() {
  const environment = process.env.KROGER_ENVIRONMENT || "production";
  if (environment !== "production" && environment !== "certification")
    throw new Error("KROGER_ENVIRONMENT must be production or certification.");
  return environment;
}
export function krogerBaseUrl() {
  return krogerEnvironment() === "certification"
    ? "https://api-ce.kroger.com/v1"
    : "https://api.kroger.com/v1";
}
export async function livePrices(
  plan: Plan,
  ingredientNames?: string[],
): Promise<LivePrices> {
  const clientId = process.env.KROGER_CLIENT_ID,
    secret = process.env.KROGER_CLIENT_SECRET;
  if (!clientId || !secret)
    throw new Error(
      "Configure KROGER_CLIENT_ID and KROGER_CLIENT_SECRET for live store price lookup.",
    );
  const environment = krogerEnvironment();
  const baseUrl = krogerBaseUrl();
  const auth = await fetch(baseUrl + "/connect/oauth2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(clientId + ":" + secret).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "product.compact",
    }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!auth.ok)
    throw new Error(
      "Kroger authentication failed. Check your server credentials and product scope.",
    );
  const token = z
    .object({ access_token: z.string() })
    .parse(await auth.json()).access_token;
  async function get(path: string, params: Record<string, string>) {
    const r = await fetch(
      baseUrl + "/" + path + "?" + new URLSearchParams(params),
      {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      },
    );
    if (!r.ok)
      throw new Error(`Kroger price lookup unavailable (${r.status}).`);
    return r.json();
  }
  const locations = z
    .object({
      data: z.array(z.object({ locationId: z.string(), name: z.string() })),
    })
    .parse(
      await get("locations", {
        "filter.zipCode.near": plan.preferences.zip,
        "filter.limit": "1",
      }),
    );
  const store = locations.data[0];
  if (!store)
    throw new Error("No Kroger-family store was found near this ZIP.");
  const names = ingredientNames ?? [
    ...new Set(plan.batches.flatMap((b) => b.groceries.map((g) => g.name))),
  ];
  const results: LivePrices["items"] = [];
  for (let i = 0; i < names.length; i += 5) {
    results.push(
      ...(await Promise.all(
        names.slice(i, i + 5).map(async (ingredient) => {
          try {
            const product = parseProduct(
              await get("products", {
                "filter.term": ingredient,
                "filter.locationId": store.locationId,
                "filter.limit": "20",
              }),
              ingredient,
            );
            return product
              ? { ingredient, ...product }
              : { ingredient, error: "No priced product returned" };
          } catch {
            return { ingredient, error: "Price unavailable; try again later" };
          }
        }),
      )),
    );
  }
  return {
    provider: "Kroger",
    environment,
    storeId: store.locationId,
    storeName: store.name,
    fetchedAt: new Date().toISOString(),
    items: results,
  };
}
