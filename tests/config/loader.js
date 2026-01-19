/**
 * Test Configuration Loader
 * 
 * Loads the configuration saved by the prompt script.
 * Falls back to environment variables or defaults if no config file exists.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CHAIN_CONFIGS, DEFAULT_CHAIN } from './chains.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'test.config.json');

/**
 * Load test configuration
 * Priority: Config file > Environment variables > Defaults
 */
export function loadTestConfig() {
  let config = {};

  // Try to load from config file
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      console.log(`📋 Loaded config from ${CONFIG_FILE}`);
      console.log(`   Chain: ${config.chainDisplayName || config.chainId}`);
    }
  } catch (e) {
    console.log(`⚠ Could not load config file: ${e.message}`);
  }

  // Override with environment variables if present
  if (process.env.TEST_EMAIL) config.email = process.env.TEST_EMAIL;
  if (process.env.TEST_PASSWORD) config.password = process.env.TEST_PASSWORD;
  if (process.env.TEST_CHAIN) config.chainId = process.env.TEST_CHAIN;
  if (process.env.BASE_URL) config.baseUrl = process.env.BASE_URL;

  // Apply defaults
  const chainId = config.chainId || DEFAULT_CHAIN;
  const chainConfig = CHAIN_CONFIGS[chainId];

  if (!chainConfig) {
    throw new Error(`Unknown chain: ${chainId}. Available: ${Object.keys(CHAIN_CONFIGS).join(', ')}`);
  }

  return {
    // Credentials
    email: config.email || 'hwashenwong+2@gambit.com.my',
    password: config.password || 'Yy12220901!',
    baseUrl: config.baseUrl || 'https://staging-web-enterprise.sandbox.gambitcustody-test.com/login',
    
    // Chain config
    chainId: chainId,
    chainName: chainConfig.name,
    chainDisplayName: chainConfig.displayName,
    assetName: chainConfig.assetName,
    assetSearchText: chainConfig.assetSearchText,
    transferUrl: chainConfig.transferUrl,
    transfers: chainConfig.transfers,
    sweepToken: chainConfig.sweepToken,
    sweepAmount: chainConfig.sweepAmount
  };
}

/**
 * Get transfer config for a specific token type
 */
export function getTransferConfig(config, tokenType) {
  return config.transfers.find(t => t.tokenType === tokenType);
}

/**
 * Check if a wallet type should receive a specific token
 */
export function shouldTransferTo(config, tokenType, walletType) {
  const transfer = getTransferConfig(config, tokenType);
  if (!transfer) return false;
  return transfer.targets.includes(walletType.toLowerCase());
}
