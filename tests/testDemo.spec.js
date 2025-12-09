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

    // Click on the created wallet row to open its detail view (with retries)
    console.log(`Step 7: Clicking on created wallet row (${createdWalletName})...`);
    let walletClicked = false;
    let rootAddress = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.log(`Retry attempt ${attempt + 1}/3 to find wallet row...`);
        await activePage.waitForTimeout(2000);
      }
      walletClicked = await clickWalletRow(activePage, createdWalletName);
      if (walletClicked) {
        console.log('✓ Wallet row clicked, waiting for detail view...');
        await activePage.waitForTimeout(2500);
        
        // Extract Root address from within the wallet detail view
        console.log('Step 8: Finding "Root" wallet row and copying its address...');
        rootAddress = await selectAndCopyWalletAddress(activePage, 'Root');
        if (rootAddress) {
          console.log(`✓ Root wallet address: ${rootAddress}`);
          break;
        } else {
          console.log('⚠ Could not extract Root address on attempt', attempt + 1);
        }
      } else {
        console.log(`⚠ Could not click wallet row on attempt ${attempt + 1}`);
      }
    }
    
    if (!rootAddress) {
      console.log('⚠ Failed to find wallet row or extract Root address after all retries');
    }
    
    if (rootAddress) {
      console.log(`Using Root wallet address for transfer: ${rootAddress}`);
      
      // Click on the OKK/ETH TEST SEPOLIA cell to view details
      console.log('Step 9: Clicking on OKK asset cell in wallet row...');
      try {
        // Find the OKK cell in the current wallet row (contains "OKK" and "ETH TEST SEPOLIA")
        const okkCell = activePage.locator('td:has-text("OKK") >> text="ETH TEST SEPOLIA"').first();
        if ((await okkCell.count()) > 0) {
          await okkCell.click().catch(() => okkCell.click({ force: true }));
          console.log('✓ OKK cell clicked, staying on detail page...');
          await activePage.waitForTimeout(2000);
        } else {
          console.log('⚠ Could not find OKK/ETH TEST SEPOLIA cell');
        }
      } catch (e) {
        console.log('Error clicking OKK cell:', e.message);
      }
      
      // Continue with transfer UI automation in new tab (optional - can be removed if not needed)
      try {
        await openTransferUiAndSend(ctx, rootAddress, 0.00001);
      } catch (e) {
        console.log('Error automating transfer UI:', e.message);
      }
    } else console.log('⚠ Skipping further steps (no Root address extracted)');
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

  try { await page.evaluate(() => { 
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Create Asset Wallet')); 
    if (b) b.click(); }); 
    return; } 
    catch (e3) {}

  try { const box = await btn.boundingBox();
     if (box) { await page.mouse.click(box.x + box.width/2, box.y + box.height/2); 
      return; } 
    } catch (ec) {}
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

// Generate random wallet name like test1234
function generateRandomWalletName() {
  const randomNum = Math.floor(Math.random() * 9000) + 1000; // 1000-9999
  return `test${randomNum}`;
}

// Click on the created wallet row to open its detail view
async function clickWalletRow(page, walletName) {
  console.log(`Searching for wallet row with name: ${walletName}`);
  try {
    // Retry finding the row a few times with waits, as it may take time to appear
    for (let searchAttempt = 0; searchAttempt < 3; searchAttempt++) {
      if (searchAttempt > 0) {
        console.log(`  Re-searching for wallet row (attempt ${searchAttempt + 1}/3)...`);
        await page.waitForTimeout(1000);
      }
      
      // Find all table rows from Asset Wallets table
      const rows = page.locator('table tbody tr');
      const rowCount = await rows.count();
      console.log(`Found ${rowCount} wallet rows`);
      
      // Iterate through rows to find matching wallet name (case-insensitive)
      const searchName = walletName.toLowerCase();
      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const rowText = await row.innerText().catch(() => '');
        const rowLower = rowText.toLowerCase();
        
        // Log first few cells of each row for debugging
        const cells = row.locator('td, th');
        const firstCell = await cells.nth(0).innerText().catch(() => '');
        console.log(`Row ${i}: first cell="${firstCell.substring(0, 50)}", includes "${walletName}"=${rowLower.includes(searchName)}`);
        
        // Check if this row contains the wallet name
        if (rowLower.includes(searchName)) {
          console.log(`✓ Found wallet row with name: ${walletName} at index ${i}`);
          await row.click().catch(() => row.click({ force: true }));
          await page.waitForTimeout(1500); // Wait for detail view to load
          console.log('✓ Wallet row clicked, detail view should be loading...');
          return true;
        }
      }
    }
    
    console.log(`✗ Wallet row with name "${walletName}" not found after multiple searches`);
    return false;
  } catch (e) {
    console.log(`Error clicking wallet row: ${e.message}`);
    return false;
  }
}

// Select and copy wallet address from table
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
        const rowFullText = (await r.textContent().catch(() => '')).toLowerCase();
        if (rowFullText.includes(tl)) {
          targetRow = r;
          console.log(`✓ Found row with label "${targetLabel}" at index ${i}`);
          break;
        }
      }
      if (!targetRow) { console.log(`No row contains label "${targetLabel}"`); targetRow = allRows.first(); }
    } else {
      targetRow = allRows.first();
    }

    // Extract address from row text directly via regex - most reliable
    const rowText = await targetRow.textContent().catch(() => '');
    const match = rowText && rowText.match(/0x[a-fA-F0-9]{40}/);
    if (match) { 
      console.log(`✓ Address extracted from row text: ${match[0]}`); 
      return match[0]; 
    }
    
    // Fallback: try to click copy button
    const copyBtn = targetRow.locator('button:has(.iconify[class*="i-carbon:copy"]), button[aria-label*="copy"], button:has-text("Copy")').first();
    if ((await copyBtn.count()) > 0) {
      try { 
        await copyBtn.click().catch(() => copyBtn.click({ force: true })); 
        console.log('Clicked copy button');
        await page.waitForTimeout(200);
      } catch (e) { console.log('Copy click failed', e.message); }
    }
    
    // Try clipboard read after clicking
    try { 
      const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')); 
      if (clip && clip.match(/0x[a-fA-F0-9]{40}/)) { 
        const addr = clip.match(/0x[a-fA-F0-9]{40}/)[0];
        console.log('Address read from clipboard'); 
        return addr; 
      } 
    } catch (e) {}
    
    console.log('Could not extract wallet address');
    return null;
  } catch (e) { console.log('selectAndCopyWalletAddress error:', e.message); return null; }
}

// Attempt to POST transfer payload to multiple candidate endpoints on the provided base URL
async function sendTransferPayload(page, baseUrl, candidates, payload) {
  for (const path of candidates) {
    const url = (baseUrl.endsWith('/') && path.startsWith('/')) ? baseUrl.slice(0, -1) + path : baseUrl + path;
    try {
      console.log('Trying transfer POST to', url);
      const resp = await page.request.post(url, {
        data: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
        timeout: 10000
      });
      const status = resp.status();
      let body = '';
      try { body = await resp.text(); } catch (e) { body = '<non-text response>'; }
      console.log(`POST ${url} -> status ${status}`);
      console.log('Response body (first 1000 chars):', body.substring(0, 1000));
      if (status >= 200 && status < 300) {
        console.log('Transfer accepted at', url);
        return { url, status, body };
      }
      // Some APIs may return 202 or 201 for accepted
      if (status === 202 || status === 201) {
        console.log('Transfer accepted (202/201) at', url);
        return { url, status, body };
      }
      // Continue trying other endpoints for 4xx/5xx/405
    } catch (e) {
      console.log(`Request to ${url} failed:`, e.message);
    }
  }
  return null;
}

// Open transfer UI (eth.html), paste the recipient(s) and amount(s) in the expected format,
// then click the "Send Tokens" button. Uses new tab/page from the provided context.
async function openTransferUiAndSend(context, recipientAddress, amount) {
  const page = await context.newPage();
  try {
    const url = 'https://wallet-transfer-platform.vercel.app/eth.html';
    console.log('Opening transfer UI at', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Select OKK radio button for token type
    console.log('Selecting OKK token type...');
    try {
      const okkRadio = page.locator('input[type="radio"]').filter({ has: page.locator('text=OKK') }).first();
      if ((await okkRadio.count()) > 0) {
        await okkRadio.click().catch(() => okkRadio.click({ force: true }));
        console.log('✓ OKK radio selected');
        await page.waitForTimeout(500);
      } else {
        // Try alternative selector: label containing OKK with nested radio
        const okkLabel = page.locator('label:has-text("OKK")').first();
        if ((await okkLabel.count()) > 0) {
          await okkLabel.click().catch(() => okkLabel.click({ force: true }));
          console.log('✓ OKK label clicked');
          await page.waitForTimeout(500);
        } else {
          console.log('⚠ Could not find OKK radio button, continuing anyway');
        }
      }
    } catch (e) {
      console.log('Error selecting OKK radio:', e.message);
    }

    // Prepare the content in format: one per line, "address,amount"
    const line = `${recipientAddress},${amount}`;

    // Try to find a textarea or input placeholder for the addresses
    let input = null;
    const textarea = page.locator('textarea');
    if ((await textarea.count()) > 0) { input = textarea.first(); }
    else {
      // Look for inputs with placeholder hints
      const candidates = [
        'input[placeholder*="address"]',
        'input[placeholder*="one per line"]',
        'input[type="text"]',
        'textarea[placeholder*="address"]'
      ];
      for (const sel of candidates) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0) { input = loc; break; }
      }
    }

    if (!input) {
      // As a last resort try a contenteditable area
      const ce = page.locator('[contenteditable="true"]').first();
      if ((await ce.count()) > 0) input = ce;
    }

    if (!input) {
      console.log('Could not find input area on transfer page to paste addresses');
      await page.screenshot({ path: 'transfer-page-missing-input.png', fullPage: true }).catch(() => {});
      await page.close();
      return;
    }

    // Fill/paste the line. Use fill if input is a textarea/input, otherwise use evaluate to set innerText.
    try {
      const tagName = await input.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
      if (tagName === 'input' || tagName === 'textarea') {
        await input.fill(line + '\n');
      } else {
        await input.evaluate((el, val) => { el.innerText = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, line + '\n');
      }
      console.log('Pasted recipient line into transfer UI:', line);
    } catch (e) {
      console.log('Failed to fill transfer input:', e.message);
    }

    // Click the Send button
    const sendBtn = page.locator('button:has-text("Send Tokens")').first();
    if ((await sendBtn.count()) === 0) {
      // try button with value or other text
      const alt = page.locator('button').filter({ hasText: /Send|Send Token|Send Tokens/i }).first();
      if ((await alt.count()) > 0) {
        await alt.click().catch(() => alt.click({ force: true }));
      } else {
        console.log('Send button not found on transfer UI');
        await page.screenshot({ path: 'transfer-page-missing-send.png', fullPage: true }).catch(() => {});
        await page.close();
        return;
      }
    } else {
      await sendBtn.click().catch(() => sendBtn.click({ force: true }));
    }

    console.log('Clicked Send Tokens, waiting for confirmation...');
    // Wait for some success/failure indicator on the page
    try {
      await Promise.race([
        page.waitForSelector('text=success, text=Sent, text=Transaction', { timeout: 8000 }),
        page.waitForSelector('text=error, text=failed, text=Invalid', { timeout: 8000 })
      ]).catch(() => null);
    } catch (e) {}

    // Capture a screenshot and some page text for debugging
    await page.screenshot({ path: 'transfer-after-send.png', fullPage: true }).catch(() => {});
    const pageText = await page.locator('body').innerText().catch(() => '');
    console.log('Transfer UI page text (first 1000 chars):', pageText.substring(0, 1000));
    console.log('Keeping transfer UI page open for manual inspection if needed');
    // Don't close the page - keep it open for inspection
  } catch (e) {
    console.log('Error in openTransferUiAndSend:', e.message);
    // Still don't close on error
  }
}
