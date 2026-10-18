import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRecipeWeb } from "../lib/recipe-search";
import { defaults } from "../lib/domain";
import { publicIPv4 } from "../lib/recipe-page";
process.env.TURSO_DATABASE_URL =
  "file:" + join(tmpdir(), "recipe-search-" + crypto.randomUUID() + ".db");
process.env.OPENAI_API_KEY = "test";
test("web discovery is query-driven, cached by feedback, and bounded", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tool_calls, 1);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.tools[0].type, "web_search");
    if (calls < 3) assert.equal(body.tools[0].filters, undefined);
    assert.equal(body.input, "dinner recipe");
    assert.doesNotMatch(body.input, /Preferences|recentMeals|[{}]/);
    assert.match(body.instructions, /noodles/);
    return Response.json({
      output: [
        {
          type: "message",
          content: [
            {
              text: JSON.stringify({
                recipes: [
                  {
                    url: "https://www.seriouseats.com/noodles",
                    cuisine: defaults.cuisines[0],
                  },
                  {
                    url: "https://127.0.0.1/private",
                    cuisine: defaults.cuisines[0],
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
  };
  try {
    const first = await searchRecipeWeb(defaults, "noodles", "", "dinner");
    assert.equal(first.recipes.length, 1);
    await searchRecipeWeb(defaults, "noodles", "", "dinner");
    assert.equal(calls, 1);
    await searchRecipeWeb(defaults, "spicy noodles", "", "dinner");
    assert.equal(calls, 2);
    await assert.rejects(
      () =>
        searchRecipeWeb(
          defaults,
          "spicy noodles",
          "",
          "dinner",
          [],
          ["www.seriouseats.com"],
        ),
      /no usable recipe/,
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});
test("recipe downloader rejects private and special addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicIPv4(ip), false);
  assert.equal(publicIPv4("8.8.8.8"), true);
});
