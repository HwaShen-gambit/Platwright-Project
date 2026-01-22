/**
 * Chain Configuration for Multi-Chain Wallet Testing
 * 
 * Supported Chains:
 * - OKK (ETH_TEST_SEPOLIA) - OngKawKaw on Ethereum Sepolia Testnet
 * - OKK (MATIC_TEST_AMOY) - OngKawKaw on Polygon Amoy Testnet
 * - USDT (TRX_TEST) - Tether USD on Tron Shasta Testnet
 */

export const CHAIN_CONFIGS = {
  'ETH_TEST_SEPOLIA': {
    id: 'ETH_TEST_SEPOLIA',
    name: 'OngKawKaw (ETH_TEST_SEPOLIA)',
    displayName: 'OKK-ETH Sepolia',
    assetName: 'OKK',
    assetSearchText: 'ETH_TEST_SEPOLIA',
    transferUrl: 'https://wallet-transfer-platform.vercel.app/eth.html',
    transfers: [
      {
        tokenType: 'OKK',
        radioLabel: 'OKK',
        amount: 0.00001,
        targets: ['root', 'deposit', 'cold']
      },
      {
        tokenType: 'Native ETH',
        radioLabel: 'Native ETH',
        amount: 0.0003,
        targets: ['root', 'cold'] // Deposit does not receive ETH
      }
    ],
    sweepToken: 'OKK',
    sweepAmount: 0.00001
  },

  'MATIC_TEST_AMOY': {
    id: 'MATIC_TEST_AMOY',
    name: 'OngKawKaw (MATIC_TEST_AMOY)',
    displayName: 'OKK-MATIC Amoy',
    assetName: 'OKK',
    assetSearchText: 'MATIC_TEST_AMOY',
    transferUrl: 'https://wallet-transfer-platform.vercel.app/pol.html',
    transfers: [
      {
        tokenType: 'OKK',
        radioLabel: 'ERC-20 Token (OKK)',
        amount: 0.01,
        targets: ['root', 'deposit', 'cold']
      },
      {
        tokenType: 'Native MATIC',
        radioLabel: 'Native MATIC',
        amount: 0.006,
        targets: ['root', 'cold']
      }
    ],
    sweepToken: 'OKK',
    sweepAmount: 0.01
  },

  'TRX_TEST': {
    id: 'TRX_TEST',
    name: 'Tether USD _Tron Shasta_ (TRX_TEST)',
    displayName: 'USDT-TRX Shasta',
    assetName: 'USDT',
    assetSearchText: 'Tether USD',
    transferUrl: 'https://wallet-transfer-platform.vercel.app/index.html',
    transfers: [
      {
        tokenType: 'USDT',
        radioLabel: 'TRC-20 Token (USDT)',
        amount: 0.1,
        targets: ['root', 'deposit', 'cold']
      },
      {
        tokenType: 'Native TRX',
        radioLabel: 'native TRX',
        amount: 12,
        targets: ['root', 'deposit', 'cold']
      }
    ],
    sweepToken: 'USDT',
    sweepAmount: 0.1
  }
};

// Get chain config by ID
export function getChainConfig(chainId) {
  return CHAIN_CONFIGS[chainId] || null;
}

// Get all available chains for UI selection
export function getAvailableChains() {
  return Object.values(CHAIN_CONFIGS).map(c => ({
    id: c.id,
    name: c.name,
    displayName: c.displayName
  }));
}

// Default chain if none selected
export const DEFAULT_CHAIN = 'ETH_TEST_SEPOLIA';
