import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  retries: 0,
  workers: 1,
  reporter: 'line',
  
  use: {
    // Always use headless in production/Docker
    headless: true,
    
    // Browser settings
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    
    // Timeouts
    actionTimeout: 30000,
    navigationTimeout: 60000,
    
    // Trace on failure
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
