# Multi-Chain Wallet Testing

This testing suite supports automated wallet testing across multiple blockchain networks.

## Supported Chains

| Chain ID | Display Name | Token | Native | Transfer URL |
|----------|--------------|-------|--------|--------------|
| `ETH_TEST_SEPOLIA` | OKK-ETH Sepolia | OKK (0.00001) | ETH (0.0003) | eth.html |
| `MATIC_TEST_AMOY` | OKK-MATIC Amoy | OKK (0.00001) | MATIC (0.0003) | pol.html |
| `TRX_TEST` | USDT-TRX Shasta | USDT (0.1) | TRX (5) | index.html |

## Quick Start

## Web-based Config UI (Browser)

If you prefer a browser page instead of the terminal prompt:

```bash
npm run config:web
```

Then open:

```bash
http://localhost:4177
```

To expose the UI to teammates (or a hosted environment), bind to 0.0.0.0:

```bash
CONFIG_UI_HOST=0.0.0.0 npm run config:web
```

Then share:

```bash
http://<your-machine-ip>:4177
```

From the page you can:
- Fill email/password
- Select the chain from a dropdown
- Save config to `tests/config/test.config.json`
- Run the Playwright test and watch live logs

Password handling:
- The password is **not saved** to the config file.
- You must enter the password each time you run the test.

### 1. Configure Test (First-time or to change settings)

Run the configuration prompt to set up credentials and select chain:

```bash
npm run config
```

This will ask for:
- **Email**: Your login email
- **Password**: Your login password (input is masked)
- **Chain Selection**: Choose from available chains
- **Base URL**: Application URL (default: staging)

Configuration is saved to `tests/config/test.config.json`.

### 2. Run the Test

```bash
npm run wallet
```

This runs the multi-chain wallet test in headed (visible browser) mode.

For headless mode:
```bash
npm run wallet:headless
```

## Test Flow

1. **Login** - Authenticates with email/password
2. **OTP** - Auto-fills 123456 OTP
3. **Create Asset Wallet** - Creates wallet for selected chain's asset
4. **Create Deposit Wallet** - Creates a deposit sub-wallet
5. **Extract Addresses** - Gets Root, Deposit, and Cold wallet addresses
6. **Send Tokens** - Sends tokens from external transfer platform
7. **Claim Transactions** - Claims pending AML transactions
8. **Initialize Wallets** - Initializes wallets (estimate gas, 2FA)
9. **Sweep** - Sweeps tokens from Deposit→Root and Cold→Root

## Configuration Files

| File | Purpose |
|------|---------|
| `tests/config/chains.config.js` | Chain-specific configurations |
| `tests/config/prompt.js` | Pre-run credential/chain selector |
| `tests/config/loader.js` | Loads config at test runtime |
| `tests/config/test.config.json` | Saved configuration (generated) |

## Environment Variables

You can also set configuration via environment variables:

```bash
TEST_EMAIL="user@example.com" \
TEST_PASSWORD="password123" \
TEST_CHAIN="TRX_TEST" \
npm run wallet
```

## Publishing Checklist

- Keep `tests/config/test.config.json` out of git (local-only config file).
- Do not commit real credentials.
- Use `CONFIG_UI_HOST=0.0.0.0` if you need LAN access; otherwise keep localhost for safety.

Environment variables override saved config values.

## Chain-Specific Notes

### OKK-ETH (ETH_TEST_SEPOLIA)
- OKK token sent to: Root, Deposit, Cold
- Native ETH sent to: Root, Cold only
- Sweep: OKK only

### OKK-MATIC (MATIC_TEST_AMOY)
- OKK token sent to: Root, Deposit, Cold
- Native MATIC sent to: Root, Cold only
- Sweep: OKK only

### USDT-TRX (TRX_TEST)
- USDT (TRC-20) sent to: Root, Deposit, Cold
- Native TRX sent to: Root, Deposit, Cold
- Sweep: USDT only

## Legacy Test Files

The original chain-specific test file is also available:

```bash
npm run test:eth
```

This runs `testDemo-OKK-ETH.spec.js` which is hardcoded for ETH Sepolia.
