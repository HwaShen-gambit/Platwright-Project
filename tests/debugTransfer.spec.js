import { test } from '@playwright/test';

test.setTimeout(120000);

test('Debug transfer UI - why tokens not sending', async ({ page, context }) => {
  const responses = [];
  const requests = [];
  
  // Monitor all network activity
  page.on('response', async resp => {
    try {
      const entry = { 
        url: resp.url(), 
        status: resp.status(),
        method: await resp.request().method()
      };
      if (resp.url().includes('/api/')) {
        try {
          const text = await resp.text();
          entry.responseBody = text;
        } catch (_) {}
      }
      responses.push(entry);
    } catch (_) {}
  });
  
  page.on('request', req => {
    try {
      const entry = {
        url: req.url(),
        method: req.method(),
        postData: req.postData() || '',
        headers: req.headers()
      };
      requests.push(entry);
    } catch (_) {}
  });

  // Go to transfer UI
  await page.goto('https://wallet-transfer-platform.vercel.app/eth.html');
  await page.waitForLoadState('networkidle');
  
  console.log('\n=== STEP 1: Page loaded ===');
  await page.screenshot({ path: 'debug-01-loaded.png', fullPage: true });
  
  // Select OKK
  console.log('\n=== STEP 2: Selecting OKK ===');
  const okkLabel = page.locator('label:has-text("OKK")').first();
  await okkLabel.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'debug-02-okk-selected.png', fullPage: true });
  
  // Fill test addresses
  console.log('\n=== STEP 3: Filling recipient addresses ===');
  const testAddresses = [
    '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0,0.00001',
    '0x5aeda56215b167893e80b4fe645ba6d5bab767de,0.00001'
  ].join('\n');
  
  const textarea = page.locator('textarea').first();
  await textarea.fill(testAddresses);
  await page.waitForTimeout(500);
  console.log('Filled addresses:', testAddresses);
  await page.screenshot({ path: 'debug-03-addresses-filled.png', fullPage: true });
  
  // Get page content before clicking send
  const contentBefore = await page.locator('body').innerText();
  console.log('\n=== Page content BEFORE send (first 500 chars) ===');
  console.log(contentBefore.substring(0, 500));
  
  // Click Send Tokens
  console.log('\n=== STEP 4: Clicking Send Tokens ===');
  const sendBtn = page.locator('button:has-text("Send Tokens")').first();
  
  const beforeReqCount = requests.length;
  const beforeRespCount = responses.length;
  
  await sendBtn.click();
  console.log('✓ Send button clicked');
  
  // Immediate check
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'debug-04-right-after-send.png', fullPage: true });
  
  const contentAfter1s = await page.locator('body').innerText();
  console.log('\n=== Page content 1s AFTER send (first 800 chars) ===');
  console.log(contentAfter1s.substring(0, 800));
  
  // Wait and monitor for 20 seconds
  console.log('\n=== STEP 5: Monitoring for 20 seconds ===');
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    
    const newReqs = requests.length - beforeReqCount;
    const newResps = responses.length - beforeRespCount;
    
    if (i % 5 === 0 || newReqs > 0) {
      console.log(`  [${i}s] Requests: +${newReqs}, Responses: +${newResps}`);
      
      if (newReqs > 0) {
        const latestReqs = requests.slice(-Math.min(5, newReqs));
        console.log('  Latest requests:', JSON.stringify(latestReqs.map(r => ({
          method: r.method,
          url: r.url,
          hasData: r.postData?.length > 0
        })), null, 2));
      }
    }
    
    // Check for status messages
    const currentContent = await page.locator('body').innerText();
    if (currentContent.includes('successfully') || currentContent.includes('completed')) {
      console.log('  ✓ SUCCESS message detected!');
      await page.screenshot({ path: `debug-05-success-at-${i}s.png`, fullPage: true });
      break;
    }
    if (currentContent.includes('error') || currentContent.includes('failed')) {
      console.log('  ❌ ERROR message detected!');
      console.log('  Error text:', currentContent.substring(currentContent.indexOf('error'), currentContent.indexOf('error') + 200));
      await page.screenshot({ path: `debug-05-error-at-${i}s.png`, fullPage: true });
      break;
    }
  }
  
  // Final screenshot
  await page.screenshot({ path: 'debug-06-final.png', fullPage: true });
  
  // Dump all API requests
  console.log('\n=== ALL API REQUESTS ===');
  const apiReqs = requests.filter(r => r.url.includes('/api/'));
  console.log(JSON.stringify(apiReqs, null, 2));
  
  console.log('\n=== ALL API RESPONSES ===');
  const apiResps = responses.filter(r => r.url.includes('/api/'));
  console.log(JSON.stringify(apiResps, null, 2));
  
  console.log('\n=== SUMMARY ===');
  console.log(`Total requests: ${requests.length}`);
  console.log(`Total responses: ${responses.length}`);
  console.log(`API requests: ${apiReqs.length}`);
  console.log(`POST requests: ${requests.filter(r => r.method === 'POST').length}`);
  
  await page.waitForTimeout(5000); // Keep page open
});
