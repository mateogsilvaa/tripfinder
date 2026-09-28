const { test, devices } = require("@playwright/test");
test.use({ timezoneId: "Europe/Madrid" });
test("movil entero", async ({ browser }) => {
  const d = { ...devices["iPhone 13"] }; delete d.defaultBrowserType; d.deviceScaleFactor = 1;
  const ctx = await browser.newContext({ ...d, timezoneId: "Europe/Madrid", serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto("/interrail.html");
  await page.waitForTimeout(800);
  await page.screenshot({ path: process.env.OUT + "/ir-entero.png", fullPage: true });
});
