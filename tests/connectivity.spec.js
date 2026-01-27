import { test, expect } from '@playwright/test';

// Fast connectivity check - just verify URL is reachable and login form exists
test.setTimeout(30000);

test('Connectivity login check', async ({ page }) => {
  const email = process.env.TEST_EMAIL || '';
  const password = process.env.TEST_PASSWORD || '';
  const baseUrl = process.env.BASE_URL || '';

  if (!email || !password || !baseUrl) {
    throw new Error('Missing TEST_EMAIL, TEST_PASSWORD, or BASE_URL');
  }

  // Quick navigation with short timeout
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (navError) {
    throw new Error(`Cannot reach ${baseUrl}: ${navError.message}`);
  }

  // Brief wait for initial render
  await page.waitForTimeout(500);

  // Quick check for login form elements
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();

  try {
    await emailInput.waitFor({ state: 'visible', timeout: 5000 });
    await passwordInput.waitFor({ state: 'visible', timeout: 3000 });
  } catch (waitError) {
    const pageTitle = await page.title().catch(() => 'unknown');
    const pageUrl = page.url();
    const bodyText = await page.locator('body').textContent().catch(() => '').then(t => t?.slice(0, 300) || '');
    throw new Error(`Login form not found. URL: ${pageUrl}, Title: ${pageTitle}. Content: ${bodyText}`);
  }

  // Fill credentials quickly
  await emailInput.fill(email);
  await passwordInput.fill(password);

  const submit = page.locator('button:has-text("Login"), button:has-text("Sign In"), button[type="submit"]').first();
  if ((await submit.count()) > 0) {
    await submit.click();
  }

  // Quick check for OTP or dashboard (whichever appears first)
  const otpSelector = 'input[type="text"][inputmode="numeric"], input[data-otp], .otp input';
  const dashboardSelector = 'table, [role="table"]';

  const result = await Promise.race([
    page.waitForSelector(otpSelector, { state: 'visible', timeout: 8000 }).then(() => 'otp').catch(() => null),
    page.waitForSelector(dashboardSelector, { state: 'visible', timeout: 8000 }).then(() => 'dashboard').catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 9000))
  ]);

  if (!result) {
    const errorText = await page.locator('[role="alert"], .toast, .alert, .error, text=/invalid|incorrect|failed|error/i').first().textContent().catch(() => '');
    const loginStillVisible = await emailInput.isVisible().catch(() => false);
    if (errorText) {
      throw new Error(`Login failed: ${errorText.trim()}`);
    }
    if (loginStillVisible) {
      throw new Error('Login failed: login form still visible (check credentials)');
    }
    throw new Error('Login did not reach OTP or dashboard');
  }

  // Success - we reached OTP or dashboard, connectivity confirmed
  // For connectivity test, we don't need to complete OTP - just confirm we got past login
});
