/**
 * Multi-Chain Wallet Testing
 * 
 * Supports:
 * - OngKawKaw (ETH_TEST_SEPOLIA) - OKK on Ethereum Sepolia
 * - OngKawKaw (MATIC_TEST_AMOY) - OKK on Polygon Amoy
 * - Tether USD (TRX_TEST) - USDT on Tron Shasta
 * 
 * Run the prompt first to configure:
 *   node tests/config/prompt.js
 * 
 * Then run the test:
 *   npx playwright test tests/wallet-test.spec.js --headed
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { loadTestConfig, getTransferConfig, shouldTransferTo } from './config/loader.js';

// Global state
let rootInitializationCompleted = false;
let depositInitializationDone = false;
let depositWalletInitLabel = null;
let depositWalletAddress = null;
let coldWalletAddress = null;
let sweepedWalletLabels = new Set();

// Load configuration
let CONFIG;
try {
  CONFIG = loadTestConfig();
} catch (e) {
  console.error('Failed to load config:', e.message);
  console.error('Run "node tests/config/prompt.js" first to configure the test.');
  process.exit(1);
}

test.setTimeout(600000);

test(`Multi-Chain Wallet Test - ${CONFIG.chainDisplayName}`, async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  
  const email = CONFIG.email;
  const password = CONFIG.password;
  const baseUrl = CONFIG.baseUrl;
  const transferUrl = CONFIG.transferUrl;
  
  const ctx = context;
  let activePage = page;
  let dashboardPage = page;

  // Reset state
  rootInitializationCompleted = false;
  depositInitializationDone = false;
  depositWalletInitLabel = null;
  depositWalletAddress = null;
  coldWalletAddress = null;
  sweepedWalletLabels = new Set();

  await page.setViewportSize({ width: 1280, height: 900 });
  
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  MULTI-CHAIN WALLET TEST - ${CONFIG.chainDisplayName.padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`Chain: ${CONFIG.chainName}`);
  console.log(`Asset: ${CONFIG.assetName}`);
  console.log(`Transfer URL: ${transferUrl}`);
  console.log(`Transfers:`);
  CONFIG.transfers.forEach(t => {
    console.log(`  - ${t.tokenType}: ${t.amount} to ${t.targets.join(', ')}`);
  });
  console.log('');

  try {
    // Step 1: Login
    console.log(`Navigating to ${baseUrl}...`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    console.log('Step 1: Logging in...');
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();
    
    await emailInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    
    if ((await emailInput.count()) > 0 && (await passwordInput.count()) > 0) {
      console.log('Filling email...');
      await emailInput.fill(email);
      console.log('Filling password...');
      await passwordInput.fill(password);
      
      const submit = page.locator('button:has-text("Login"), button:has-text("Sign In"), button[type="submit"]').first();
      if ((await submit.count()) > 0) {
        console.log('Clicking login button...');
        await submit.click();
        await page.waitForTimeout(2000);
        console.log('✓ Login button clicked');
      } else {
        console.log('⚠ Login button not found');
      }
    } else {
      console.log('⚠ Login form not detected');
    }

    // Step 2: OTP
    console.log('Step 2: Waiting for OTP field...');
    await page.waitForTimeout(1000);
    const otpVisible = await page.locator('input[type="text"][inputmode="numeric"], input[data-otp], .otp input').first().isVisible().catch(() => false);
    if (otpVisible) {
      console.log('OTP field detected, filling...');
      await fillOtpInContext(page, page.locator('body'));
      await page.waitForTimeout(2000);
      console.log('✓ OTP filled');
    } else {
      console.log('No OTP field detected, continuing...');
    }

    dashboardPage = page;
    activePage = page;

    // Step 3: Wait for dashboard
    console.log('Step 3: Waiting for dashboard/wallet table...');
    await page.locator('table, [role="table"]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1000);
    console.log('✓ Dashboard loaded');

    // Step 4: Create Asset Wallet
    console.log(`Step 4: Creating Asset Wallet (${CONFIG.assetName})...`);
    await detectAndClickCreateAssetWallet(page);
    const modalCtx = await waitForCreateAssetModal(page);
    const walletName = await handleCreateAssetModal(modalCtx, {
      assetName: CONFIG.assetName,
      chainText: CONFIG.chainName
    });
    await page.waitForTimeout(1500);

    const walletTablePage = page;

    // Click the newly created asset wallet row to enter the wallet detail view
    console.log(`Clicking on asset wallet "${walletName}" to enter detail view...`);
    const assetWalletRow = walletTablePage.locator('table tbody tr', { hasText: walletName }).first();
    if ((await assetWalletRow.count()) > 0) {
      await assetWalletRow.scrollIntoViewIfNeeded().catch(() => {});
      await assetWalletRow.click({ force: true }).catch(() => {});
      await walletTablePage.waitForTimeout(2000);
      console.log(`✓ Asset wallet "${walletName}" clicked`);
    } else {
      // Fallback: click the first row
      const firstRow = walletTablePage.locator('table tbody tr').first();
      if ((await firstRow.count()) > 0) {
        await firstRow.click({ force: true }).catch(() => {});
        await walletTablePage.waitForTimeout(2000);
        console.log('✓ First wallet row clicked (fallback)');
      }
    }

    console.log('Waiting for Root wallet row to appear...');
    await refreshAssetWalletPage(walletTablePage).catch(() => {});
    const rootRowReady = await waitForWalletRowByName(walletTablePage, 'Root', 90000);
    if (!rootRowReady) {
      console.log('⚠ Root wallet row not detected after creation; stopping.');
      return;
    }

    // Step 5: Extract Root address with retry loop
    console.log('Step 5: Extract Root wallet address...');
    let rootAddress = null;
    const maxRootRetries = 10;
    for (let attempt = 1; attempt <= maxRootRetries; attempt++) {
      console.log(`Attempt ${attempt}/${maxRootRetries} to find Root wallet...`);
      rootAddress = await selectAndCopyWalletAddress(walletTablePage, 'Root');
      if (rootAddress) {
        break;
      }
      // Refresh and wait before next attempt
      await clickRefreshIcon(walletTablePage).catch(() => {});
      await walletTablePage.waitForTimeout(3000);
      await scrollWalletTableToBottom(walletTablePage, 2, 300);
    }
    if (!rootAddress) {
      console.log('⚠ Failed to extract Root address after retries; stopping.');
      return;
    }
    console.log(`✓ Root wallet address: ${rootAddress}`);

    // Step 6: Create Deposit Wallet
    const depositWalletName = `deposit${Math.floor(Math.random() * 9000) + 1000}`;
    depositWalletInitLabel = depositWalletName;
    console.log(`Step 6: Creating Deposit Wallet (${depositWalletName})...`);
    await createDepositWallet(walletTablePage, depositWalletName);

    await walletTablePage.waitForTimeout(2000);
    await clickRefreshIcon(walletTablePage).catch(() => {});
    const depositRow = walletTablePage.locator('table tbody tr', { hasText: depositWalletName }).first();
    if ((await depositRow.count()) > 0) {
      await depositRow.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      console.log(`✓ Deposit row "${depositWalletName}" is visible`);
    } else {
      console.log(`⚠ Deposit row "${depositWalletName}" not yet visible`);
    }
    await waitForWalletRowByName(walletTablePage, depositWalletName, 20000);

    // Step 7: Extract Deposit and Cold wallet addresses
    console.log('Step 7: Extracting Deposit and Cold wallet addresses...');
    let depositAddress = null;
    let coldAddress = null;
    try {
      // Extract deposit address - try the specific deposit name first
      depositAddress = await selectAndCopyWalletAddress(walletTablePage, depositWalletName);
      if (depositAddress && rootAddress && depositAddress.toLowerCase() === rootAddress.toLowerCase()) {
        console.log('⚠ Deposit address matches Root; waiting briefly before re-reading');
        await walletTablePage.waitForTimeout(2000);
        depositAddress = await selectAndCopyWalletAddress(walletTablePage, depositWalletName);
      }
      if (!depositAddress) {
        console.log(`⚠ Could not find row for ${depositWalletName}; falling back to "Deposit" label`);
        depositAddress = await selectAndCopyWalletAddress(walletTablePage, 'Deposit');
      }
      if (depositAddress) {
        console.log(`✓ Deposit wallet address (${depositWalletName}): ${depositAddress}`);
        depositWalletAddress = depositAddress;
      } else {
        console.log('⚠ Could not extract Deposit address');
      }

      // Extract cold address
      coldAddress = await selectAndCopyWalletAddress(walletTablePage, 'Cold');
      if (coldAddress) {
        console.log(`✓ Cold wallet address: ${coldAddress}`);
        coldWalletAddress = coldAddress;
      } else {
        console.log('⚠ Could not extract Cold address');
      }
      
      // Validate all three addresses are unique
      const addresses = [rootAddress, depositAddress, coldAddress].filter(Boolean);
      const uniqueAddresses = new Set(addresses.map(a => a.toLowerCase()));
      if (uniqueAddresses.size !== addresses.length) {
        console.log('⚠ WARNING: Some wallet addresses are duplicated!');
        console.log(`  Root: ${rootAddress}`);
        console.log(`  Deposit: ${depositAddress}`);
        console.log(`  Cold: ${coldAddress}`);
      } else {
        console.log('✓ All wallet addresses are unique');
      }
    } catch (e) {
      console.log('Error extracting wallet addresses:', e.message);
    }

    // Step 8: Send tokens based on chain config
    console.log('\n--- Step 8: Sending Tokens ---');
    const sendResults = {};
    
    for (const transferConfig of CONFIG.transfers) {
      const { tokenType, radioLabel, amount, targets } = transferConfig;
      
      // Build address list based on targets
      const addresses = [];
      if (targets.includes('root') && rootAddress) addresses.push(rootAddress);
      if (targets.includes('deposit') && depositAddress) addresses.push(depositAddress);
      if (targets.includes('cold') && coldAddress) addresses.push(coldAddress);
      
      if (addresses.length === 0) {
        console.log(`⚠ No addresses for ${tokenType}; skipping`);
        continue;
      }
      
      console.log(`\n📤 Sending ${tokenType} to ${addresses.length} addresses:`);
      addresses.forEach((addr, i) => {
        const label = i === 0 ? (targets.includes('root') ? 'Root' : targets[0]) : 
                      i === 1 ? (targets.includes('deposit') ? 'Deposit' : targets[1]) : 'Cold';
        console.log(`  [${i}] ${label}: ${addr}`);
      });
      
      const result = await sendWithRetries(
        ctx, 
        addresses, 
        amount, 
        tokenType, 
        radioLabel,
        transferUrl,
        2, 
        { closeAfterSend: true, waitForSuccess: true }
      );
      
      sendResults[tokenType] = result?.transferResult;
      
      if (result?.transferResult?.summary) {
        console.log(`${tokenType} send summary:`, result.transferResult.summary);
      } else {
        console.log(`⚠ No transfer summary for ${tokenType} - tokens may still be processing`);
      }
      await walletTablePage.waitForTimeout(2000);
    }
    
    await scrollWalletTableToBottom(walletTablePage);

    // Step 9: Process claims
    console.log('\n--- Step 9: Processing Claims ---');
    const amountMap = {};
    CONFIG.transfers.forEach(t => { amountMap[t.tokenType] = t.amount; });
    
    const walletsToProcess = [
      { label: 'Root', address: rootAddress, tokens: CONFIG.transfers.map(t => t.tokenType), assetWalletName: walletName },
      { label: 'Cold', address: coldAddress, tokens: CONFIG.transfers.map(t => t.tokenType), assetWalletName: walletName },
      { label: depositWalletName, address: depositAddress, tokens: CONFIG.transfers.filter(t => t.targets.includes('deposit')).map(t => t.tokenType), assetWalletName: walletName, isDeposit: true }
    ].filter(w => w.label && w.address);

    console.log(`Will process ${walletsToProcess.length} wallets for claims:`);
    walletsToProcess.forEach(w => console.log(`  - ${w.label}: ${w.tokens.join(', ')}`));

    const basePage = await focusDashboardPage(ctx, dashboardPage);
    for (const w of walletsToProcess) {
      if (!w.address) { console.log(`Skipping ${w.label} (no address)`); continue; }
      await ensureTxAndClaimWallet(basePage, ctx, w, sendResults, amountMap, transferUrl, CONFIG);
    }
    
    // Step 10: Initialize wallets
    if (CONFIG.chainId === 'TRX_TEST') {
      console.log('\n--- Step 10: Initializing Wallets (skipped for TRX_TEST) ---');
    } else {
      console.log('\n--- Step 10: Initializing Wallets ---');

      console.log('Returning to asset wallet table before initialization...');
      await returnToAssetWalletTable(basePage, walletName).catch(() => {});

      // Refresh before initialization to ensure we see latest wallet states
      await refreshAssetWalletPage(basePage);
      await basePage.waitForTimeout(2000);

      // Step 10a: Initialize Deposit wallet
      if (depositWalletInitLabel) {
        console.log(`\n📋 Step 10a: Initializing Deposit wallet (${depositWalletInitLabel})...`);
        await runInitializeSequence(basePage, { walletLabel: depositWalletInitLabel });
        await basePage.waitForTimeout(2000);
      }

      // Refresh between initializations
      await refreshAssetWalletPage(basePage);
      await basePage.waitForTimeout(2000);

      // Step 10b: Initialize Root wallet
      console.log('\n📋 Step 10b: Initializing Root wallet...');
      await runInitializeSequence(basePage, { walletLabel: 'Root' });
      await basePage.waitForTimeout(2000);

      // Step 10c: Refresh page and wait until both wallets are fully initialized
      console.log('\n📋 Step 10c: Verifying both wallets are fully initialized...');
      console.log('Refreshing page and waiting for wallet statuses to be "Initialized"...');
      
      let depositReady = !depositWalletInitLabel; // If no deposit wallet, consider it ready
      let rootReady = false;
      const maxVerificationAttempts = 20;
      const verificationInterval = 10000; // 10 seconds between checks
      
      for (let attempt = 1; attempt <= maxVerificationAttempts; attempt++) {
        console.log(`  Verification attempt ${attempt}/${maxVerificationAttempts}...`);
        
        // Refresh the page
        await refreshAssetWalletPage(basePage);
        await basePage.waitForTimeout(3000);
        
        // Scroll to ensure we can see all wallets
        await scrollWalletTableToBottom(basePage, 2, 300);
        
        // Check deposit wallet status
        if (depositWalletInitLabel && !depositReady) {
          depositReady = await walletRowHasStatus(basePage, depositWalletInitLabel, 'Initialized');
          console.log(`    Deposit wallet (${depositWalletInitLabel}): ${depositReady ? '✓ Initialized' : '⏳ Pending'}`);
        }
        
        // Check root wallet status
        if (!rootReady) {
          rootReady = await walletRowHasStatus(basePage, 'Root', 'Initialized');
          console.log(`    Root wallet: ${rootReady ? '✓ Initialized' : '⏳ Pending'}`);
        }
        
        // If both are ready, break out of the loop
        if (depositReady && rootReady) {
          console.log('\n  ✓ Both wallets are fully initialized!');
          break;
        }
        
        // Wait before next check
        if (attempt < maxVerificationAttempts) {
          console.log(`    Waiting ${verificationInterval / 1000} seconds before next check...`);
          await basePage.waitForTimeout(verificationInterval);
        }
      }

      console.log(`\nDeposit wallet initialized: ${depositReady ? '✓' : '⚠ not confirmed'}`);
      console.log(`Root wallet initialized: ${rootReady ? '✓' : '⚠ not confirmed'}`);
      
      if (!depositReady || !rootReady) {
        console.log('⚠ Warning: Not all wallets are confirmed as initialized. Proceeding with sweep anyway...');
      }
    }
    
    // Step 11: Sweep
    console.log('\n--- Step 11: Sweeping Wallets ---');
    await refreshAssetWalletPage(basePage);
    await scrollTransactionList(basePage, 'left', 6, 220);
    await handlePostInitializationSweeps(basePage, amountMap, rootAddress, CONFIG);
    
  } catch (e) {
    console.log('Step error:', e.message);
    console.error(e);
  }

  console.log('\n✓ Test completed');
});

// ==================== HELPER FUNCTIONS ====================

async function createDepositWallet(page, depositWalletName) {
  try {
    const createDepositBtn = page.locator('button:has-text("Create Deposit Wallet")').first();
    if ((await createDepositBtn.count()) > 0) {
      await createDepositBtn.click({ force: true }).catch(() => {});
      console.log('✓ Create Deposit Wallet button clicked');
      await page.waitForTimeout(1000);

      // Fill wallet name
      const walletNameInput = page.locator('input[name="walletName"][placeholder="Name"]:not([disabled])').first();
      if ((await walletNameInput.count()) > 0) {
        await walletNameInput.click({ force: true }).catch(() => {});
        await page.keyboard.type(depositWalletName, { delay: 50 });
        console.log(`✓ Wallet name typed: ${depositWalletName}`);
      } else {
        const allInputs = page.locator('input[type="text"]:visible:not([disabled])');
        const count = await allInputs.count();
        if (count > 0) {
          const firstInput = allInputs.first();
          await firstInput.click({ force: true }).catch(() => {});
          await page.keyboard.type(depositWalletName, { delay: 50 });
          console.log(`✓ Wallet name typed to first visible input: ${depositWalletName}`);
        }
      }

      await page.waitForTimeout(500);

      const nextBtn = page.locator('button:has-text("Next")').first();
      if ((await nextBtn.count()) > 0) {
        await nextBtn.click({ force: true }).catch(() => {});
        console.log('✓ Next button clicked');
        await page.waitForTimeout(2000);
      }

      try {
        await page.waitForSelector('input[type="text"][inputmode="numeric"]', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await fillOtpInContext(page, page.locator('body'));
        console.log('✓ OTP filled for deposit wallet');
        await page.waitForTimeout(1000);
      } catch (e) {
        console.log('⚠ Error filling OTP:', e.message);
      }

      const createBtn = page.locator('button:has-text("Create")').first();
      await createBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if ((await createBtn.count()) > 0) {
        await createBtn.click({ force: true }).catch(() => {});
        console.log('✓ Create button clicked for deposit wallet');
        await page.waitForTimeout(2000);
      }
    } else {
      console.log('⚠ Create Deposit Wallet button not found');
    }
  } catch (e) {
    console.log('Error creating deposit wallet:', e.message);
  }
}

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

async function waitForCreateAssetModal(page) {
  const candidates = ['[role="dialog"]', '.modal', '[class*="modal"]', '[class*="dialog"]', '.chakra-modal'];
  for (const sel of candidates) {
    if ((await page.locator(sel).count().catch(() => 0)) > 0) { return page; }
  }
  const texts = ['text=Create Asset Wallet', 'text=Create Asset', 'text=Create Wallet'];
  for (const t of texts) if ((await page.locator(t).count().catch(() => 0)) > 0) { return page; }
  const frames = page.frames();
  for (const f of frames) {
    try {
      for (const sel of candidates) if ((await f.locator(sel).count().catch(() => 0)) > 0) { return f; }
      for (const t of texts) if ((await f.locator(t).count().catch(() => 0)) > 0) { return f; }
    } catch (e) {}
  }
  return page;
}

async function handleCreateAssetModal(ctx, selection) {
  const modalCtx = ctx;
  let walletName = generateRandomWalletName();
  const modal = modalCtx.locator('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]').first();
  try { await modal.waitFor({ state: 'visible', timeout: 3000 }); } catch (e) {}

  const assetName = typeof selection === 'object' && selection ? selection.assetName : null;
  const chainTextRaw = typeof selection === 'string' ? selection : (selection?.chainText ?? '');
  const chainText = (chainTextRaw || '').trim();

  console.log(`Step 1: Selecting asset${assetName ? ` (${assetName})` : ''} for chain: ${chainText}...`);
  try {
    const opener = modal.locator('[role="combobox"], button[aria-haspopup="listbox"], .select, div[role="button"]').first();
    if ((await opener.count()) > 0) { await opener.click().catch(() => {}); await modalCtx.waitForTimeout(300); }

    // Preferred: click the chain subtext element inside the option.
    // Example DOM (user-provided):
    // <div class="truncate text-xs ...">OngKawKaw (MATIC_TEST_AMOY)</div>
    const optionCandidates = modalCtx.locator('[role="option"]');
    const chainSubtext = modalCtx.locator('div.truncate.text-xs', { hasText: chainText });
    let optionByChain = optionCandidates.filter({ has: chainSubtext });
    if (assetName) {
      optionByChain = optionByChain.filter({ has: modalCtx.locator('div', { hasText: assetName }) });
    }

    if ((await optionByChain.count().catch(() => 0)) > 0) {
      const opt = optionByChain.first();
      const text = await opt.textContent().catch(() => '');
      console.log(`  Found matching option: ${text.substring(0, 120)}`);
      await opt.scrollIntoViewIfNeeded().catch(() => {});
      await opt.click().catch(() => opt.click({ force: true }));
      console.log(`✓ Selected asset for chain: ${chainText}`);
    } else {
      // Fallback: scan option textContent and require both asset name and chain text.
      const count = await optionCandidates.count();
      let found = false;
      for (let i = 0; i < count; i++) {
        const opt = optionCandidates.nth(i);
        const text = await opt.textContent().catch(() => '');
        const textLower = text.toLowerCase();
        if (!chainText || !textLower.includes(chainText.toLowerCase())) continue;
        if (assetName && !textLower.includes(assetName.toLowerCase())) continue;
        console.log(`  Found matching option (fallback): ${text.substring(0, 120)}`);
        await opt.scrollIntoViewIfNeeded().catch(() => {});
        await opt.click().catch(() => opt.click({ force: true }));
        console.log(`✓ Selected asset for chain: ${chainText}`);
        found = true;
        break;
      }
      if (!found) {
        console.log(`⚠ No option found for chain="${chainText}"${assetName ? ` and asset="${assetName}"` : ''}`);
      }
    }
  } catch (e) { console.log('Select asset failed:', e.message); }

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
  try { const cb = modal.locator('input[type="checkbox"]').first(); if ((await cb.count()) > 0) await cb.check().catch(() => cb.click().catch(() => {})); } catch (e) {}

  console.log('Step 4: Clicking Next...');
  try { const next = modal.locator('button:has-text("Next"), button:has-text("Continue")').first(); if ((await next.count()) > 0) await next.click().catch(() => next.click({ force: true })); await modalCtx.waitForTimeout(500); } catch (e) {}

  console.log('Step 5: Auto-filling OTP...');
  try { await fillOtpInContext(modalCtx, modal); } catch (e) {}

  console.log('Step 6: Clicking Create...');
  try {
    const create = modal.locator('button:has-text("Create"), button:has-text("Create Asset"), button:has-text("Confirm")').first();
    if ((await create.count()) > 0) {
      try { await Promise.race([ create.click(), new Promise(r => setTimeout(() => r('timeout'), 5000)) ]); console.log('✓ Create clicked'); }
      catch (e) { try { await Promise.race([ create.click({ force: true }), new Promise(r => setTimeout(() => r('timeout'), 5000)) ]); } catch (e2) {} }
    }
  } catch (e) {}

  return walletName;
}

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

function generateRandomWalletName() {
  const randomNum = Math.floor(Math.random() * 9000) + 1000;
  return `test${randomNum}`;
}

// Transfer functions
async function sendWithRetries(context, recipientAddresses, amount, tokenType, radioLabel, transferUrl, maxAttempts = 2, options = {}) {
  let remaining = [...recipientAddresses];
  let attempt = 1;
  let lastResult = null;

  while (attempt <= maxAttempts && remaining.length > 0) {
    console.log(`Attempt ${attempt}/${maxAttempts} for ${tokenType} to ${remaining.length} recipient(s)...`);
    lastResult = await openTransferUiAndSendMultiple(context, remaining, amount, tokenType, radioLabel, transferUrl, options);

    const transferResult = lastResult?.transferResult;
    const summary = transferResult?.summary;
    const results = transferResult?.results;

    if (summary) {
      console.log(`  Summary: total=${summary.total}, success=${summary.successCount}, failed=${summary.failureCount}`);
      if (summary.failureCount === 0) break;
      if (Array.isArray(results)) {
        remaining = results.filter(r => r && r.success === false && r.recipient).map(r => r.recipient);
      } else {
        remaining = [];
      }
    } else {
      console.log('  ⚠ No transfer summary parsed; assuming submission and stopping retries');
      remaining = [];
    }

    attempt += 1;
    if (remaining.length > 0) {
      console.log(`  Retrying failed recipients (${remaining.length})...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return lastResult;
}

async function openTransferUiAndSendMultiple(context, recipientAddresses, amount, tokenType, radioLabel, transferUrl, options = {}) {
  const { closeAfterSend = true, waitForSuccess = true } = options;
  try {
    const responses = [];
    const reqs = [];
    const page = await context.newPage().catch(async () => {
      const pages = context.pages();
      return pages.length > 0 ? pages[0] : context.newPage();
    });

    page.on('response', async resp => {
      try {
        const entry = { url: resp.url(), status: resp.status() };
        if (resp.url().includes('/api/')) {
          try {
            const text = await resp.text();
            entry.responseBody = text.slice(0, 2000);
          } catch (_) {}
        }
        responses.push(entry);
      } catch (_) {}
    });
    
    page.on('request', req => {
      try {
        const url = req.url();
        if (!url.includes('/api/')) return;
        const method = req.method();
        const postData = req.postData();
        const headers = req.headers();
        reqs.push({ 
          url, 
          method,
          requestBody: postData ? postData.slice(0, 1000) : '',
          contentType: headers['content-type'] || ''
        });
        if (method === 'POST') {
          console.log(`  🌐 POST request firing to ${url}`);
        }
      } catch (_) {}
    });

    await page.goto(transferUrl, { waitUntil: 'load', timeout: 60000 }).catch(async () => {
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    });

    console.log(`Opening transfer UI at ${transferUrl} for ${recipientAddresses.length} recipient(s)`);
    await page.waitForTimeout(1000);

    // Select token type using radioLabel - improved selection logic
    console.log(`Selecting ${tokenType} (${radioLabel})...`);
    let radioSelected = false;
    try {
      // Method 1: Find label containing exact text and click it
      const allLabels = page.locator('label');
      const labelCount = await allLabels.count();
      for (let i = 0; i < labelCount && !radioSelected; i++) {
        const label = allLabels.nth(i);
        const labelText = await label.textContent().catch(() => '');
        if (labelText.includes(radioLabel)) {
          await label.click({ force: true }).catch(() => {});
          console.log(`✓ ${radioLabel} selected via label match: "${labelText.trim()}"`);
          radioSelected = true;
          await page.waitForTimeout(500);
        }
      }

      // Method 2: Try input[type="radio"] with value or id containing keyword
      if (!radioSelected) {
        const radios = page.locator('input[type="radio"]');
        const radioCount = await radios.count();
        for (let i = 0; i < radioCount && !radioSelected; i++) {
          const radio = radios.nth(i);
          const radioId = await radio.getAttribute('id').catch(() => '') || '';
          const radioValue = await radio.getAttribute('value').catch(() => '') || '';
          const radioName = await radio.getAttribute('name').catch(() => '') || '';
          
          // Check if ID, value or name contains part of our radioLabel
          const searchTerm = radioLabel.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (radioId.toLowerCase().includes(searchTerm) || 
              radioValue.toLowerCase().includes(searchTerm) ||
              radioLabel.toLowerCase().includes(radioValue.toLowerCase())) {
            await radio.click({ force: true }).catch(() => {});
            console.log(`✓ ${radioLabel} selected via radio input (id: ${radioId}, value: ${radioValue})`);
            radioSelected = true;
            await page.waitForTimeout(500);
          }
        }
      }

      // Method 3: Click by partial text in parent container
      if (!radioSelected) {
        const container = page.locator(`text=${radioLabel}`).first();
        if ((await container.count()) > 0) {
          await container.click({ force: true }).catch(() => {});
          console.log(`✓ ${radioLabel} selected via text locator`);
          radioSelected = true;
          await page.waitForTimeout(500);
        }
      }

      if (!radioSelected) {
        console.log(`⚠ Could not find radio for "${radioLabel}", continuing with default selection`);
      }
    } catch (e) {
      console.log(`Error selecting ${tokenType} radio:`, e.message);
    }

    // Build the content with all addresses in format: one per line, "address,amount"
    const lines = recipientAddresses.map(addr => `${addr},${amount}`).join('\n');
    console.log(`📝 Prepared ${recipientAddresses.length} recipient lines:`);
    console.log(JSON.stringify(lines));

    // Find textarea and fill - extended selectors
    let input = null;
    const textarea = page.locator('textarea');
    if ((await textarea.count()) > 0) { input = textarea.first(); }
    else {
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
      const ce = page.locator('[contenteditable="true"]').first();
      if ((await ce.count()) > 0) input = ce;
    }

    if (!input) {
      console.log('Could not find input area on transfer page');
      await page.screenshot({ path: 'transfer-page-missing-input.png', fullPage: true }).catch(() => {});
      await page.close();
      return null;
    }

    try {
      const tagName = await input.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
      if (tagName === 'input' || tagName === 'textarea') {
        await input.fill(lines + '\n');
      } else {
        await input.evaluate((el, val) => { el.innerText = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, lines + '\n');
      }
      console.log(`Pasted ${recipientAddresses.length} recipient address(es) to transfer UI`);
    } catch (e) {
      console.log('Failed to fill transfer input:', e.message);
    }

    // Wait briefly after pasting before sending
    await page.waitForTimeout(2500);

    // Click Send button
    const sendBtn = page.locator('button:has-text("Send Tokens")').first();
    if ((await sendBtn.count()) === 0) {
      const alt = page.locator('button').filter({ hasText: /Send|Send Token|Send Tokens/i }).first();
      if ((await alt.count()) > 0) {
        await alt.click().catch(() => alt.click({ force: true }));
      } else {
        console.log('Send button not found on transfer UI');
        await page.close();
        return null;
      }
    } else {
      await sendBtn.click().catch(() => sendBtn.click({ force: true }));
    }

    // Immediate check after clicking send
    await page.waitForTimeout(500);
    const immediateContent = await page.locator('body').innerText().catch(() => '');
    console.log('Page content right after Send click (first 500 chars):', immediateContent.substring(0, 500));

    console.log('Clicked Send Tokens, waiting for confirmation...');

    // Wait explicitly for POST request to transfer API
    try {
      const postReq = await page.waitForRequest(req => req.url().includes('/api/') && req.method() === 'POST', { timeout: 15000 });
      const postData = postReq.postData() || '';
      console.log(`  🌐 Detected POST to ${postReq.url()} with payload (first 300 chars):`, postData.substring(0, 300));
      
      // Also wait for the POST response
      try {
        const postResp = await page.waitForResponse(res => res.url().includes('/api/') && res.request().method() === 'POST', { timeout: 15000 });
        const bodyText = await postResp.text();
        console.log('  ✅ POST response (first 500 chars):', bodyText.substring(0, 500));
        try {
          const json = JSON.parse(bodyText);
          if (json && json.summary) {
            console.log(`  Summary: total=${json.summary.total}, success=${json.summary.successCount}, failed=${json.summary.failureCount}`);
          }
        } catch (_) {}
      } catch (eresp) {
        console.log('  ⚠ POST response not seen within 15s (may still be processing)');
      }
    } catch (e) {
      console.log('  ⚠ Did not detect POST request within 15s');
    }
    
    // Additional wait and check for POST in collected requests
    const beforeReqCount = reqs.length;
    let postDetected = false;
    
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      
      const pageContent = await page.locator('body').innerText().catch(() => '');
      
      // Check for submission indicators
      if (pageContent.includes('Sending transactions') || pageContent.includes('🚀') || pageContent.includes('✅ Sent')) {
        if (!postDetected) {
          console.log('  ✓ Transaction submission UI indicator detected');
        }
      }
      
      const currentReqCount = reqs.length;
      const newReqs = currentReqCount - beforeReqCount;
      if (newReqs > 0) {
        const latestReqs = reqs.slice(-newReqs);
        const hasPost = latestReqs.some(r => r.method === 'POST');
        if (hasPost) {
          const postReq = latestReqs.find(r => r.method === 'POST');
          console.log(`  ✓ POST request sent to ${postReq.url}`);
          postDetected = true;
          await page.waitForTimeout(2000);
          break;
        }
      }
    }
    
    if (!postDetected) {
      console.log('  ⚠ No POST request detected after 10 seconds');
    }

    // Log recent network activity
    try {
      const tail = responses.slice(-10);
      console.log('Recent network responses after send:', tail.map(r => ({ url: r.url, status: r.status })));
    } catch (_) {}

    await page.screenshot({ path: `transfer-after-send-${tokenType.replace(/\s+/g, '-')}.png`, fullPage: true }).catch(() => {});
    const pageText = await page.locator('body').innerText().catch(() => '');
    console.log('Transfer UI page text (first 800 chars):', pageText.substring(0, 800));

    let transferResult = extractTransferResult(responses, tokenType);
    if (waitForSuccess) {
      transferResult = await waitForSuccessSummary(page, responses, recipientAddresses.length, tokenType, transferResult);
    }
    if (transferResult?.summary) {
      console.log(`Parsed transfer summary for ${tokenType}: total=${transferResult.summary.total}, success=${transferResult.summary.successCount}, failed=${transferResult.summary.failureCount}`);
    } else {
      console.log(`No parseable transfer summary found for ${tokenType}`);
    }

    const result = { responses, requests: reqs, transferResult };
    if (closeAfterSend && page && (!page.isClosed || !page.isClosed())) {
      await page.waitForTimeout(2000).catch(() => {});
      await page.close().catch(() => {});
    }
    return result;
  } catch (e) {
    console.log('Error in openTransferUiAndSendMultiple:', e.message);
    return null;
  }
}

function extractTransferResult(responses, tokenType) {
  if (!Array.isArray(responses)) return null;
  for (let i = responses.length - 1; i >= 0; i--) {
    const r = responses[i];
    if (!r || typeof r.responseBody !== 'string') continue;
    try {
      const json = JSON.parse(r.responseBody);
      if (json && typeof json === 'object') {
        if (json.summary && typeof json.summary === 'object') {
          return { summary: json.summary, results: json.results || json.transactions || [] };
        }
        if (json.success !== undefined && json.results && Array.isArray(json.results)) {
          const successCount = json.results.filter(x => x && x.success).length;
          const failureCount = json.results.filter(x => x && x.success === false).length;
          return { summary: { total: json.results.length, successCount, failureCount }, results: json.results };
        }
      }
    } catch (_) {}
  }
  return null;
}

async function waitForSuccessSummary(page, responses, expectedCount, tokenType, initial) {
  const start = Date.now();
  let current = initial || extractTransferResult(responses, tokenType);
  while (Date.now() - start < 60000) {
    if (current?.summary && current.summary.successCount === expectedCount) return current;
    try {
      const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      const sentMatches = (bodyText.match(/✅ Sent/g) || []).length;
      if (sentMatches >= expectedCount) {
        return current || { summary: { total: expectedCount, successCount: expectedCount, failureCount: 0 }, results: [] };
      }
    } catch (_) {}
    current = extractTransferResult(responses, tokenType) || current;
    await page.waitForTimeout(2000).catch(() => {});
  }
  return current;
}

// Wallet utility functions
// Wallet types to exclude when extracting addresses (these are system/internal wallets)
const EXCLUDED_WALLET_TYPES = ['gas station', 'gas-station', 'gasstation'];

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
        
        // Skip excluded wallet types (like Gas Station)
        const isExcluded = EXCLUDED_WALLET_TYPES.some(excluded => rowFullText.includes(excluded));
        if (isExcluded) {
          console.log(`  ⊘ Skipping excluded wallet type in row: ${rowFullText.substring(0, 50)}...`);
          continue;
        }

        // If looking for Root, skip rows containing Cold or Deposit
        // If looking for Cold, skip rows containing Root or Deposit
        // If looking for Deposit, skip rows containing Root or Cold (but match deposit-named wallets)
        const isRoot = tl === 'root';
        const isCold = tl === 'cold';
        const isDeposit = tl.includes('deposit');
        
        if (isRoot && (rowFullText.includes('cold') || rowFullText.includes('deposit'))) continue;
        if (isCold && (rowFullText.includes('root') || rowFullText.includes('deposit'))) continue;
        // For deposit wallets - match by exact name or "deposit" label, but not root/cold
        if (isDeposit && !isRoot && !isCold) {
          if (rowFullText.includes('root') || rowFullText.includes('cold')) continue;
        }
        
        if (rowFullText.includes(tl)) {
          targetRow = r;
          console.log(`✓ Found row with label "${targetLabel}" at index ${i}`);
          break;
        }
      }
      // Do NOT fall back to first row if targetLabel was provided - return null instead
      if (!targetRow) {
        console.log(`⚠ No row found containing label "${targetLabel}"`);
        return null;
      }
    } else {
      // No target label - find first non-excluded row
      for (let i = 0; i < rowCount; i++) {
        const r = allRows.nth(i);
        const rowFullText = (await r.textContent().catch(() => '')).toLowerCase();
        const isExcluded = EXCLUDED_WALLET_TYPES.some(excluded => rowFullText.includes(excluded));
        if (!isExcluded) {
          targetRow = r;
          break;
        }
      }
    }

    if (!targetRow) {
      console.log('⚠ No valid wallet row found (all rows are excluded types)');
      return null;
    }

    // Extract address from row text directly via regex - most reliable
    const rowText = await targetRow.textContent().catch(() => '');
    // Try ETH-style address first
    let match = rowText && rowText.match(/0x[a-fA-F0-9]{40}/);
    if (match) {
      const normalized = match[0].trim();
      console.log('✓ Address extracted from row text:', normalized);
      return normalized;
    }
    // Try TRX-style address (T...)
    match = rowText && rowText.match(/T[a-zA-Z0-9]{33}/);
    if (match) {
      const normalized = match[0].trim();
      console.log('✓ Address extracted from row text:', normalized);
      return normalized;
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
      if (clip) {
        let clipMatch = clip.match(/0x[a-fA-F0-9]{40}/);
        if (clipMatch) { 
          console.log('Address read from clipboard'); 
          return clipMatch[0]; 
        }
        clipMatch = clip.match(/T[a-zA-Z0-9]{33}/);
        if (clipMatch) { 
          console.log('Address read from clipboard'); 
          return clipMatch[0]; 
        }
      }
    } catch (e) {}
    
    console.log('Could not extract wallet address');
    return null;
  } catch (e) { console.log('selectAndCopyWalletAddress error:', e.message); return null; }
}

async function waitForWalletRowByName(page, walletName, timeoutMs = 60000) {
  if (!walletName) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = page.locator('table tbody tr, [role="row"]', { hasText: walletName });
    if ((await candidate.count()) > 0) {
      return true;
    }
    await scrollWalletTableToBottom(page, 2, 300);
    await page.waitForTimeout(500);
  }
  return false;
}

async function scrollWalletTableToBottom(page, iterations = 5, delayMs = 300) {
  for (let i = 0; i < iterations; i++) {
    await page.evaluate(() => {
      const container = document.scrollingElement || document.documentElement;
      if (container) container.scrollTop = container.scrollHeight;
      document.querySelectorAll('table, [role="table"]').forEach(tbl => {
        tbl.scrollTop = tbl.scrollHeight;
        if (tbl.parentElement) tbl.parentElement.scrollTop = tbl.parentElement.scrollHeight;
      });
    }).catch(() => {});
    await page.waitForTimeout(delayMs);
  }
}

async function scrollTransactionList(page, direction = 'right', iterations = 3, delayMs = 250) {
  const delta = direction === 'left' ? -160 : 160;
  for (let i = 0; i < iterations; i++) {
    await page.evaluate(d => {
      const doc = document.scrollingElement || document.documentElement;
      if (doc) doc.scrollLeft = Math.max(0, doc.scrollLeft + d);
      document.querySelectorAll('table, [role="table"]').forEach(tbl => {
        const docEl = tbl.parentElement || tbl;
        docEl.scrollLeft = Math.max(0, docEl.scrollLeft + d);
      });
    }, delta).catch(() => {});
    await page.waitForTimeout(delayMs);
  }
}

async function clickRefreshIcon(page) {
  const refreshIcon = page.locator('span.iconify[class*="arrow-path"]').first();
  if ((await refreshIcon.count()) === 0) { return false; }
  try {
    await refreshIcon.scrollIntoViewIfNeeded().catch(() => {});
    await refreshIcon.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);
    return true;
  } catch (e) {
    return false;
  }
}

async function refreshAssetWalletPage(page) {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {}
  await page.waitForTimeout(1200);
}

async function focusDashboardPage(context, preferredPage) {
  const pages = context.pages();
  for (const p of pages) {
    try {
      if (!p || (p.isClosed && p.isClosed())) continue;
      const hasTable = await p.locator('table, [role="table"]').first().count().catch(() => 0);
      if (hasTable > 0) {
        await p.bringToFront().catch(() => {});
        return p;
      }
    } catch (_) {}
  }
  if (preferredPage && (!preferredPage.isClosed || !preferredPage.isClosed())) {
    await preferredPage.bringToFront().catch(() => {});
    return preferredPage;
  }
  return preferredPage;
}

async function findVisibleOverlay(page) {
  const overlaySelectors = ['[role="dialog"]', '[aria-modal="true"]', '.modal', '.chakra-modal'];
  for (const sel of overlaySelectors) {
    const overlay = page.locator(sel).filter({ has: page.locator(':visible') });
    if ((await overlay.count()) > 0) return overlay.first();
  }
  return page.locator('body');
}

async function clickOverlayButton(page, label, options = {}) {
  const { waitMs = 900 } = options;
  const overlay = await findVisibleOverlay(page);
  const btn = overlay.locator(`button:has-text("${label}")`).first();
  if ((await btn.count()) === 0) { return false; }
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ force: true });
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  return true;
}

async function waitForOtpInputs(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const otpInputs = page.locator('input[name="otp"], input[data-otp], .otp input, input[type="text"][inputmode="numeric"], input[type="tel"], input[class*="otp"]');
    if ((await otpInputs.count()) > 0) { return true; }
    await page.waitForTimeout(500);
  }
  return false;
}

async function openWalletByLabel(context, preferredPage, label, address) {
  const targetLabel = label?.toLowerCase?.() || '';
  const targetAddress = address?.toLowerCase?.() || '';
  const pages = [preferredPage, ...context.pages().filter(p => p !== preferredPage)];
  for (const p of pages) {
    try {
      if (!p || (p.isClosed && p.isClosed())) continue;
      const rows = p.locator('table tbody tr, [role="table"] [role="row"]');
      const count = await rows.count();
      if (count === 0) continue;
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const txt = (await row.textContent().catch(() => '')).toLowerCase();
        const matchesLabel = targetLabel && txt.includes(targetLabel);
        const matchesAddress = targetAddress && txt.includes(targetAddress);
        if (matchesLabel || matchesAddress) {
          await row.click().catch(() => row.click({ force: true }));
          await p.waitForTimeout(1500);
          return { page: p, success: true };
        }
      }
    } catch (e) {}
  }
  return { page: preferredPage, success: false };
}

async function returnToAssetWalletTable(page, walletName) {
  if (!walletName || !page) return;
  try {
    if (page.isClosed && page.isClosed()) return;
    const selector = page.locator('span.block.truncate').filter({ hasText: walletName });
    if ((await selector.count()) === 0) return;
    await selector.first().scrollIntoViewIfNeeded().catch(() => {});
    await selector.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
  } catch (e) {}
}

// Navigate to and click on a specific wallet row by label
async function navigateToWalletRow(page, walletLabel) {
  if (!walletLabel) return false;
  const label = walletLabel.trim().toLowerCase();
  console.log(`  📍 Navigating to wallet: ${walletLabel}...`);
  
  try {
    // Scroll up first to ensure we see all rows
    await page.evaluate(() => {
      const container = document.scrollingElement || document.documentElement;
      if (container) container.scrollTop = 0;
    }).catch(() => {});
    await page.waitForTimeout(500);
    
    const allRows = page.locator('table tbody tr, [role="table"] [role="row"]');
    const tryFindAndClick = async () => {
      const rowCount = await allRows.count();
      for (let i = 0; i < rowCount; i++) {
        const row = allRows.nth(i);
        const rowText = (await row.textContent().catch(() => '')).toLowerCase();
        if (rowText.includes('gas station')) continue;
        if (rowText.includes(label)) {
          console.log(`  ✓ Found wallet row for: ${walletLabel}`);
          await row.scrollIntoViewIfNeeded().catch(() => {});
          await row.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1500);
          return true;
        }
      }
      return false;
    };

    if (await tryFindAndClick()) return true;

    // Scroll down in case the row is below the fold / virtualized
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => {
        const container = document.scrollingElement || document.documentElement;
        if (container) container.scrollTop = container.scrollTop + window.innerHeight * 0.8;
        document.querySelectorAll('table, [role="table"]').forEach(tbl => {
          const parent = tbl.parentElement || tbl;
          parent.scrollTop = parent.scrollTop + Math.max(200, parent.clientHeight * 0.6);
        });
      }).catch(() => {});
      await page.waitForTimeout(400);
      if (await tryFindAndClick()) return true;
    }

    console.log(`  ⚠ Could not find wallet row for: ${walletLabel}`);
    return false;
  } catch (e) {
    console.log(`  ⚠ Error navigating to wallet: ${e.message}`);
    return false;
  }
}

// Initialize sequence
async function runInitializeSequence(page, options = {}) {
  const filterLabel = options?.walletLabel ? options.walletLabel.trim().toLowerCase() : null;
  console.log(`  🔧 Running initialize sequence${filterLabel ? ` for wallet: ${filterLabel}` : ''}...`);
  
  // Do not navigate into wallet details; stay on asset wallet table
  if (filterLabel) {
    console.log(`  📍 Looking for Initialize button on asset wallet table for: ${options.walletLabel}`);
  }
  
  const findButtonNearStatus = async (statusText, label) => {
    const statuses = page.locator(`text=${statusText}`);
    const count = await statuses.count();
    for (let i = 0; i < count; i++) {
      const status = statuses.nth(i);
      const row = status.locator('xpath=ancestor::tr');
      if ((await row.count()) > 0) {
        const rowText = (await row.textContent().catch(() => '')).toLowerCase();
        if (filterLabel && !rowText.includes(filterLabel)) continue;
        const btn = row.locator(`button:has-text("${label}")`).first();
        if ((await btn.count()) > 0) return btn;
      }
    }
    return null;
  };

  const findInitializeButtonForLabel = async () => {
    if (!filterLabel) return null;
    const rows = page.locator('table tbody tr, [role="row"]');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const rowText = (await row.textContent().catch(() => '')).toLowerCase();
      if (!rowText.includes(filterLabel)) continue;
      const btn = row.locator('button:has-text("Initialize")').first();
      if ((await btn.count()) > 0) return btn;
    }
    return null;
  };

  const findButtonInOverlay = async (label) => {
    const overlaySelectors = ['[role="dialog"]', '[aria-modal="true"]', '.modal', '.chakra-modal'];
    for (const sel of overlaySelectors) {
      const dialogBtn = page.locator(`${sel} button:has-text("${label}")`).filter({ has: page.locator(':visible') });
      if ((await dialogBtn.count()) > 0) return dialogBtn.first();
    }
    return page.locator(`button:has-text("${label}")`).filter({ has: page.locator(':visible') }).first();
  };

  const clickButtonStep = async (label, options = {}) => {
    const { waitForDisappear = true, allowBackground = false, handle } = options;
    const btn = handle ?? await findButtonInOverlay(label);
    if ((await btn.count()) === 0) { 
      console.log(`    ⚠ Button "${label}" not found`);
      return false; 
    }
    try {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.waitFor({ state: 'visible', timeout: 10000 });
      await btn.click({ force: true });
      console.log(`    ✓ Clicked "${label}"`);
      if (waitForDisappear && !allowBackground) {
        await btn.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
      }
      await page.waitForTimeout(800);
      return true;
    } catch (e) {
      console.log(`    ⚠ Failed to click "${label}": ${e.message}`);
      return false;
    }
  };

  const clickDialogButton = async (label, options = {}) => {
    const { waitForDisappear = true } = options;
    const overlay = await findVisibleOverlay(page);
    const btn = overlay.locator(`button:has-text("${label}")`).first();
    if ((await btn.count()) === 0) { 
      console.log(`    ⚠ Dialog button "${label}" not found`);
      return false; 
    }
    try {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.waitFor({ state: 'visible', timeout: 10000 });
      await btn.click({ force: true });
      console.log(`    ✓ Clicked dialog "${label}"`);
      if (waitForDisappear) {
        await overlay.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      }
      await page.waitForTimeout(800);
      return true;
    } catch (e) {
      console.log(`    ⚠ Failed to click dialog "${label}": ${e.message}`);
      return false;
    }
  };

  const findInitButtonWithScroll = async () => {
    let btn = await findButtonNearStatus('Pending initialization', 'Initialize');
    if (!btn) btn = await findInitializeButtonForLabel();
    if (btn) return btn;

    for (let i = 0; i < 5; i++) {
      await scrollWalletTableToBottom(page, 1, 250);
      btn = await findButtonNearStatus('Pending initialization', 'Initialize');
      if (!btn) btn = await findInitializeButtonForLabel();
      if (btn) return btn;
    }
    return null;
  };

  // Step 1: Find and click the Initialize button on the wallet row
  const pendingInitBtn = await findInitButtonWithScroll();
  if (pendingInitBtn) {
    console.log('  Found "Pending initialization" status with Initialize button');
  }
  
  const initialClicked = pendingInitBtn
    ? await clickButtonStep('Initialize', { handle: pendingInitBtn })
    : await clickButtonStep('Initialize');

  if (initialClicked) {
    console.log('  Initialize dialog opened, proceeding...');
    
    // Step 2: Click Estimate Gas Fee button
    if (await clickButtonStep('Estimate Gas Fee')) {
      // Step 3: Wait for 3 seconds
      console.log('    ⏳ Waiting 3 seconds for gas estimation...');
      await page.waitForTimeout(3000);
      
      // Step 4: Click Initialize button again (to proceed after gas estimation)
      console.log('    Clicking Initialize button after gas estimation...');
      await clickButtonStep('Initialize', { waitForDisappear: false });
      await page.waitForTimeout(1000);
      
      // Step 5: Wait for and fill 2FA OTP
      console.log('    Waiting for 2FA input...');
      const otpFound = await waitForOtpInputs(page);
      console.log(`    OTP inputs: ${otpFound ? '✓ found' : '⚠ not found'}`);
      
      // Try to find the OTP container in the dialog
      const overlay = await findVisibleOverlay(page);
      await fillOtpInContext(page, overlay);
      console.log('    ✓ 2FA OTP filled with dummy number (123456)');
      await page.waitForTimeout(1500);
      
      // Step 6: Click the final Initialize button to complete the process
      console.log('    Clicking final Initialize button...');
      let finalClicked = false;
      
      // Try multiple times to click the final Initialize button
      for (let attempt = 0; attempt < 5; attempt++) {
        // First try to find Initialize button in the visible overlay/dialog
        const currentOverlay = await findVisibleOverlay(page);
        const initBtn = currentOverlay.locator('button:has-text("Initialize")').first();
        
        if ((await initBtn.count()) > 0) {
          try {
            await initBtn.scrollIntoViewIfNeeded().catch(() => {});
            await initBtn.waitFor({ state: 'visible', timeout: 5000 });
            await initBtn.click({ force: true });
            console.log(`    ✓ Final Initialize button clicked (attempt ${attempt + 1})`);
            finalClicked = true;
            break;
          } catch (e) {
            console.log(`    ⚠ Attempt ${attempt + 1} failed: ${e.message}`);
          }
        }
        
        await page.waitForTimeout(1000);
      }
      
      // Fallback: try clicking any visible Initialize button
      if (!finalClicked) {
        console.log('    Trying fallback method for Initialize button...');
        const anyInitBtn = page.locator('button:has-text("Initialize"):visible').first();
        if ((await anyInitBtn.count()) > 0) {
          try {
            await anyInitBtn.click({ force: true });
            console.log('    ✓ Final Initialize button clicked (fallback)');
            finalClicked = true;
          } catch (e) {
            console.log(`    ⚠ Fallback click failed: ${e.message}`);
          }
        }
      }
      
      if (finalClicked) {
        // Wait for the dialog to close
        await page.waitForTimeout(2000);
        console.log('  ✓ Initialize sequence completed successfully');
      } else {
        console.log('  ⚠ Could not click final Initialize button');
      }
    }
  } else {
    console.log('  ⚠ No Initialize button found (wallet may already be initialized)');
  }
}

async function walletRowHasStatus(page, walletLabel, statusText) {
  if (!walletLabel || !statusText) return false;
  const label = walletLabel.trim().toLowerCase();
  const status = statusText.trim().toLowerCase();
  const rows = page.locator('table tbody tr, [role="row"]');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const rowText = (await row.textContent().catch(() => '')).toLowerCase();
    if (!rowText.includes(label)) continue;
    if (rowText.includes(status)) return true;
  }
  return false;
}

async function waitForWalletStatus(page, walletLabel, statusText, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180000;
  const refreshWaitMs = options.refreshWaitMs ?? 6000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await refreshAssetWalletPage(page);
    await page.waitForTimeout(1500);

    if (await walletRowHasStatus(page, walletLabel, statusText)) return true;

    await scrollWalletTableToBottom(page, 2, 300);
    if (await walletRowHasStatus(page, walletLabel, statusText)) return true;

    await page.waitForTimeout(refreshWaitMs);
  }

  return false;
}

// Claim functions
async function waitForTransactionIndicators(page, timeoutMs = 120000) {
  const refreshIcon = page.locator('span.iconify[class*="arrow-path"]');
  const ellipsisSpans = page.locator('span.iconify[class*="ellipsis-vertical"]');
  const ellipsisButtons = page.locator('button:has(span.iconify[class*="ellipsis-vertical"])');
  const pendingBadge = page.locator('span[value="pending_aml_screening"], span:has-text("pending aml screening")');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const spanCount = await ellipsisSpans.count();
    const buttonCount = await ellipsisButtons.count();
    const pendingVisible = await pendingBadge.isVisible().catch(() => false);
    if (spanCount > 0 || buttonCount > 0 || pendingVisible) return true;

    if ((await refreshIcon.count()) > 0) {
      await refreshIcon.first().click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function findPendingEllipsisButton(page) {
  const rows = page.locator('table tbody tr, [role="row"]');
  const pendingPattern = 'span[value="pending_aml_screening"], span:has-text("pending aml screening")';
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if ((await row.locator(pendingPattern).count()) === 0) continue;
    const button = row.locator('button:has(span.iconify[class*="ellipsis-vertical"])').first();
    if ((await button.count()) > 0) return button;
  }
  return null;
}

async function claimPendingTransactions(page, expectedCount = 0, maxClaims = 3) {
  console.log(`  📋 Starting claim process. Expected: ${expectedCount}, Max: ${maxClaims}`);
  const pendingBadge = page.locator('span[value="pending_aml_screening"], span:has-text("pending aml screening")');
  const requiredClaims = expectedCount > 0 ? expectedCount : maxClaims;
  const overallTimeoutMs = Math.max(requiredClaims * 90000, 180000);
  const overallDeadline = Date.now() + overallTimeoutMs;
  let claimedCount = 0;

  while (claimedCount < requiredClaims && Date.now() < overallDeadline) {
    console.log(`  Claim attempt ${claimedCount + 1}/${requiredClaims}...`);
    await scrollTransactionList(page, 'right', 3, 200);
    const ellipsisButton = await findPendingEllipsisButton(page);
    if (!ellipsisButton) {
      console.log('  ⚠ No pending transaction found, refreshing...');
      await clickRefreshIcon(page);
      await page.waitForTimeout(5000);
      continue;
    }

    await ellipsisButton.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await ellipsisButton.click({ force: true });
      console.log('  ✓ Clicked ellipsis button');
    } catch (e) {
      console.log('  ⚠ Failed to click ellipsis:', e.message);
      await page.waitForTimeout(1000);
      continue;
    }

    await page.waitForTimeout(800);
    const claimBtn = page.locator('button:has-text("Claim")').first();
    await claimBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    if ((await claimBtn.count()) > 0) {
      await claimBtn.click({ force: true }).catch(() => {});
      console.log('  ✓ Clicked Claim button');
    } else {
      console.log('  ⚠ Claim button not found');
      continue;
    }

    const checkbox = page.locator('#toggle-custom-exchange');
    if ((await checkbox.count()) > 0) {
      const checked = await checkbox.isChecked().catch(() => false);
      if (!checked) await checkbox.check({ force: true }).catch(() => checkbox.click({ force: true }));
      console.log('  ✓ Custom exchange checkbox checked');
    }

    const exchangeInput = page.locator('input[placeholder*="Meta Mask"], input[name="exchangeName"]');
    if ((await exchangeInput.count()) > 0) {
      await exchangeInput.fill('Meta Mask').catch(() => {});
      console.log('  ✓ Exchange name filled');
    }

    const nextClicked1 = await clickOverlayButton(page, 'Next');
    console.log(`  Next button 1: ${nextClicked1 ? '✓' : '⚠'}`);
    await page.waitForTimeout(1000);
    
    const nextClicked2 = await clickOverlayButton(page, 'Next');
    console.log(`  Next button 2: ${nextClicked2 ? '✓' : '⚠'}`);

    const otpFound = await waitForOtpInputs(page, 20000);
    console.log(`  OTP inputs: ${otpFound ? '✓ found' : '⚠ not found'}`);
    const otpOverlay = await findVisibleOverlay(page);
    await fillOtpInContext(page, otpOverlay);
    console.log('  ✓ OTP filled');
    await page.waitForTimeout(600);

    const confirmClicked = await clickOverlayButton(page, 'Confirm');
    console.log(`  Confirm button: ${confirmClicked ? '✓' : '⚠'}`);
    await page.waitForTimeout(3000);

    await scrollTransactionList(page, 'left', 4, 220);
    claimedCount += 1;
    console.log(`  ✓ Claim ${claimedCount}/${requiredClaims} completed`);
  }
  
  console.log(`  📋 Claim process finished. Claimed: ${claimedCount}/${requiredClaims}`);
}

async function ensureTxAndClaimWallet(page, context, walletInfo, sendResults, amountMap, transferUrl, config) {
  const { label, address, tokens } = walletInfo;
  await page.bringToFront().catch(() => {});
  console.log(`\n➡ Processing wallet: ${label} (${address?.substring(0, 10)}...)`);
  console.log(`  Tokens to claim: ${tokens.join(', ')}`);
  
  const { page: targetPage, success } = await openWalletByLabel(context, page, label, address);
  if (!success) {
    console.log(`  ⚠ Could not open wallet ${label} - skipping claims`);
    return;
  }
  console.log(`  ✓ Wallet ${label} opened`);

  console.log('  Waiting for transaction indicators (up to 2 minutes)...');
  const hasTx = await waitForTransactionIndicators(targetPage, 120000);
  if (!hasTx) {
    console.log(`  ⚠ No transactions detected for ${label} after 2 minutes. Re-sending expected tokens...`);
    for (const t of tokens) {
      const transferConfig = config.transfers.find(tc => tc.tokenType === t);
      if (transferConfig) {
        console.log(`  Re-sending ${t}...`);
        await sendWithRetries(context, [address], transferConfig.amount, t, transferConfig.radioLabel, transferUrl, 2);
      }
    }
    console.log('  Waiting again for transaction indicators (up to 1 minute)...');
    await waitForTransactionIndicators(targetPage, 60000);
  } else {
    console.log('  ✓ Transaction indicators found');
  }

  const expectedClaims = tokens.length;
  if (expectedClaims > 0) {
    console.log(`  Starting claim process for ${expectedClaims} transaction(s)...`);
    await claimPendingTransactions(targetPage, expectedClaims);
  }
  
  console.log(`  Returning to asset wallet table...`);
  await returnToAssetWalletTable(targetPage, walletInfo.assetWalletName || walletInfo.label);
  console.log(`  ✓ Finished processing ${label}`);
}

// Sweep functions
async function runWalletSweep(page, label, address, amount, tokenType = 'OKK', chainId = null) {
  if (!label) { return false; }
  if (sweepedWalletLabels.has(`${label}-${tokenType}`)) { return false; }

  console.log(`\n🧹 Starting sweep for wallet: ${label} (token: ${tokenType})`);
  
  await refreshAssetWalletPage(page);
  await waitForWalletRowByName(page, label, 20000);
  
  let rows = page.locator('table tbody tr, [role="row"]', { hasText: label });
  if ((await rows.count()) === 0 && address) {
    rows = page.locator('table tbody tr, [role="row"]', { hasText: address });
  }
  const walletRow = rows.first();
  if ((await walletRow.count()) === 0) { return false; }
  
  await walletRow.scrollIntoViewIfNeeded().catch(() => {});
  
  const rowText = (await walletRow.textContent().catch(() => '')).toLowerCase();
  if (rowText.includes('pending initialization')) { return false; }
  
  const sweepBtn = walletRow.locator('button:has-text("Sweep")').first();
  if ((await sweepBtn.count()) === 0) { return false; }
  
  await sweepBtn.scrollIntoViewIfNeeded().catch(() => {});
  await sweepBtn.click({ force: true }).catch(() => sweepBtn.click({ force: true }));
  
  await page.waitForTimeout(2000);
  let overlay = await findVisibleOverlay(page);

  // Click Max Amount
  const maxAmountSelectors = [
    'div.text-xs.text-right.text-gray-400.dark\\:text-gray-300.mt-1.mr-1.cursor-pointer:has-text("Max Amount")',
    'text=Max Amount',
    'button:has-text("Max")',
    'span:has-text("Max Amount")'
  ];
  
  for (const selector of maxAmountSelectors) {
    const maxAmount = overlay.locator(selector).first();
    if ((await maxAmount.count()) > 0) {
      try {
        await maxAmount.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await maxAmount.click({ force: true });
        break;
      } catch (e) {}
    }
  }
  
  await page.waitForTimeout(1500);

  // Click Next twice
  await clickOverlayButton(page, 'Next');
  await page.waitForTimeout(2000);
  await clickOverlayButton(page, 'Next');
  await page.waitForTimeout(1000);

  // Fill OTP (skip for TRX_TEST)
  if (chainId !== 'TRX_TEST') {
    const otpFound = await waitForOtpInputs(page, 20000);
    if (!otpFound) {
      console.log('⚠ OTP inputs not detected yet; attempting to fill anyway');
    }
    overlay = await findVisibleOverlay(page);
    await fillOtpInContext(page, overlay);
    await page.waitForTimeout(600);
  } else {
    console.log('  ⊘ Skipping OTP for TRX_TEST chain');
  }

  // Click Sweep
  await clickOverlayButton(page, 'Sweep');
  
  await page.waitForTimeout(2000);
  await returnToAssetWalletTable(page, label).catch(() => {});
  sweepedWalletLabels.add(`${label}-${tokenType}`);
  return true;
}

async function runColdWalletSweep(page, address, amount, tokenType = 'OKK', chainId = null) {
  const label = 'Cold';
  
  if (sweepedWalletLabels.has(`${label}-${tokenType}`)) { return false; }

  console.log(`\n🧹 Starting COLD wallet sweep (token: ${tokenType})`);
  
  await refreshAssetWalletPage(page);
  await waitForWalletRowByName(page, label, 20000);
  
  let rows = page.locator('table tbody tr, [role="row"]', { hasText: label });
  if ((await rows.count()) === 0 && address) {
    rows = page.locator('table tbody tr, [role="row"]', { hasText: address });
  }
  const walletRow = rows.first();
  if ((await walletRow.count()) === 0) { return false; }
  
  await walletRow.scrollIntoViewIfNeeded().catch(() => {});
  
  const rowText = (await walletRow.textContent().catch(() => '')).toLowerCase();
  if (rowText.includes('pending initialization')) { return false; }

  // Step 1: Click Sweep
  const sweepBtn = walletRow.locator('button:has-text("Sweep")').first();
  if ((await sweepBtn.count()) === 0) { return false; }
  await sweepBtn.scrollIntoViewIfNeeded().catch(() => {});
  await sweepBtn.click({ force: true }).catch(() => sweepBtn.click({ force: true }));
  
  await page.waitForTimeout(2000);
  let overlay = await findVisibleOverlay(page);

  // Step 2: Max Amount
  const maxAmountSelectors = [
    'div.text-xs.text-right.text-gray-400.dark\\:text-gray-300.mt-1.mr-1.cursor-pointer:has-text("Max Amount")',
    'text=Max Amount',
    'button:has-text("Max")',
    'span:has-text("Max Amount")'
  ];
  
  for (const selector of maxAmountSelectors) {
    const maxAmount = overlay.locator(selector).first();
    if ((await maxAmount.count()) > 0) {
      try {
        await maxAmount.click({ force: true });
        break;
      } catch (e) {}
    }
  }
  
  await page.waitForTimeout(1500);

  // Step 3: First Next
  overlay = await findVisibleOverlay(page);
  const nextBtn1 = overlay.locator('button:has-text("Next")').first();
  await nextBtn1.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await nextBtn1.click({ force: true });
  await page.waitForTimeout(2000);
  
  // Step 4: Second Next
  overlay = await findVisibleOverlay(page);
  const nextBtn2 = overlay.locator('button:has-text("Next")').first();
  await nextBtn2.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await nextBtn2.click({ force: true });
  await page.waitForTimeout(2000);

  // Step 5: 2FA (skip for TRX_TEST)
  if (chainId !== 'TRX_TEST') {
    const otpFound = await waitForOtpInputs(page, 20000);
    if (!otpFound) {
      console.log('⚠ OTP inputs not detected yet; attempting to fill anyway');
    }
    overlay = await findVisibleOverlay(page);
    await fillOtpInContext(page, overlay);
    await page.waitForTimeout(1500);
  } else {
    console.log('  ⊘ Skipping OTP for TRX_TEST chain');
  }

  // Step 6: Sweep cold to root wallet
  overlay = await findVisibleOverlay(page);
  const coldSweepButtonSelectors = [
    'button:has-text("Sweep cold to root wallet")',
    'button:has-text("Sweep cold")',
    'button:has-text("Sweep")'
  ];
  
  for (const selector of coldSweepButtonSelectors) {
    const confirmBtn = overlay.locator(selector).first();
    if ((await confirmBtn.count()) > 0) {
      try {
        await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await confirmBtn.click({ force: true });
        break;
      } catch (e) {}
    }
  }
  
  await page.waitForTimeout(2000);
  await returnToAssetWalletTable(page, label).catch(() => {});
  sweepedWalletLabels.add(`${label}-${tokenType}`);
  return true;
}

async function handlePostInitializationSweeps(page, amountMap, rootAddress, config) {
  console.log('\n====== POST-INITIALIZATION SWEEP PROCESS ======');
  
  if (!depositWalletInitLabel && !rootAddress && !coldWalletAddress) {
    console.log('⚠ Wallet metadata missing; skipping sweep');
    return;
  }
  
  const sweepAmount = config.sweepAmount;
  const sweepToken = config.sweepToken;
  
  if (sweepAmount == null) {
    console.log('⚠ No sweep amount provided; skipping sweep');
    return;
  }

  // Wait for wallets to initialize
  console.log('\n📋 Step 1: Waiting for wallets to be initialized...');
  await page.waitForTimeout(5000);

  // Refresh
  await refreshAssetWalletPage(page);
  await page.waitForTimeout(2000);

  const chainId = config.chainId;

  // Sweep Deposit
  console.log(`\n📋 Step 2: Processing Deposit Wallet Sweep (${sweepToken})...`);
  if (depositWalletInitLabel && depositWalletAddress) {
    await runWalletSweep(page, depositWalletInitLabel, depositWalletAddress, sweepAmount, sweepToken, chainId);
    await page.waitForTimeout(2000);
  }

  // Sweep Root
  console.log(`\n📋 Step 3: Processing Root Wallet Sweep (${sweepToken})...`);
  if (rootAddress) {
    await runWalletSweep(page, 'Root', rootAddress, sweepAmount, sweepToken, chainId);
    await page.waitForTimeout(2000);
  }

  // Sweep Cold
  console.log(`\n📋 Step 4: Processing Cold Wallet Sweep (${sweepToken})...`);
  if (coldWalletAddress) {
    await runColdWalletSweep(page, coldWalletAddress, sweepAmount, sweepToken, chainId);
    await page.waitForTimeout(2000);
  }

  console.log('\n====== SWEEP PROCESS COMPLETE ======\n');
}
