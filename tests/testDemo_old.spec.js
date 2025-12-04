import { test, expect } from '@playwright/test';

test.setTimeout(180000);

test('Dev login with manual OTP verification and create asset wallet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const email = 'hwashenwong+2@gambit.com.my';
  const password = 'Yy12220901!';

  await page.setViewportSize({ width: 1280, height: 900 });

  // Login
  await page.goto('https://staging-web-enterprise.sandbox.gambitcustody-test.com/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');

  // OTP
  await page.waitForSelector('.otp, input[name="otp"], input[type="tel"]', { timeout: 30000 });
  await fillOtpManually(page);

  const ctx = page.context();
  let activePage = page;

  // Wait for dashboard
  try {
    const waitForDashboard = activePage.locator('text=Dashboard').waitFor({ state: 'visible', timeout: 60000 }).then(() => ({ type: 'selector' })).catch(() => null);
    const waitForUrl = activePage.waitForURL('**/dashboard', { timeout: 60000 }).then(() => ({ type: 'url' })).catch(() => null);
    const res = await Promise.race([waitForDashboard, waitForUrl, new Promise(res => setTimeout(() => res(null), 65000))]);
    if (!res) throw new Error('Dashboard did not appear');
  } catch (e) {
    if (page.isClosed && page.isClosed()) {
      const pages = ctx.pages();
      activePage = pages[pages.length - 1];
    } else throw e;
  }

  await activePage.screenshot({ path: 'login-dashboard.png', fullPage: true }).catch(() => {});

  // Click Create Asset Wallet
  await detectAndClickCreateAssetWallet(activePage);

  // Modal handling
  let newPageCreated = null;
  let createdWalletName = null;
  const pageListener = (p) => { newPageCreated = p; };
  ctx.on('page', pageListener);
  const modalContext = await waitForCreateAssetModal(activePage);
  createdWalletName = await handleCreateAssetModal(modalContext);
  ctx.off('page', pageListener);
  if (newPageCreated && !newPageCreated.isClosed?.()) activePage = newPageCreated;

  // Wait for table/page with wallets
  try {
    let pageReady = false;
    for (let attempts = 0; attempts < 20 && !pageReady; attempts++) {
      try {
        const tableCount = await activePage.locator('table, [role="table"]').first().count().catch(() => 0);
        if (tableCount > 0) { pageReady = true; break; }
      } catch (e) {}
      const pages = ctx.pages();
      if (pages.length > 0) {
        activePage = pages[pages.length - 1];
        const tableCount = await activePage.locator('table, [role="table"]').first().count().catch(() => 0);
        if (tableCount > 0) { pageReady = true; break; }
      }
      await new Promise(r => setTimeout(r, 200));
    }
    if (!pageReady) { console.log('Could not find page with table'); return; }

    // Click on the created wallet row to open its detail view
    console.log(`Step 7: Clicking on created wallet row (${createdWalletName})...`);
    const walletClicked = await clickWalletRow(activePage, createdWalletName);
    if (walletClicked) {
      console.log('✓ Wallet row clicked, waiting for detail view...');
      await activePage.waitForTimeout(1000);
    } else {
      console.log('⚠ Could not click wallet row');
    }

    // Extract Root address from within the wallet detail view
    console.log('Step 8: Finding "Root" wallet row and copying its address...');
    const rootAddress = await selectAndCopyWalletAddress(activePage, 'Root');
    if (rootAddress) console.log(`✓ Root wallet address: ${rootAddress}`); else console.log('⚠ Could not extract Root wallet address');
  } catch (e) {
    console.log('Step error:', e.message);
  }

  try { if (!activePage.isClosed()) await activePage.screenshot({ path: 'after-create-asset-click.png', fullPage: true }); } catch (e) {}
});

// Helper: detect and click the Create Asset Wallet button
async function detectAndClickCreateAssetWallet(page) {
  const allBtnTexts = await page.locator('button').allTextContents().catch(() => []);
  let btn = page.locator('button:has-text("Create Asset Wallet")').first();
  let found = (await btn.count()) > 0;
  if (!found) { btn = page.locator('button:has(span:has-text("Create Asset Wallet"))').first(); found = (await btn.count()) > 0; }
  if (!found) { btn = page.locator('button[class*="bg-primary"]').filter({ hasText: 'Create' }).first(); found = (await btn.count()) > 0; }
  if (!found) { btn = page.locator('button >> text="Create Asset Wallet"').first(); found = (await btn.count()) > 0; }
  if (!found) { btn = page.locator('button').filter({ hasText: /Create.*Asset|Asset.*Create/ }).first(); found = (await btn.count()) > 0; }
  if (!found) {
    const btnHandle = await page.evaluateHandle(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Create Asset Wallet'))).catch(() => null);
    const isValid = btnHandle && !(await btnHandle.evaluate(el => el === null).catch(() => true));
    if (isValid) { btn = page.locator('button').filter({ hasText: 'Create Asset Wallet' }).first(); found = true; }
  }
  if (!found) throw new Error('Create Asset Wallet button not found. Available: ' + allBtnTexts.join(', '));
  await btn.scrollIntoViewIfNeeded();
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  for (let i = 0; i < 20; i++) { if (await btn.isEnabled()) break; await page.waitForTimeout(200); }
  try { await btn.click({ timeout: 5000 }); return; } catch (e1) {}
  try { await btn.click({ force: true }); return; } catch (e2) {}
  try { await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Create Asset Wallet')); if (b) b.click(); }); return; } catch (e3) {}
  try { const box = await btn.boundingBox(); if (box) { await page.mouse.click(box.x + box.width/2, box.y + box.height/2); return; } } catch (ec) {}
}

// Helper: wait for create modal (page or frame)
async function waitForCreateAssetModal(page) {
  const candidates = ['[role="dialog"]', '.modal', '[class*="modal"]', '[class*="dialog"]', '.chakra-modal'];
  for (const sel of candidates) {
    if ((await page.locator(sel).count().catch(() => 0)) > 0) { await page.screenshot({ path: 'create-asset-modal.png', fullPage: true }).catch(() => {}); return page; }
  }
  const texts = ['text=Create Asset Wallet', 'text=Create Asset', 'text=Create Wallet'];
  for (const t of texts) if ((await page.locator(t).count().catch(() => 0)) > 0) { await page.screenshot({ path: 'create-asset-modal-text.png', fullPage: true }).catch(() => {}); return page; }
  const frames = page.frames();
  for (const f of frames) {
    try {
      for (const sel of candidates) if ((await f.locator(sel).count().catch(() => 0)) > 0) { await page.screenshot({ path: 'create-asset-modal-iframe.png', fullPage: true }).catch(() => {}); return f; }
      for (const t of texts) if ((await f.locator(t).count().catch(() => 0)) > 0) { await page.screenshot({ path: 'create-asset-modal-iframe-text.png', fullPage: true }).catch(() => {}); return f; }
    } catch (e) {}
  }
  return page;
}

// Handle the Create Asset modal flow
async function handleCreateAssetModal(ctx) {
  const modalCtx = ctx;
  let walletName = generateRandomWalletName();
  const modal = modalCtx.locator('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]').first();
  try { await modal.waitFor({ state: 'visible', timeout: 3000 }); } catch (e) {}

  console.log('Step 1: Selecting OKK asset...');
  try {
    const opener = modal.locator('[role="combobox"], button[aria-haspopup="listbox"], .select, div[role="button"]').first();
    if ((await opener.count()) > 0) { await opener.click().catch(() => {}); await modalCtx.waitForTimeout(300); }
    const option = modalCtx.locator('li[role="option"]:has-text("OKK")').first();
    if ((await option.count()) > 0) { await option.click().catch(() => option.click({ force: true })); console.log('✓ OKK selected'); }
  } catch (e) { console.log('Select OKK failed:', e.message); }

  console.log('Step 2: Filling name field...');
  try {
    const nameInput = modal.locator('input[placeholder="Name"], input[placeholder*="name"], input[id*="name"]').first();
    if ((await nameInput.count()) > 0) { await nameInput.fill(walletName).catch(() => {}); console.log(`✓ Name filled: ${walletName}`); }
    else {
      const inputs = modal.locator('input:not([type="hidden"]):not([type="checkbox"])');
      const ic = await inputs.count();
      for (let i = 0; i < ic; i++) { const cand = inputs.nth(i); if (await cand.isVisible().catch(() => false) && await cand.isEnabled().catch(() => false)) { await cand.fill(walletName).catch(() => {}); break; } }
    }
  } catch (e) { console.log('Fill name error:', e.message); }

  console.log('Step 3: Checking checkbox...');
  try { const cb = modal.locator('input[type="checkbox"]').first(); if ((await cb.count()) > 0) await cb.check().catch(() => cb.click().catch(() => {})); } catch (e) { console.log('Check checkbox failed:', e.message); }

  console.log('Step 4: Clicking Next...');
  try { const next = modal.locator('button:has-text("Next"), button:has-text("Continue")').first(); if ((await next.count()) > 0) await next.click().catch(() => next.click({ force: true })); await modalCtx.waitForTimeout(500); } catch (e) { console.log('Click Next failed:', e.message); }

  console.log('Step 5: Auto-filling OTP...');
  try { await fillOtpInContext(modalCtx, modal); } catch (e) { console.log('OTP filling error:', e.message); }

  console.log('Step 6: Clicking Create...');
  try {
    const create = modal.locator('button:has-text("Create"), button:has-text("Create Asset"), button:has-text("Confirm")').first();
    if ((await create.count()) > 0) {
      try { await Promise.race([ create.click(), new Promise(r => setTimeout(() => r('timeout'), 5000)) ]); console.log('✓ Create clicked'); }
      catch (e) { try { await Promise.race([ create.click({ force: true }), new Promise(r => setTimeout(() => r('timeout'), 5000)) ]); console.log('✓ Create clicked (force)'); } catch (e2) { console.log('Create click failed:', e2.message); } }
    }
  } catch (e) { console.log('Click Create failed:', e.message); }

  return walletName;
}

// Reusable OTP filler
async function fillOtpInContext(ctx, containerLocator = null) {
  const container = containerLocator || ctx;
  const inputs = container.locator('.otp input, .otp .rounded input, input[data-otp], input[type="tel"], input[class*="otp"]');
  const count = await inputs.count().catch(() => 0);
  if (count >= 6) {
    const digits = ['1','2','3','4','5','6'];
    for (let i = 0; i < 6; i++) { await inputs.nth(i).fill(digits[i]).catch(() => {}); await ctx.waitForTimeout(100); }
  } else {
    const single = container.locator('input[name="otp"]').first();
    if ((await single.count()) > 0) await single.fill('123456').catch(() => {});
    else {
      try { await ctx.evaluate(() => { const container = document.querySelector('.otp') || document; const inputs = container.querySelectorAll('input'); for (let i = 0; i < Math.min(6, inputs.length); i++) { inputs[i].value = ['1','2','3','4','5','6'][i]; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); inputs[i].dispatchEvent(new Event('change', { bubbles: true })); } }); } catch (e) {}
    }
  }
  const verifyBtn = container.locator('button:has-text("Verify")').first(); if ((await verifyBtn.count()) > 0) { try { await verifyBtn.click({ timeout: 5000 }); } catch (e) { try { await verifyBtn.click({ force: true }); } catch (e2) {} } return; }
  const submitBtn = container.locator('button:has-text("Submit"), button[type="submit"]').first(); if ((await submitBtn.count()) > 0) { try { await submitBtn.click({ timeout: 5000 }); } catch (e) { try { await submitBtn.click({ force: true }); } catch (e2) {} } return; }
}

async function fillOtpManually(page) { await fillOtpInContext(page); }

// Strict selection: find the row whose Addresses column (2nd td) equals the targetLabel, then click copy in that row
async function selectAndCopyWalletAddress(page, targetLabel = null) {
  try {
    if (page.isClosed && page.isClosed()) { console.log('Page is closed'); return null; }
    console.log(`Finding wallet row${targetLabel ? ` with label "${targetLabel}"` : ' (first row)'}...`);
    const allRows = page.locator('table tbody tr, [role="table"] [role="row"]');
    const rowCount = await allRows.count();
    if (rowCount === 0) { console.log('No wallet rows'); return null; }

    let targetRow = null;
    if (targetLabel) {
      const tl = targetLabel.trim().toLowerCase();
      for (let i = 0; i < rowCount; i++) {
        const r = allRows.nth(i);
        const cells = r.locator('td, th, [role="cell"]');
        const ccount = await cells.count();
        let nameText = '';
        if (ccount > 1) {
          nameText = (await cells.nth(1).innerText().catch(() => '')).trim().toLowerCase();
        } else {
          nameText = (await r.textContent().catch(() => '')).trim().toLowerCase();
        }
        console.log(`Row ${i} name-col: "${nameText.slice(0,80)}"`);
        if (nameText === tl) { targetRow = r; console.log(`✓ Exact match at row ${i}`); break; }
      }
      if (!targetRow) {
        for (let i = 0; i < rowCount; i++) {
          const r = allRows.nth(i);
          const txt = (await r.textContent().catch(() => '')).toLowerCase();
          if (txt.includes(tl)) { targetRow = r; console.log(`✓ Partial match at row ${i}`); break; }
        }
      }
      if (!targetRow) { console.log(`No row contains label "${targetLabel}"`); targetRow = allRows.first(); }
    } else {
      targetRow = allRows.first();
    }

    // Click copy button in the target row
    const copyBtn = targetRow.locator('button:has(.iconify[class*="i-carbon:copy"]), button[aria-label*="copy"], button:has-text("Copy")').first();
    if ((await copyBtn.count()) === 0) {
      const fallback = targetRow.locator('button[type="button"]').last();
      if ((await fallback.count()) > 0) {
        try { await fallback.click().catch(() => fallback.click({ force: true })); console.log('Clicked fallback button'); } catch (e) { console.log('Fallback click failed', e.message); }
      } else { console.log('No copy or fallback button found in row'); }
    } else {
      try { await copyBtn.click().catch(() => copyBtn.click({ force: true })); console.log('Clicked copy button'); } catch (e) { console.log('Copy click failed', e.message); }
    }

    // Extract address from row text as reliable fallback
    const rowText = await targetRow.textContent().catch(() => '');
    const match = rowText && rowText.match(/0x[a-fA-F0-9]{40}/);
    if (match) { console.log('Address extracted from row text'); return match[0]; }
    // Try clipboard read
    try { const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')); if (clip) { console.log('Address read from clipboard'); return clip; } } catch (e) {}
    console.log('Could not extract wallet address');
    return null;
  } catch (e) { console.log('selectAndCopyWalletAddress error:', e.message); return null; }
}

// Generate random wallet name like test1234
function generateRandomWalletName() {
  const randomNum = Math.floor(Math.random() * 9000) + 1000; // 1000-9999
  return `test${randomNum}`;
}

// Click on the created wallet row to open its detail view
async function clickWalletRow(page, walletName) {
  console.log(`Searching for wallet row with name: ${walletName}`);
  try {
    // Find all table rows
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    console.log(`Found ${rowCount} wallet rows`);
    
    // Iterate through rows to find matching wallet name
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = await row.innerText().catch(() => '');
      console.log(`Row ${i} text: ${rowText.substring(0, 100)}...`);
      
      if (rowText.includes(walletName)) {
        console.log(`✓ Found wallet row with name: ${walletName} at index ${i}`);
        await row.click().catch(() => row.click({ force: true }));
        await page.waitForTimeout(1000); // Wait for detail view to load
        console.log('✓ Wallet row clicked, detail view should be loading...');
        return true;
      }
    }
    
    console.log(`✗ Wallet row with name "${walletName}" not found`);
    return false;
  } catch (e) {
    console.log(`Error clicking wallet row: ${e.message}`);
    return false;
  }
}

// Select the first wallet from the table, click copy button, and extract wallet address
async function selectAndCopyWalletAddress(page, targetLabel = null) {
  try {
    if (page.isClosed && page.isClosed()) {
      console.log('Page is closed, cannot extract wallet address');
      return null;
    }

    console.log(`Finding wallet row${targetLabel ? ` with label "${targetLabel}"` : ' (first row)'}...`);

    // Find rows and pick either the row containing targetLabel or the first row
    const allRows = page.locator('table tbody tr, [role="table"] [role="row"]');
    const rowCount = await allRows.count();
    if (rowCount === 0) {
      console.log('No wallet row found in table');
      return null;
    }

    let targetRow = null;
    if (targetLabel) {
      const tl = targetLabel.toLowerCase();
      // Debug: print out all rows and their cell texts to understand structure
      console.log('Debug: enumerating table rows and cell texts for diagnosis...');
      for (let ri = 0; ri < rowCount; ri++) {
        const rr = allRows.nth(ri);
        const cells = rr.locator('td, th, [role="cell"]');
        const cc = await cells.count();
        const texts = [];
        for (let ci = 0; ci < cc; ci++) {
          const t = (await cells.nth(ci).innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
          texts.push(t.slice(0, 200));
        }
        const rowPreview = texts.length > 0 ? texts.join(' | ') : ((await rr.textContent().catch(() => '')).trim().slice(0,200));
        console.log(`Row ${ri}: ${rowPreview}`);
      }
      // Prefer exact cell match first (cell text === targetLabel), then fallback to contains
      for (let i = 0; i < rowCount; i++) {
        const r = allRows.nth(i);
        const cells = r.locator('td, th, [role="cell"]');
        const ccount = await cells.count();
        for (let j = 0; j < ccount; j++) {
          const cellText = (await cells.nth(j).innerText().catch(() => '')).trim().toLowerCase();
          if (cellText === tl) {
            targetRow = r;
            console.log(`✓ Exact match: Found row with label "${targetLabel}" at index ${i}, cell ${j}`);
            break;
          }
        }
        if (targetRow) break;
      }

      // If exact match not found, try contains (case-insensitive)
      if (!targetRow) {
        for (let i = 0; i < rowCount; i++) {
          const r = allRows.nth(i);
          const txt = (await r.textContent().catch(() => '')).toLowerCase();
          if (txt.includes(tl)) {
            targetRow = r;
            console.log(`✓ Partial match: Found row with label "${targetLabel}" at index ${i}`);
            break;
          }
        }
      }

      if (!targetRow) {
        console.log(`⚠ No row contains label "${targetLabel}", falling back to first row`);
        targetRow = allRows.first();
      }
    } else {
      targetRow = allRows.first();
    }

    // Click on the target row to select it
    await targetRow.click().catch(() => {});
    await page.waitForTimeout(300);

    // Find the copy button inside the target row (look for iconify copy icon, aria-label, or text)
    let copyBtn = targetRow.locator('button:has(.iconify[class*="i-carbon:copy"]), button[aria-label*="copy"], button:has-text("Copy")').first();
    if ((await copyBtn.count()) === 0) {
      console.log('Copy button not found by icon/text/aria in row, falling back to any button in the row...');
      const allBtns = targetRow.locator('button[type="button"]');
      const btnCount = await allBtns.count();
      console.log(`Found ${btnCount} buttons in row`);
      if (btnCount > 0) {
        // Try the last button (often the action/copy)
        copyBtn = allBtns.last();
      }
    }

    if ((await copyBtn.count()) > 0) {
      try {
        await copyBtn.click().catch(() => copyBtn.click({ force: true }));
        console.log('Clicked copy button for target row');
        await page.waitForTimeout(200);
      } catch (e) {
        console.log('Clicking copy button failed:', e.message);
      }
    } else {
      console.log('No copy button found in target row');
    }

    // Extract wallet address directly from the row's text content
    const rowText = await targetRow.textContent().catch(() => '');
    console.log('Wallet row text:', rowText.trim().substring(0, 200));

    // Extract wallet address from row text (usually a hex address starting with 0x)
    // This is more reliable than clipboard since we bypass permission prompts
    let walletAddress = '';
    const match = rowText.match(/0x[a-fA-F0-9]{40}/);
    if (match) {
      walletAddress = match[0];
      console.log('Address extracted from row text');
    }

    if (walletAddress) {
      console.log(`✓ Wallet address extracted: ${walletAddress}`);
      // Return only the address (user requested payload aside)
            // Prefer exact match in the Addresses column (usually the 2nd td in the row)
    } else {
      console.log('Could not extract wallet address');
      return null;
    }
  } catch (e) {
    console.log('selectAndCopyWalletAddress error:', e.message);
    return null;
  }
}
 

              if (nameText === tl) {

 


