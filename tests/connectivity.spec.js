import { test, expect } from '@playwright/test';

test.setTimeout(120000);

test('Connectivity login check', async ({ page }) => {
  const email = process.env.TEST_EMAIL || '';
  const password = process.env.TEST_PASSWORD || '';
  const baseUrl = process.env.BASE_URL || '';

  if (!email || !password || !baseUrl) {
    throw new Error('Missing TEST_EMAIL, TEST_PASSWORD, or BASE_URL');
  }

  // Navigate to the base URL with better error handling
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (navError) {
    throw new Error(`Cannot reach ${baseUrl}: ${navError.message}`);
  }

  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();

  try {
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
  } catch (waitError) {
    throw new Error(`Login form not found on page. Check if ${baseUrl} has email/password inputs.`);
  }

  await emailInput.fill(email);
  await passwordInput.fill(password);

  const submit = page.locator('button:has-text("Login"), button:has-text("Sign In"), button[type="submit"]').first();
  if ((await submit.count()) > 0) {
    await submit.click();
  }

  const otpSelector = 'input[type="text"][inputmode="numeric"], input[data-otp], .otp input';
  const dashboardSelector = 'table, [role="table"]';

  const result = await Promise.race([
    page.waitForSelector(otpSelector, { state: 'visible', timeout: 20000 }).then(() => 'otp').catch(() => null),
    page.waitForSelector(dashboardSelector, { state: 'visible', timeout: 20000 }).then(() => 'dashboard').catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 21000))
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

  if (result === 'otp') {
    const inputs = page.locator('.otp input, .otp .rounded input, input[data-otp], input[type="tel"], input[class*="otp"]');
    const count = await inputs.count().catch(() => 0);
    if (count >= 6) {
      const digits = ['1','2','3','4','5','6'];
      for (let i = 0; i < 6; i++) {
        await inputs.nth(i).fill(digits[i]).catch(() => {});
      }
    } else {
      const single = page.locator('input[name="otp"]').first();
      if ((await single.count()) > 0) await single.fill('123456').catch(() => {});
    }

    const verifyBtn = page.locator('button:has-text("Verify")').first();
    if ((await verifyBtn.count()) > 0) {
      await verifyBtn.click().catch(() => {});
    } else {
      const submitBtn = page.locator('button:has-text("Submit"), button[type="submit"]').first();
      if ((await submitBtn.count()) > 0) await submitBtn.click().catch(() => {});
    }
  }

  try {
    await page.locator(dashboardSelector).first().waitFor({ state: 'visible', timeout: 30000 });
    await expect(page.locator(dashboardSelector).first()).toBeVisible();
  } catch (e) {
    const errorText = await page.locator('[role="alert"], .toast, .alert, .error, text=/invalid|incorrect|failed|error/i').first().textContent().catch(() => '');
    if (errorText) {
      throw new Error(`OTP/Login failed: ${errorText.trim()}`);
    }
    throw e;
  }
});
