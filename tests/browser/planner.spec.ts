import { test, expect } from "@playwright/test";
test("plan, swap, incomplete Kroger pricing holds purchases, responsive layout", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A good week starts at the table." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit preferences" }).click();
  await page.getByLabel("Weekly budget · all in ($)").fill("500");
  await page.getByRole("button", { name: "Build my dinner plan" }).click();
  await expect(
    page.getByRole("button", { name: "Awaiting final quote" }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Swap Monday dinner" }).click();
  await page.locator(".swap-list button").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Awaiting final quote" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Grocery list", exact: true }).click();
  await expect(
    page.getByText("Kroger pricing is unavailable.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Sandbox cost" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "This week", exact: false })
    .first()
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "A good week starts at the table." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/supper-mobile.png",
    fullPage: true,
  });
});
