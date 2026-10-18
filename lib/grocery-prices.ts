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
  categories: z.array(z.string()).optional(),
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
export function normalizeIngredient(search: string) {
  return search
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+\d+\.\d+\)?$/, "")
    .replace(
      /^(?:(?:can|cans|fresh|freshly|chopped|minced|ground|cracked)\s+)+/,
      "",
    )
    .replace(/\s+hot or mild$/, "")
    .replace(/garbanzo beans?/g, "chickpeas")
    .replace(/red pepper flakes/g, "crushed red pepper")
    .replace(/fettucine/g, "fettuccine")
    .replace(/\s+/g, " ")
    .trim();
}
export function retrievalQueries(search: string) {
  const term = normalizeIngredient(search);
  const aliases: Record<string, string[]> = {
    chickpeas: ["garbanzo beans"],
    "crushed red pepper": ["red pepper flakes"],
    "long grain white rice": ["white rice"],
    "penne pasta": ["penne"],
    fettuccine: ["fettuccine pasta", "fettucine"],
    "heavy cream": ["heavy whipping cream"],
    "tomatoes with green chiles": ["diced tomatoes green chilies", "rotel"],
    basil: ["basil leaves"],
    oregano: ["oregano leaves"],
    "black pepper": ["ground black pepper"],
    salt: ["table salt"],
    ginger: ["ginger root"],
    parmesan: ["parmesan cheese"],
  };
  return [...new Set([term, ...(aliases[term] || [])])];
}
function matchingProducts(data: unknown, search?: string) {
  const products = z.object({ data: z.array(item) }).parse(data).data;
  if (!search) return products;
  const normalized = normalizeIngredient(search);
  const tokens = normalized
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t &&
        ![
          "and",
          "with",
          "dried",
          "chopped",
          "diced",
          "canned",
          "pasta",
        ].includes(t),
    );
  return products
    .filter((p) => {
      if (
        p.categories?.some((c) =>
          /kitchen|household|cleaning|personal care|pet|hardware/i.test(c),
        )
      )
        return false;
      // A seasoning mentioned after "with" is not the product being sold.
      const primaryDescription = /\bwith\b/i.test(normalized)
        ? p.description
        : p.description.split(/\b(?:with|seasoned|flavored)\b/i)[0];
      const words = normalizeIngredient(primaryDescription)
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .map((t) => t.replace(/s$/, ""));
      const forms = [
        "spray",
        "pudding",
        "soup",
        "sauce",
        "chip",
        "snack",
        "bread",
        "cracker",
        "dressing",
        "marinade",
        "seasoning",
        "mill",
        "grinder",
        "set",
        "blend",
        "dip",
        "ale",
        "soda",
        "candy",
        "paste",
        "mozzarella",
      ];
      if (
        forms.some(
          (f) =>
            words.includes(f) && !tokens.some((t) => t.replace(/s$/, "") === f),
        )
      )
        return false;
      return tokens.every((t) => words.includes(t.replace(/s$/, "")));
    })
    .sort((a, b) => a.description.length - b.description.length);
}
export function parseProduct(data: unknown, search?: string) {
  const product = matchingProducts(data, search).find((p) =>
    p.items?.some((i) => i.price?.regular !== undefined),
  );
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
type GetProducts = (
  path: string,
  params: Record<string, string>,
) => Promise<unknown>;
export async function retrieveIngredient(
  ingredient: string,
  storeId: string,
  get: GetProducts,
): Promise<LivePrices["items"][number]> {
  const candidates: z.infer<typeof item>[] = [];
  for (const term of retrievalQueries(ingredient)) {
    const result = z
      .object({
        data: z.array(item).default([]),
        meta: z
          .object({ pagination: z.object({ total: z.number() }) })
          .optional(),
      })
      .parse(
        await get("products", {
          "filter.term": term,
          "filter.locationId": storeId,
          "filter.limit": "50",
        }),
      );
    candidates.push(...result.data);
    let match = parseProduct({ data: candidates }, ingredient);
    if (match) return { ingredient, ...match };
    if ((result.meta?.pagination.total || 0) > 50) {
      const page = z.object({ data: z.array(item).default([]) }).parse(
        await get("products", {
          "filter.term": term,
          "filter.locationId": storeId,
          "filter.limit": "50",
          "filter.start": "50",
        }),
      );
      candidates.push(...page.data);
      match = parseProduct({ data: candidates }, ingredient);
      if (match) return { ingredient, ...match };
    }
  }
  const matching = matchingProducts(
    { data: [...new Map(candidates.map((p) => [p.productId, p])).values()] },
    ingredient,
  );
  // Some search results omit prices. Verify promising IDs at the same store.
  for (const product of matching.slice(0, 2)) {
    const detail = z.object({ data: item }).parse(
      await get("products/" + encodeURIComponent(product.productId), {
        "filter.locationId": storeId,
      }),
    );
    const match = parseProduct({ data: [detail.data] }, ingredient);
    if (match) return { ingredient, ...match };
  }
  return {
    ingredient,
    error: matching.length
      ? "Matching products have no price at this store"
      : "No suitable product found after expanded search",
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
  const deadline = AbortSignal.timeout(45000);
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
    signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]),
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
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(
        baseUrl + "/" + path + "?" + new URLSearchParams(params),
        {
          headers: { Authorization: "Bearer " + token },
          signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]),
          cache: "no-store",
        },
      );
      if (r.ok) return r.json();
      if (attempt === 0 && (r.status === 429 || r.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      throw new Error(`Kroger price lookup unavailable (${r.status}).`);
    }
    throw new Error("Kroger lookup unavailable");
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
  const lookups = new Map<string, Promise<LivePrices["items"][number]>>();
  for (let i = 0; i < names.length; i += 5) {
    results.push(
      ...(await Promise.all(
        names.slice(i, i + 5).map(async (ingredient) => {
          const normalized = normalizeIngredient(ingredient);
          if (!lookups.has(normalized))
            lookups.set(
              normalized,
              retrieveIngredient(normalized, store.locationId, get).catch(
                () => ({
                  ingredient: normalized,
                  error: "Kroger request failed or timed out; retry pricing",
                }),
              ),
            );
          return { ...(await lookups.get(normalized)!), ingredient };
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
