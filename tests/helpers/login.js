// This file does not contain any opening code fence.
// tests/helpers/login.js
export async function loginWithMFA(page, email, password) {
  return page;
}
// tests/helpers/login.js
export async function loginWithMFA(page, email, password) {
  await page.goto('https://staging-web-enterprise.sandbox.gambitcustody-test.com/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');

  // Wait for OTP UI (single input or multi-digit inputs) to appear
  await page.waitForSelector('.otp, input[name="otp"], input[data-qa="otp-input"], input[type="tel"]', { timeout: 15000 });

  // Request MFA token via the page.request API to avoid importing request fixtures
  const mfaResponse = await page.request.post('https://staging-web-enterprise.sandbox.gambitcustody-test.com/users/login/mfa', {
    data: { email },
    headers: { 'Content-Type': 'application/json' }
  });

  let token = null;

  if (mfaResponse && mfaResponse.ok()) {
    const body = await mfaResponse.json();
    token = body.token || body.mfaToken || body.otp || null;
  }

  // If we got a token, try to fill it into the UI (supports single input or multi-digit inputs)
  if (token) {
    // Try single input first
    const single = await page.$('input[name="otp"]');
    if (single) {
      await single.fill(token);
    } else {
      // Try to find multiple inputs inside the otp container
      const inputs = page.locator('.otp input, .otp .rounded input, input[data-otp], input[type="tel"], input[class*="otp"]');
      const count = await inputs.count();
      if (count >= token.length && count > 0) {
        for (let i = 0; i < token.length; i++) {
          await inputs.nth(i).fill(token[i]);
        }
      } else {
        // Fallback: set values via evaluate
        await page.evaluate((t) => {
          const container = document.querySelector('.otp') || document;
          const inputs = container.querySelectorAll('input');
          for (let i = 0; i < inputs.length && i < t.length; i++) {
            inputs[i].value = t[i];
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, token);
      }
    }

    // Attempt to submit OTP - try common buttons inside the otp container first
    const modal = page.locator('.otp');
    if ((await modal.count()) > 0) {
      const submitBtn = modal.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Submit" )').first();
      if ((await submitBtn.count()) > 0) {
        await submitBtn.click();
      } else {
        await page.click('button[type="submit"]');
      }
    } else {
      await page.click('button[type="submit"]');
    }

    // Wait for dashboard navigation
    await page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => {});
  }

  return page;
}
