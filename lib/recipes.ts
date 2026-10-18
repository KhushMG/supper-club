import snapshots from "@/data/recipes.json";
import type { Recipe, Preferences } from "./types";
export const recipes: Recipe[] = snapshots;
const hosts = new Set([
  "www.budgetbytes.com",
  "budgetbytes.com",
  "www.bbcgoodfood.com",
  "www.simplyrecipes.com",
]);
export function validRecipeUrl(s: string) {
  try {
    const u = new URL(s);
    return (
      u.protocol === "https:" &&
      hosts.has(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port
    );
  } catch {
    return false;
  }
}
function findRecipe(node: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
  } else if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    const types = n["@type"];
    if (
      types === "Recipe" ||
      (Array.isArray(types) && types.includes("Recipe"))
    )
      return n;
    if (n["@graph"]) return findRecipe(n["@graph"]);
  }
  return undefined;
}
export async function fetchRecipe(
  url: string,
  cuisine: string,
): Promise<Recipe> {
  if (!validRecipeUrl(url)) throw new Error("Recipe host is not supported.");
  const res = await fetch(url, {
    headers: { "User-Agent": "SupperClub/1.0 recipe reader" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not open recipe source.");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty recipe source");
  let html = "",
    size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2500000) {
      await reader.cancel();
      throw new Error("Recipe page too large");
    }
    html += decoder.decode(value, { stream: true });
  }
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let node;
    try {
      node = findRecipe(JSON.parse(match[1]));
    } catch {
      continue;
    }
    if (!node) continue;
    const ing = node.recipeIngredient;
    const yieldValue = Array.isArray(node.recipeYield)
      ? node.recipeYield[0]
      : node.recipeYield;
    const servings = Number(String(yieldValue).match(/\d+/)?.[0]);
    const duration = String(node.totalTime ?? "");
    const minutes = [...duration.matchAll(/(\d+)([HM])/g)].reduce(
      (n, m) => n + Number(m[1]) * (m[2] === "H" ? 60 : 1),
      0,
    );
    if (
      !Array.isArray(ing) ||
      !ing.length ||
      !ing.every((x) => typeof x === "string") ||
      !servings ||
      !minutes
    )
      throw new Error(
        "Source is missing ingredients, servings, or preparation time.",
      );
    const image = Array.isArray(node.image) ? node.image[0] : node.image;
    return {
      id: new URL(url).pathname.replace(/\W/g, "-"),
      title: String(node.name),
      cuisine,
      source: url,
      publisher: new URL(url).hostname,
      servings,
      minutes,
      ingredients: ing.map((x) =>
        String(x)
          .replace(/\s*\([^)]*\$[^)]*\)/g, "")
          .trim(),
      ),
      image:
        typeof image === "string"
          ? image
          : String((image as Record<string, unknown>)?.url ?? ""),
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new Error("No complete structured recipe found.");
}
export async function discover(
  p: Preferences,
  feedback: string,
): Promise<{ recipes: Recipe[]; mode: "published-recipes" | "ai-browsing" }> {
  if (feedback.trim()) throw new Error("Use the AI planning run for free-text meal feedback.");
  const current = await Promise.all(recipes.filter(r=>p.cuisines.includes(r.cuisine)).map(async r=>{
    try{return await fetchRecipe(r.source,r.cuisine)}catch{return r}
  }));
  return {recipes:current,mode:"published-recipes"};
}
