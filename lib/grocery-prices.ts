import { cacheKey, cached, cachePut } from "./agent-store";
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
    alternatives?: {
      productId: string;
      description: string;
      size?: string;
      regularCents: number;
      promoCents?: number;
    }[];
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
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+\d+\.\d+\)?$/, "")
    .replace(/[()]/g, " ")
    .replace(/^(?:\/|or)\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|l|oz)\s+/i, "")
    .replace(/^(?:(?:a\s+)?pinch(?:\s+of)?|handfuls?|stalks?|squeeze(?:\s+of)?|finely\s+grated)\s+/i, "")
    .replace(/\s+[-–—]\s+(?:optional|i(?:'|’)ve|for serving|to taste)\b.*$/i, "")
    .replace(/^\d+(?:\.\d+)?(?:\s+or\s+\d+(?:\.\d+)?)?[ -]*(?:oz|ounce|lb|pound)s?\.?\s+(?:cans?|jars?|packages?|packets?)\s+/i, "")
    .replace(/^(?:(?:c\.|cups?|units?|extra|pinch|to serve|for serving|peeled|warmed|grated|shredded|sliced)\s+)+/, "")
    .replace(
      /^(?:(?:can|cans|fresh|freshly|chopped|minced|cracked)\s+)+/,
      "",
    )
    .replace(/\s+hot or mild$/, "")
    .replace(/\s+(?:wedges|slices)$/, "")
    .replace(/garbanzo beans?/g, "chickpeas")
    .replace(/chicken stock concentrate/g, "chicken broth concentrate")
    .replace(/\bbasil leaves\b/g, "basil")
    .replace(/parmigiano[ -]reggiano/g, "parmesan")
    .replace(/\bserrano (?:chiles?|chill?i(?:es)?)\b/g, "serrano pepper")
    .replace(/red pepper flakes/g, "crushed red pepper")
    .replace(/\b(?:chiles?|chill?ies|chilli)\b/g, "chili")
    .replace(/fettucine/g, "fettuccine")
    .replace(/\s+/g, " ")
    .trim();
}
function ingredientOptions(search: string) {
  const term = normalizeIngredient(search);
  // Only accept alternatives explicitly offered by the recipe. Share the noun
  // in “cheddar or American cheese” without requiring both cheeses in a blend.
  const shared = term.match(/\b(basil(?: leaves)?|cheese|salt|pepper|rice|onions?|flour|oil|bread)$/)?.[1];
  return term.split(/\s+or\s+/).map(option => {
    if (shared && !option.endsWith(shared) && (shared === "cheese" || /^(holy|thai|sea|kosher|red|green|yellow|white|black|brown|sweet)$/.test(option))) return option + " " + shared;
    return option;
  });
}
export function retrievalQueries(search: string) {
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
    "serrano pepper": ["serrano"],
    "whole peeled tomatoes": ["whole tomatoes"],
    "parmesan cheese": ["parmigiano reggiano"],
    "pecorino romano cheese": ["pecorino romano"],
    naan: ["naan bread"],
    parmesan: ["parmesan cheese"],
  };
  return [...new Set(ingredientOptions(search).flatMap(term => [term, ...(aliases[term] || [])]))];
}
function matchingProducts(data: unknown, search?: string) {
  const products = z.object({ data: z.array(item) }).parse(data).data;
  if (!search) return products;
  const options = ingredientOptions(search);
  return products.filter(p => options.some(normalized => {
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
      if (
        p.categories?.some((c) =>
          /kitchen|household|cleaning|personal care|pet|hardware|home decor|floral|beauty/i.test(
            c,
          ),
        )
      )
        return false;
      if (
        p.categories?.length &&
        !p.categories.some((c) =>
          /produce|dairy|deli|meat|seafood|frozen|baking|spice|seasoning|condiment|sauce|pasta|grain|canned|packaged|beverage|breakfast|pantry|snack|bakery|international/i.test(
            c,
          ),
        )
      )
        return false;
      if (
        /\b(candle|soap|shampoo|fragrance|scent|lamp|shaker|utensil)\b/i.test(
          p.description,
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
            words.includes(f) && !tokens.some((t) => t.replace(/s$/, "") === f) &&
            !(f === "bread" && tokens.includes("naan")),
        )
      )
        return false;
      if (tokens.length === 0) return false;
      if (normalized === "ginger" && words.some(w => ["ground", "powder", "tea", "juice", "crystallized", "pickled"].includes(w))) return false;
      return tokens.every((t) => words.includes(t.replace(/s$/, "")));
    }))
    .sort((a, b) => {
      const price = (product: z.infer<typeof item>) => Math.min(...(product.items || []).map(sku => sku.price?.regular ?? Infinity));
      // Whole-package purchasing: prefer the lower upfront price among suitable
      // matches, rather than a short product name or premium bulk package.
      return price(a) - price(b) || a.description.length - b.description.length;
    });
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
function productAlternatives(
  candidates: z.infer<typeof item>[],
  ingredient: string,
) {
  return [
    ...new Map(
      matchingProducts({ data: candidates }, ingredient).flatMap((p) => {
        const parsed = parseProduct({ data: [p] }, ingredient);
        return parsed ? [[parsed.productId, parsed] as const] : [];
      }),
    ).values(),
  ]
    .sort((a, b) => a.regularCents - b.regularCents)
    .slice(0, 4);
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
    if (match)
      return {
        ingredient,
        ...match,
        alternatives: productAlternatives(candidates, ingredient),
      };
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
      if (match)
        return {
          ingredient,
          ...match,
          alternatives: productAlternatives(candidates, ingredient),
        };
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
    if (match) return { ingredient, ...match, alternatives: [match] };
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
async function fetchLivePrices(
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

export async function livePrices(
  plan: Plan,
  ingredientNames?: string[],
): Promise<LivePrices> {
  const names = ingredientNames ?? [
    ...new Set(plan.batches.flatMap((b) => b.groceries.map((g) => g.name))),
  ];
  const key =
    "kroger-v6:" +
    cacheKey({
      environment: krogerEnvironment(),
      zip: plan.preferences.zip,
      names: [...names].sort(),
    });
  const hit = await cached<LivePrices>(key);
  if (hit) return hit;
  const result = await fetchLivePrices(plan, names);
  if (!result.items.some((i) => i.error?.includes("timed out")))
    await cachePut(key, result, 15 * 60000);
  return result;
}
