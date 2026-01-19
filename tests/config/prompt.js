/**
 * Pre-Run Configuration Prompt
 * 
 * This script runs before tests to collect user input:
 * - Login credentials (email, password)
 * - Chain selection for asset wallet creation
 * 
 * Usage: node tests/config/prompt.js
 * 
 * The configuration is saved to tests/config/test.config.json
 * and read by the test files at runtime.
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CHAIN_CONFIGS, getAvailableChains, DEFAULT_CHAIN } from './chains.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'test.config.json');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prompt helper
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Masked password input (shows asterisks)
function promptPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    
    let password = '';
    
    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit();
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    };
    
    stdin.on('data', onData);
  });
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       MULTI-CHAIN WALLET TESTING - CONFIGURATION             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Load existing config if available
  let existingConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      existingConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore
  }

  // 1. Credentials
  console.log('─── LOGIN CREDENTIALS ───\n');
  
  const defaultEmail = existingConfig.email || '';
  const emailPrompt = defaultEmail 
    ? `Email [${defaultEmail}]: ` 
    : 'Email: ';
  let email = await prompt(emailPrompt);
  if (!email && defaultEmail) email = defaultEmail;
  
  console.log('');
  let password = await promptPassword('Password: ');
  if (!password && existingConfig.password) {
    password = existingConfig.password;
    console.log('(Using previously saved password)');
  }

  // 2. Chain Selection
  console.log('\n─── CHAIN SELECTION ───\n');
  console.log('Available chains for Asset Wallet creation:\n');
  
  const chains = getAvailableChains();
  chains.forEach((chain, index) => {
    const marker = (existingConfig.chainId === chain.id) ? ' [current]' : '';
    console.log(`  ${index + 1}. ${chain.name}${marker}`);
  });
  
  const defaultChainIndex = existingConfig.chainId 
    ? chains.findIndex(c => c.id === existingConfig.chainId) + 1 
    : 1;
  
  console.log('');
  const chainInput = await prompt(`Select chain (1-${chains.length}) [${defaultChainIndex}]: `);
  const chainIndex = chainInput ? parseInt(chainInput, 10) - 1 : defaultChainIndex - 1;
  
  if (chainIndex < 0 || chainIndex >= chains.length) {
    console.log('Invalid selection. Using default chain.');
  }
  
  const selectedChain = chains[Math.max(0, Math.min(chainIndex, chains.length - 1))];
  const chainConfig = CHAIN_CONFIGS[selectedChain.id];

  // 3. Base URL (optional)
  console.log('\n─── APPLICATION URL ───\n');
  const defaultUrl = existingConfig.baseUrl || 'https://staging-web-enterprise.sandbox.gambitcustody-test.com/login';
  const baseUrl = await prompt(`Base URL [${defaultUrl}]: `) || defaultUrl;

  // Build config object
  const config = {
    email,
    password,
    baseUrl,
    chainId: selectedChain.id,
    chainName: selectedChain.name,
    chainDisplayName: selectedChain.displayName,
    assetName: chainConfig.assetName,
    assetSearchText: chainConfig.assetSearchText,
    transferUrl: chainConfig.transferUrl,
    transfers: chainConfig.transfers,
    sweepToken: chainConfig.sweepToken,
    sweepAmount: chainConfig.sweepAmount,
    timestamp: new Date().toISOString()
  };

  // Save config
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  
  console.log('\n─── CONFIGURATION SAVED ───\n');
  console.log(`  Chain: ${config.chainDisplayName}`);
  console.log(`  Email: ${config.email}`);
  console.log(`  Password: ${'*'.repeat(config.password.length)}`);
  console.log(`  Transfer URL: ${config.transferUrl}`);
  console.log(`  Transfers:`);
  config.transfers.forEach(t => {
    console.log(`    - ${t.tokenType}: ${t.amount} to ${t.targets.join(', ')}`);
  });
  console.log(`  Sweep Token: ${config.sweepToken}`);
  console.log(`\n  Config saved to: ${CONFIG_FILE}`);
  
  console.log('\n─── READY TO RUN ───\n');
  console.log('  Run the test with:');
  console.log(`    npx playwright test tests/wallet-test.spec.js --headed\n`);

  rl.close();
}

main().catch(e => {
  console.error('Error:', e.message);
  rl.close();
  process.exit(1);
});
