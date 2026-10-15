import { test, expect } from "@playwright/test";

test("search page loads", async ({ page }) => {
  await page.goto("http://localhost:3000/search");
  await expect(page.locator("h1")).toContainText("Shop");
});
