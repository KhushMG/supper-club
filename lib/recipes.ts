import snapshots from "@/data/recipes.json";
import type { Recipe, Preferences } from "./types";
export const recipes: Recipe[] = snapshots;
import { recipePage } from "./recipe-page";
import { createHash } from "node:crypto";
export { validRecipeUrl } from "./recipe-page";
export function decodeRecipeText(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    frac12: "½",
    frac14: "¼",
    frac34: "¾",
    ndash: "–",
    mdash: "—",
    rsquo: "’",
  };
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (whole, entity: string) => {
      if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? whole;
      const n =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    })
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function recipeNodes(node: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 20 || !node || typeof node !== "object") return [];
  if (Array.isArray(node))
    return node.flatMap((n) => recipeNodes(n, depth + 1));
  const n = node as Record<string, unknown>;
  const types = Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]];
  if (types.some((t) => typeof t === "string" && /(?:^|[/#])Recipe$/i.test(t)))
    return [n];
  return Object.values(n).flatMap((value) => recipeNodes(value, depth + 1));
}
export function durationMinutes(value: unknown) {
  if (typeof value !== "string") return 0;
  const m = value.match(
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
  );
  return m
    ? Math.ceil(
        Number(m[1] || 0) * 1440 +
          Number(m[2] || 0) * 60 +
          Number(m[3] || 0) +
          Number(m[4] || 0) / 60,
      )
    : 0;
}
export function parseRecipePage(
  html: string,
  url: string,
  cuisine: string,
): Recipe {
  const errors: string[] = [];
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (
      !/\btype\s*=\s*(?:["']application\/ld\+json(?:\s*;[^"']*)?["']|application\/ld\+json(?=\s|$))/i.test(
        match[1],
      )
    )
      continue;
    let nodes: Record<string, unknown>[];
    try {
      nodes = recipeNodes(
        JSON.parse(match[2].trim().replace(/^<!--|-->$/g, "")),
      );
    } catch {
      errors.push("invalid recipe JSON-LD");
      continue;
    }
    for (const node of nodes) {
      const title =
        typeof node.name === "string" ? decodeRecipeText(node.name) : "";
      const ingredients = Array.isArray(node.recipeIngredient)
        ? node.recipeIngredient
            .filter((x): x is string => typeof x === "string")
            .map(decodeRecipeText)
            .filter(Boolean)
        : [];
      const yields = (
        Array.isArray(node.recipeYield) ? node.recipeYield : [node.recipeYield]
      ).map(String);
      const yieldText =
        yields.find((x) => /servings?|people|persons?/i.test(x)) ||
        yields[0] ||
        "";
      const servings = Number(yieldText.match(/\d+(?:\.\d+)?/)?.[0]);
      const minutes =
        durationMinutes(node.totalTime) ||
        durationMinutes(node.prepTime) + durationMinutes(node.cookTime);
      if (
        !title ||
        !ingredients.length ||
        ingredients.length !== (node.recipeIngredient as unknown[])?.length ||
        !Number.isFinite(servings) ||
        servings <= 0 ||
        !minutes
      ) {
        errors.push("missing title, ingredients, servings or cooking duration");
        continue;
      }
      const image = Array.isArray(node.image) ? node.image[0] : node.image;
      const rawImage =
        typeof image === "string"
          ? image
          : String((image as Record<string, unknown>)?.url || "");
      let imageUrl = "";
      try {
        const u = new URL(rawImage, url);
        if (rawImage && u.protocol === "https:") imageUrl = u.href;
      } catch {}
      const canonical = new URL(url);
      canonical.search = "";
      canonical.hash = "";
      return {
        id: createHash("sha256")
          .update(canonical.href)
          .digest("hex")
          .slice(0, 24),
        title,
        cuisine,
        source: canonical.href,
        publisher: canonical.hostname,
        servings,
        minutes,
        ingredients: ingredients.map((x) =>
          x.replace(/\s*\([^)]*\$[^)]*\)/g, "").trim(),
        ),
        image: imageUrl,
        fetchedAt: new Date().toISOString(),
      };
    }
  }
  throw new Error(
    errors.length
      ? `Incomplete recipe: ${[...new Set(errors)].join("; ")}.`
      : "Page has no structured Recipe data (possibly a collection or blocked page).",
  );
}
export async function fetchRecipe(
  url: string,
  cuisine: string,
): Promise<Recipe> {
  return parseRecipePage(await recipePage(url), url, cuisine);
}
export async function discover(
  p: Preferences,
  feedback: string,
): Promise<{ recipes: Recipe[]; mode: "published-recipes" | "ai-browsing" }> {
  if (feedback.trim())
    throw new Error("Use the AI planning run for free-text meal feedback.");
  const current = await Promise.all(
    recipes
      .filter((r) => p.cuisines.includes(r.cuisine))
      .map(async (r) => {
        try {
          return await fetchRecipe(r.source, r.cuisine);
        } catch {
          return r;
        }
      }),
  );
  return { recipes: current, mode: "published-recipes" };
}
