import { test, expect } from '@playwright/test';

test.setTimeout(180000);

test('Dev login and copy Root wallet address', async ({ page, context }) => {
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

  await activePage.screenshot({ path: 'login-dashboard-root.png', fullPage: true }).catch(() => {});

  // Wait for table/page with wallets
  try {
    let pageReady = false;
    for (let attempts = 0; attempts < 30 && !pageReady; attempts++) {
      try {
        const tableCount = await activePage.locator('table').count().catch(() => 0);
        if (tableCount >= 1) { pageReady = true; break; }
      } catch (e) {}
      const pages = ctx.pages();
      if (pages.length > 0) {
        activePage = pages[pages.length - 1];
        try {
          const tableCount = await activePage.locator('table').count().catch(() => 0);
          if (tableCount >= 1) { pageReady = true; break; }
        } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 300));
    }
    if (!pageReady) { console.log('Could not find page with table'); }

    // Take screenshot before extraction
    await activePage.screenshot({ path: 'before-root-extract.png', fullPage: true }).catch(() => {});

    // Extract Root address
    console.log('Finding "Root" wallet row and copying its address...');
    const rootAddress = await selectAndCopyWalletAddress(activePage, 'Root');
    if (rootAddress) console.log(`✓ Root wallet address: ${rootAddress}`); else console.log('⚠ Could not extract Root wallet address');
  } catch (e) {
    console.log('Step error:', e.message);
  }

  try { if (!activePage.isClosed()) await activePage.screenshot({ path: 'after-create-asset-click-root.png', fullPage: true }); } catch (e) {}
});

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

function generateRandomWalletName() { const randomNum = Math.floor(Math.random() * 9000) + 1000; return `test${randomNum}`; }

// Strict selection: find the row containing "Root" by searching page content and extracting address
async function selectAndCopyWalletAddress(page, targetLabel = null) {
  try {
    if (page.isClosed && page.isClosed()) { console.log('Page is closed'); return null; }
    console.log(`Finding wallet row${targetLabel ? ` with label "${targetLabel}"` : ' (first row)'}...`);
    
    // Scroll down to ensure all content loads
    await page.evaluate(() => {
      let el = document.body.innerText.includes('Root') ? document.evaluate("//div[contains(normalize-space(.), 'Root')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue : null;
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'center' });
    }).catch(() => {});
    await page.waitForTimeout(300);
    
    if (targetLabel) {
      const tl = targetLabel.trim();
      // Try finding by XPath text containing "Root"  
      const rowLocator = page.locator(`tr:has-text("${tl}")`);
      let rowCount = await rowLocator.count().catch(() => 0);
      console.log(`Found ${rowCount} rows with "${tl}" text`);
      
      if (rowCount > 0) {
        const targetRow = rowLocator.first();
        // Scroll into view
        await targetRow.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(100);
        
        // Click copy button in the row
        const copyBtn = targetRow.locator('button:has(.iconify[class*="i-carbon:copy"]), button[aria-label*="copy"]').first();
        if ((await copyBtn.count()) > 0) {
          try { await copyBtn.click(); console.log('Clicked copy button for Root'); } catch (e) { console.log('Copy click failed', e.message); }
        } else {
          // Try last button
          const lastBtn = targetRow.locator('button[type="button"]').last();
          if ((await lastBtn.count()) > 0) {
            try { await lastBtn.click(); console.log('Clicked last button'); } catch (e) {}
          }
        }
        
        // Extract address from row text
        const rowText = await targetRow.textContent().catch(() => '');
        const match = rowText && rowText.match(/0x[a-fA-F0-9]{40}/);
        if (match) { console.log('Address extracted from row text'); return match[0]; }
      }
    }
    
    // Try to read from clipboard
    try { 
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => ''); 
      if (clip && clip.length < 200 && clip.match(/0x[a-fA-F0-9]{40}/)) { 
        const match = clip.match(/0x[a-fA-F0-9]{40}/); 
        console.log('Address read from clipboard'); 
        return match[0]; 
      } 
    } catch (e) {}
    
    console.log('Could not extract wallet address');
    return null;
  } catch (e) { console.log('selectAndCopyWalletAddress error:', e.message); return null; }
}
