import { recipes, fetchRecipe } from "../lib/recipes";
import { writeFile } from "node:fs/promises";
const updated = await Promise.all(
  recipes.map(async (r) => {
    try {
      return await fetchRecipe(r.source, r.cuisine);
    } catch {
      console.warn("Kept prior snapshot:", r.source);
      return r;
    }
  }),
);
await writeFile("data/recipes.json", JSON.stringify(updated, null, 2) + "\n");
console.log("Refreshed published recipe snapshots.");
