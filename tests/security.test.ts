import { test } from "node:test";
import assert from "node:assert/strict";
import { token, verify, sameOrigin } from "../lib/auth";
import { validRecipeUrl } from "../lib/recipes";
test("signed sessions reject tampering", () => {
  process.env.AUTH_SECRET = "a".repeat(40);
  process.env.APP_PASSWORD = "a-long-test-password";
  const v = token();
  assert.equal(verify(v), true);
  assert.equal(verify(v + "x"), false);
  assert.equal(verify(undefined), false);
});
test("cross-origin mutations rejected", () => {
  assert.equal(
    sameOrigin(
      new Request("https://supper.example/api/plans/approve", {
        headers: { Origin: "https://evil.example" },
      }),
    ),
    false,
  );
  assert.equal(
    sameOrigin(
      new Request("https://supper.example/api/plans/approve", {
        headers: { Origin: "https://supper.example" },
      }),
    ),
    true,
  );
});
test("recipe fetching blocks local, untrusted and credential-bearing URLs", () => {
  for (const u of [
    "http://127.0.0.1",
    "https://localhost",
    "https://www.budgetbytes.com.evil.com/",
    "https://user:pass@www.budgetbytes.com/",
    "file:///etc/passwd",
  ])
    assert.equal(validRecipeUrl(u), false);
  assert.equal(
    validRecipeUrl("https://www.budgetbytes.com/creamy-tomato-spinach-pasta/"),
    true,
  );
});
