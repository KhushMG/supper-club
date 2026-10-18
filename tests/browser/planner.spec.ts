import { test, expect } from "@playwright/test";
test("plan, swap, approve, sandbox orders, responsive layout", async ({
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
    page.getByRole("button", { name: "Approve this week" }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Swap Monday dinner" }).click();
  await page.locator(".swap-list button").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Approve this week" }).click();
  await expect(
    page.getByRole("heading", { name: "Your week is approved." }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/private/tmp/supper-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Deliveries", exact: true }).click();
  await page.getByRole("button", { name: "Simulate orders now" }).click();
  await expect(page.locator(".delivery-card .status").first()).toHaveText(
    "submitted",
  );
  await page.getByRole("button", { name: "Simulate orders now" }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText(
      "Simulated 0 grocery order(s). No real groceries purchased.",
    ),
  ).toBeVisible();
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
