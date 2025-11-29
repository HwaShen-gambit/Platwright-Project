import { test, expect } from '@playwright/test';
import { loginWithMFA } from './helpers/login_fixed.js';

test('Dev login with API OTP verification', async ({ page }) => {
  const email = 'hwashenwong+2@gambit.com.my';
  const password = 'Yy12220901!';

  // Step 1: Login (navigates to OTP modal)
  await loginWithMFA(page, email, password);

  // Step 2: Wait for the OTP modal to appear
  await page.waitForSelector('.otp', { timeout: 15000 }).catch(() => {});

  // Step 3: Extract the mfaToken from the page (it might be in a hidden field or in the HTML)
  let mfaToken;
  
  try {
    // Try to find mfaToken in hidden input or data attribute
    mfaToken = await page.$eval('input[name="mfaToken"]', el => el.value).catch(() => null);
    
    if (!mfaToken) {
      mfaToken = await page.$eval('[data-mfa-token]', el => el.getAttribute('data-mfa-token')).catch(() => null);
    }
    
    if (!mfaToken) {
      // If not found, check the page source or network tab to see where mfaToken is stored
      console.log('MFA Token not found in page, checking alternative locations...');
      
      // Try to get from localStorage or sessionStorage
      mfaToken = await page.evaluate(() => {
        return localStorage.getItem('mfaToken') || sessionStorage.getItem('mfaToken');
      });
    }
  } catch (error) {
    console.log('Error finding mfaToken:', error);
  }

  // If we still don't have mfaToken, you might need to check your application
  // to see where it's stored, or get it from the login response
  if (!mfaToken) {
    console.log('MFA Token not found. Please check where your app stores the mfaToken after login.');
    // Fallback: Try UI approach
    await fillOtpManually(page);
  } else {
    console.log('Found MFA Token:', mfaToken);
    
    // Step 4: Call the API endpoint directly with dummy OTP
    const apiResponse = await page.request.post('https://staging-web-enterprise.sandbox.gambitcustody-test.com/api/auth/login-mfa', {
      data: {
        mfaToken: mfaToken,
        otpValue: "123456", // Your dummy OTP
        callbackUrl: "/"
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Step 5: Check if API call was successful
    if (apiResponse.ok()) {
      const responseData = await apiResponse.json();
      console.log('API Response:', responseData);
      
      // Step 6: Store the tokens if needed
      if (responseData.accessToken && responseData.refreshToken) {
        // Set tokens in localStorage or sessionStorage
        await page.evaluate(({ accessToken, refreshToken }) => {
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', refreshToken);
          sessionStorage.setItem('accessToken', accessToken);
          sessionStorage.setItem('refreshToken', refreshToken);
        }, responseData);
        
        console.log('Tokens stored successfully');
      }
      
      // Step 7: Navigate to dashboard or callback URL
      await page.goto('/dashboard');
    } else {
      console.log('API call failed:', await apiResponse.text());
      // Fallback to manual OTP entry
      await fillOtpManually(page);
    }
  }

  // Step 8: Wait for dashboard and verify
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await expect(page.locator('text=Dashboard')).toBeVisible();
  await page.screenshot({ path: 'login-dashboard.png', fullPage: true });
});

// Fallback function for manual OTP entry
async function fillOtpManually(page) {
  console.log('Falling back to manual OTP entry...');
  
  const inputs = page.locator('.otp input, .otp .rounded input, input[data-otp], input[type="tel"], input[class*="otp"]');
  const count = await inputs.count();

  if (count >= 6) {
    const digits = ['1','2','3','4','5','6'];
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(digits[i]);
      await page.waitForTimeout(100);
    }
  } else {
    // Try single field fallback
    const single = await page.$('input[name="otp"]');
    if (single) {
      await single.fill('123456');
    } else {
      // As a last resort, set via evaluate
      await page.evaluate(() => {
        const container = document.querySelector('.otp') || document;
        const inputs = container.querySelectorAll('input');
        for (let i = 0; i < Math.min(6, inputs.length); i++) {
          inputs[i].value = ['1','2','3','4','5','6'][i];
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }
  }

  // Click the verify/submit button inside the otp container if present (prefer 'Verify')
  const modal = page.locator('.otp');
  if ((await modal.count()) > 0) {
    const verifyBtn = modal.locator('button:has-text("Verify")').first();
    if ((await verifyBtn.count()) > 0) {
      try {
        await verifyBtn.click({ timeout: 5000 });
      } catch (e) {
        await verifyBtn.click({ force: true }).catch(() => {});
      }
      return;
    }

    const submitBtn = modal.locator('button:has-text("Submit"), button[type="submit"]').first();
    if ((await submitBtn.count()) > 0) {
      try {
        await submitBtn.click({ timeout: 5000 });
      } catch (e) {
        await submitBtn.click({ force: true }).catch(() => {});
      }
      return;
    }
  }

  // Generic fallback: try global Verify button or submit button
  const verifyGlobal = page.locator('button:has-text("Verify")').first();
  if ((await verifyGlobal.count()) > 0) {
    try {
      await verifyGlobal.click({ timeout: 5000 });
    } catch (e) {
      await verifyGlobal.click({ force: true }).catch(() => {});
    }
    return;
  }

  await page.click('button[type="submit"]').catch(() => {});
}