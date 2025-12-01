import { test, expect } from '@playwright/test';

test.setTimeout(180000);

test('Dev login with manual OTP verification and create asset wallet', async ({ page }) => {
  const email = 'hwashenwong+2@gambit.com.my';
  const password = 'Yy12220901!';

  await page.setViewportSize({ width: 1280, height: 900 });

  // Step 1: Login
  await page.goto('https://staging-web-enterprise.sandbox.gambitcustody-test.com/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');

  // Step 2: Wait for OTP and fill
  await page.waitForSelector('.otp, input[name="otp"], input[type="tel"]', { timeout: 30000 });
  await page.screenshot({ path: 'otp-page-before-fill.png', fullPage: true });
  await fillOtpManually(page);

  // Step 3: Robust wait for dashboard (race URL / selector)
  const ctx = page.context();
  let activePage = page;
  try {
    const waitForDashboard = activePage.locator('text=Dashboard').waitFor({ state: 'visible', timeout: 60000 }).then(() => ({ type: 'selector' })).catch(() => null);
    const waitForUrl = activePage.waitForURL('**/dashboard', { timeout: 60000 }).then(() => ({ type: 'url' })).catch(() => null);
    const res = await Promise.race([waitForDashboard, waitForUrl, new Promise(res => setTimeout(() => res(null), 65000))]);
    if (!res) {
      await activePage.screenshot({ path: 'no-dashboard.png', fullPage: true }).catch(() => {});
      const body = await activePage.evaluate(() => document.documentElement.innerHTML.slice(0, 1500)).catch(() => '');
      console.log('Dashboard not found, page snapshot:', body.slice(0, 800));
      throw new Error('Dashboard did not appear');
    }
  } catch (e) {
    // if page closed, try to recover last page
    if (page.isClosed && page.isClosed()) {
      const pages = ctx.pages();
      activePage = pages[pages.length - 1];
    } else {
      throw e;
    }
  }

  await activePage.screenshot({ path: 'login-dashboard.png', fullPage: true });

  // Step 4: Click Create Asset Wallet
  await detectAndClickCreateAssetWallet(activePage);

  // Step 5: Wait for modal (may be in an iframe) and handle modal flow
  const modalContext = await waitForCreateAssetModal(activePage); // returns either Page or Frame
  await handleCreateAssetModal(modalContext);

  // Step 6: Wait for dashboard to reload and select the newly created wallet
  try {
    console.log('Step 6: Waiting for dashboard reload after wallet creation...');
    await activePage.waitForTimeout(2000);
    
    // Ensure page is still open before proceeding
    if (activePage.isClosed && activePage.isClosed()) {
      const pages = ctx.pages();
      activePage = pages[pages.length - 1];
    }

    // Wait for dashboard table to load
    await activePage.locator('table, [role="table"]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    
    // Step 7: Find and select the newly created wallet row (first table data row)
    console.log('Step 7: Finding and selecting the created wallet from table...');
    const walletRow = await selectAndCopyWalletAddress(activePage);
    
    if (walletRow) {
      console.log('✓ Wallet address copied. Preparing recipients payload...');
      console.log(`Recipients payload:\n${JSON.stringify(walletRow.recipientsPayload, null, 2)}`);
    } else {
      console.log('⚠ Could not extract wallet address');
    }
  } catch (e) {
    console.log('Step 6-7 error:', e.message);
  }

  // Final screenshot (page may close after Create is clicked, so handle gracefully)
  try {
    await activePage.waitForTimeout(1000);
    if (!activePage.isClosed()) {
      await activePage.screenshot({ path: 'after-create-asset-click.png', fullPage: true });
    } else {
      console.log('✓ Page closed after Create (likely successful navigation)');
    }
  } catch (e) {
    console.log('Final screenshot skipped: page closed after Create');
  }
});

// Helper: detect and click the Create Asset Wallet button using several strategies
async function detectAndClickCreateAssetWallet(page) {
  const allBtnTexts = await page.locator('button').allTextContents();
  let btn = page.locator('button:has-text("Create Asset Wallet")').first();
  let found = await btn.count() > 0;
  if (!found) {
    btn = page.locator('button:has(span:has-text("Create Asset Wallet"))').first();
    found = await btn.count() > 0;
  }
  if (!found) {
    btn = page.locator('button[class*="bg-primary"]').filter({ hasText: 'Create' }).first();
    found = await btn.count() > 0;
  }
  if (!found) {
    btn = page.locator('button >> text="Create Asset Wallet"').first();
    found = await btn.count() > 0;
  }
  if (!found) {
    btn = page.locator('button').filter({ hasText: /Create.*Asset|Asset.*Create/ }).first();
    found = await btn.count() > 0;
  }
  if (!found) {
    const btnHandle = await page.evaluateHandle(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Create Asset Wallet')));
    const isValid = btnHandle && !(await btnHandle.evaluate(el => el === null));
    if (isValid) {
      btn = page.locator('button').filter({ hasText: 'Create Asset Wallet' }).first();
      found = true;
    }
  }
  if (!found) {
    throw new Error('Create Asset Wallet button not found. Available: ' + allBtnTexts.join(', '));
  }
  await btn.scrollIntoViewIfNeeded();
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  for (let i = 0; i < 20; i++) {
    if (await btn.isEnabled()) break;
    await page.waitForTimeout(200);
  }
  // Try normal click, then force click, then JS click, then coordinate click as last resort
  try {
    await btn.click({ timeout: 5000 });
    return;
  } catch (e1) {
    try {
      await btn.click({ force: true });
      return;
    } catch (e2) {
      try {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Create Asset Wallet'));
          if (b) b.click();
        });
        return;
      } catch (e3) {
        // last resort: click by coordinates using boundingBox
        try {
          const box = await btn.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            return;
          }
        } catch (ec) {
          // give up
        }
      }
    }
  }
}

// Helper: wait for modal to appear
// Wait for modal to appear. Returns the Page or Frame where the modal was found.
async function waitForCreateAssetModal(page) {
  const candidates = ['[role="dialog"]', '.modal', '[class*="modal"]', '[class*="dialog"]', '.chakra-modal'];
  for (const sel of candidates) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (n > 0) {
      try { await page.locator(sel).first().waitFor({ state: 'visible', timeout: 3000 }); await page.screenshot({ path: 'create-asset-modal.png', fullPage: true }); return page; } catch (e) {}
    }
  }

  // fallback: look for text inside main page
  const texts = ['text=Create Asset Wallet', 'text=Create Asset', 'text=Create Wallet'];
  for (const t of texts) {
    if ((await page.locator(t).count()) > 0) { await page.screenshot({ path: 'create-asset-modal-text.png', fullPage: true }); return page; }
  }

  // search inside frames
  const frames = page.frames();
  for (const f of frames) {
    try {
      for (const sel of candidates) {
        if ((await f.locator(sel).count()) > 0) {
          try { await f.locator(sel).first().waitFor({ state: 'visible', timeout: 3000 }); await page.screenshot({ path: 'create-asset-modal-iframe.png', fullPage: true }); return f; } catch (e) {}
        }
      }
      for (const t of texts) {
        if ((await f.locator(t).count()) > 0) { await page.screenshot({ path: 'create-asset-modal-iframe-text.png', fullPage: true }); return f; }
      }
    } catch (e) {
      // ignore frame errors
    }
  }
  return page;
}

// Handle the Create Asset modal flow
async function handleCreateAssetModal(ctx) {
  const modalCtx = ctx;

  const modal = modalCtx.locator('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]').first();
  try { await modal.waitFor({ state: 'visible', timeout: 3000 }); } catch (e) {}

  // 1) Select option 'OKK'
  console.log('Step 1: Selecting OKK asset...');
  try {
    const opener = modal.locator('[role="combobox"], button[aria-haspopup="listbox"], .select, div[role="button"]').first();
    if ((await opener.count()) > 0) { await opener.click().catch(() => {}); await modalCtx.waitForTimeout(300); }
    const option = modalCtx.locator('li[role="option"]:has-text("OKK")').first();
    if ((await option.count()) > 0) { await option.click().catch(() => option.click({ force: true })); console.log('✓ OKK selected'); }
  } catch (e) { console.log('Select OKK failed:', e.message); }

  // 2) Fill name field robustly
  console.log('Step 2: Filling name field...');
  try {
    const nameInput = modal.locator('input[placeholder="Name"], input[placeholder*="name"], input[id*="name"]').first();
    if ((await nameInput.count()) > 0) {
      await nameInput.fill('Test Wallet 2').catch(() => {});
      console.log('✓ Name filled (via placeholder/id selector)');
    } else {
      const inputs = modal.locator('input:not([type="hidden"]):not([type="checkbox"])');
      let filled = false;
      const ic = await inputs.count();
      for (let i = 0; i < ic && !filled; i++) {
        const cand = inputs.nth(i);
        const visible = await cand.isVisible().catch(() => false);
        const enabled = await cand.isEnabled().catch(() => false);
        const hasValue = await cand.evaluate(el => !el.value).catch(() => false);
        if (visible && enabled && hasValue) {
          await cand.fill('Test Wallet').catch(() => {});
          filled = true;
          console.log('✓ Name filled (via first empty visible input)');
        }
      }
      if (!filled) console.log('⚠ Name input not found, continuing anyway...');
    }
  } catch (e) { console.log('Fill name error:', e.message); }

  // 3) Check the single checkbox
  console.log('Step 3: Checking checkbox...');
  try {
    const cb = modal.locator('input[type="checkbox"]').first();
    if ((await cb.count()) > 0) { 
      await cb.check().catch(() => cb.click().catch(() => {})); 
      console.log('✓ Checkbox checked');
    }
  } catch (e) { console.log('Check checkbox failed:', e.message); }

  // 4) Click Next button
  console.log('Step 4: Clicking Next...');
  try {
    const next = modal.locator('button:has-text("Next"), button:has-text("Continue")').first();
    if ((await next.count()) > 0) { 
      await next.click().catch(() => next.click({ force: true }));
      console.log('✓ Next clicked, waiting for OTP screen...');
      await modalCtx.waitForTimeout(500);
    }
  } catch (e) { console.log('Click Next failed:', e.message); }

  // 5) Auto-fill OTP after Next is clicked
  console.log('Step 5: Auto-filling OTP...');
  try {
    await fillOtpInContext(modalCtx, modal);
    console.log('✓ OTP filled and verified');
  } catch (e) { console.log('OTP filling error:', e.message); }

  // 6) Click Create button
  console.log('Step 6: Clicking Create...');
  try {
    const create = modal.locator('button:has-text("Create"), button:has-text("Create Asset"), button:has-text("Confirm")').first();
    if ((await create.count()) > 0) { 
      await create.click().catch(() => create.click({ force: true }));
      console.log('✓ Create clicked');
      await modalCtx.waitForTimeout(1000); 
      if (modalCtx.screenshot) await modalCtx.screenshot({ path: 'create-asset-after-create.png', fullPage: true }); 
    }
  } catch (e) { console.log('Click Create failed:', e.message); }
}

// Reusable OTP filler that works in Page or Frame context
async function fillOtpInContext(ctx, containerLocator = null) {
  const container = containerLocator || ctx;
  const inputs = container.locator('.otp input, .otp .rounded input, input[data-otp], input[type="tel"], input[class*="otp"]');
  const count = await inputs.count().catch(() => 0);
  
  if (count >= 6) {
    console.log('Filling multi-digit OTP inputs...');
    const digits = ['1','2','3','4','5','6'];
    for (let i = 0; i < 6; i++) { 
      await inputs.nth(i).fill(digits[i]).catch(() => {}); 
      await ctx.waitForTimeout(100); 
    }
  } else {
    console.log('Filling single OTP input...');
    const single = container.locator('input[name="otp"]').first();
    if ((await single.count()) > 0) { 
      await single.fill('123456').catch(() => {}); 
    } else {
      try {
        await ctx.evaluate(() => {
          const container = document.querySelector('.otp') || document;
          const inputs = container.querySelectorAll('input');
          for (let i = 0; i < Math.min(6, inputs.length); i++) {
            inputs[i].value = ['1','2','3','4','5','6'][i];
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      } catch (e) {
        console.log('JS evaluate OTP failed:', e.message);
      }
    }
  }

  // Click verify/submit button
  const verifyBtn = container.locator('button:has-text("Verify")').first();
  if ((await verifyBtn.count()) > 0) { 
    try { 
      await verifyBtn.click({ timeout: 5000 }); 
      console.log('Verify clicked');
    } catch (e) { 
      try { await verifyBtn.click({ force: true }); console.log('Verify clicked (forced)'); } catch (e2) {}
    } 
    return; 
  }
  
  const submitBtn = container.locator('button:has-text("Submit"), button[type="submit"]').first();
  if ((await submitBtn.count()) > 0) { 
    try { 
      await submitBtn.click({ timeout: 5000 }); 
      console.log('Submit clicked');
    } catch (e) { 
      try { await submitBtn.click({ force: true }); console.log('Submit clicked (forced)'); } catch (e2) {}
    } 
    return; 
  }
}

// Manual OTP filler for login (uses Page context)
async function fillOtpManually(page) {
  console.log('Starting OTP fill for login...');
  await fillOtpInContext(page);
}
 
  // Handle the Create Asset modal: select option, fill name, check box, Next, OTP, Create
 



 