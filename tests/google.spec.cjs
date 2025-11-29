// tests/google.spec.js
const { test, expect } = require('@playwright/test');

test('Google search shows results', async ({ page }) => {
  await page.goto('https://www.google.com');
  await page.fill('input[name="q"]', 'Playwright');
  await page.keyboard.press('Enter');
  const results = page.locator('#search');
  await expect(results).toBeVisible();
});
