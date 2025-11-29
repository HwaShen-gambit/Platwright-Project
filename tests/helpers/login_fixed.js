// tests/helpers/login_fixed.js
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

  if (mfaResponse) {
    if (mfaResponse.ok()) {
      // Safely attempt to parse JSON; some environments may return HTML or text.
      try {
        const body = await mfaResponse.json();
        token = body && (body.token || body.mfaToken || body.otp || null);
      } catch (err) {
        // If parsing JSON failed, log the raw text for debugging and fall back to UI
        const raw = await mfaResponse.text().catch(() => null);
        console.log('MFA response OK but not JSON. status=', mfaResponse.status(), 'body=', raw);
      }
    } else {
      const raw = await mfaResponse.text().catch(() => null);
      console.log('MFA request failed. status=', mfaResponse.status(), 'body=', raw);
    }
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

    // Attempt to submit OTP - prefer the Verify button inside the otp container
    const modal = page.locator('.otp');
    let clicked = false;
    if ((await modal.count()) > 0) {
      const verifyBtn = modal.locator('button:has-text("Verify")').first();
      if ((await verifyBtn.count()) > 0) {
        try {
          await verifyBtn.click({ timeout: 5000 });
        } catch (e) {
          await verifyBtn.click({ force: true }).catch(() => {});
        }
        clicked = true;
      } else {
        const submitBtn = modal.locator('button:has-text("Submit"), button[type="submit"]').first();
        if ((await submitBtn.count()) > 0) {
          try {
            await submitBtn.click({ timeout: 5000 });
          } catch (e) {
            await submitBtn.click({ force: true }).catch(() => {});
          }
          clicked = true;
        }
      }
    } else {
      // Try global Verify button as a fallback
      const verifyBtnGlobal = page.locator('button:has-text("Verify")').first();
      if ((await verifyBtnGlobal.count()) > 0) {
        try {
          await verifyBtnGlobal.click({ timeout: 5000 });
        } catch (e) {
          await verifyBtnGlobal.click({ force: true }).catch(() => {});
        }
        clicked = true;
      } else {
        await page.click('button[type="submit"]').catch(() => {});
        clicked = true;
      }
    }

    // Wait for OTP modal to go away if we clicked verify/submit
    if (clicked) {
      await page.waitForSelector('.otp', { state: 'detached', timeout: 10000 }).catch(() => {});
    }

    // Wait for dashboard navigation (non-fatal)
    await page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => {});
  }

  return page;
}
