/**
 * Web-based config UI for Playwright wallet tests.
 *
 * Start:
 *   node tests/config/ui-server.js
 *
 * Then open:
 *   http://localhost:4177
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

import { CHAIN_CONFIGS, getAvailableChains, DEFAULT_CHAIN } from './chains.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(__dirname, 'test.config.json');
const UI_DIR = path.join(__dirname, 'ui');

const PORT = parseInt(process.env.CONFIG_UI_PORT || process.env.PORT || '4177', 10);

// CORS: Allow requests from Vercel-hosted UI or other origins
// Set CORS_ORIGINS=https://your-frontend.vercel.app or use * for all
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').filter(Boolean);

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  // Always set CORS headers for cross-origin requests
  // If no origin, allow (same-origin request)
  const allowOrigin = origin || '*';
  
  const allowAll = ALLOWED_ORIGINS.includes('*');
  if (allowAll || !origin || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    pathname = '/ui/index.html';
  }

  if (!pathname.startsWith('/ui/')) {
    sendText(res, 404, 'Not found');
    return;
  }

  const rel = pathname.replace('/ui/', '');
  const filePath = path.join(UI_DIR, rel);

  if (!filePath.startsWith(UI_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, 'Not found');
    return;
  }

  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

// SSE clients
const sseClients = new Set();
function sseSend(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      // ignore
    }
  }
}

let runState = {
  status: 'idle',
  runId: null,
  startedAt: null,
  exitCode: null
};
let logLines = [];
let currentProcess = null;

// In-memory config storage (does NOT persist to disk for security)
// Each user session has their own config in their browser
let inMemoryConfig = null;

function addLog(line) {
  const trimmed = (line ?? '').toString().replace(/\r/g, '');
  if (!trimmed) return;
  const lines = trimmed.split('\n');
  for (const l of lines) {
    logLines.push(l);
    if (logLines.length > 4000) logLines.shift();
    sseSend({ type: 'log', line: l });
  }
}

function broadcastRunState() {
  sseSend({ type: 'run', state: runState });
}

function buildConfig(input, existingConfig) {
  const email = (input.email || '').trim();
  const baseUrl = (input.baseUrl || '').trim();
  const chainId = (input.chainId || '').trim();

  if (!email) throw new Error('Email is required');
  if (!baseUrl) throw new Error('Base URL is required');
  if (!chainId) throw new Error('Chain is required');

  const chainConfig = CHAIN_CONFIGS[chainId];
  if (!chainConfig) {
    throw new Error(`Unknown chain: ${chainId}`);
  }

  const next = {
    ...(existingConfig || {}),
    email,
    baseUrl,
    chainId,
    chainName: chainConfig.name,
    chainDisplayName: chainConfig.displayName,
    assetName: chainConfig.assetName,
    assetSearchText: chainConfig.assetSearchText,
    transferUrl: chainConfig.transferUrl,
    transfers: chainConfig.transfers,
    sweepToken: chainConfig.sweepToken,
    sweepAmount: chainConfig.sweepAmount,
    timestamp: new Date().toISOString()
  };

  return next;
}

function startRun({ headed, workers, password }) {
  if (runState.status === 'running') {
    const err = new Error('A run is already in progress');
    err.statusCode = 409;
    throw err;
  }

  const runId = `run_${Date.now()}`;
  runState = { status: 'running', runId, startedAt: new Date().toISOString(), exitCode: null };
  logLines = [];
  broadcastRunState();

  const args = ['playwright', 'test', 'tests/wallet-test.spec.js', '--workers=' + String(workers || 1)];
  if (headed) args.push('--headed');

  addLog(`[server] Starting: npx ${args.join(' ')}`);

  const env = { ...process.env };
  if (typeof password === 'string' && password.length > 0) {
    env.TEST_PASSWORD = password;
  }

  currentProcess = spawn('npx', args, {
    cwd: ROOT_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  currentProcess.stdout.on('data', (d) => addLog(d.toString('utf8')));
  currentProcess.stderr.on('data', (d) => addLog(d.toString('utf8')));

  currentProcess.on('close', (code) => {
    runState = {
      ...runState,
      status: 'finished',
      exitCode: typeof code === 'number' ? code : null
    };
    addLog(`[server] Finished with exit code ${runState.exitCode}`);
    broadcastRunState();
    currentProcess = null;
  });

  currentProcess.on('error', (err) => {
    addLog(`[server] Failed to start: ${err.message}`);
    runState = { ...runState, status: 'finished', exitCode: 1 };
    broadcastRunState();
    currentProcess = null;
  });

  return runId;
}

function runConnectivityTest({ baseUrl, email, password }) {
  return new Promise((resolve, reject) => {
    const args = [
      'playwright',
      'test',
      'tests/connectivity.spec.js',
      '--workers=1',
      '--reporter=line'
    ];

    const env = {
      ...process.env,
      TEST_EMAIL: email,
      TEST_PASSWORD: password,
      BASE_URL: baseUrl,
      // Force headless mode for Docker
      PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright'
    };

    const proc = spawn('npx', args, {
      cwd: ROOT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let out = '';
    let err = '';

    proc.stdout.on('data', d => { out += d.toString('utf8'); });
    proc.stderr.on('data', d => { err += d.toString('utf8'); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, stage: 'dashboard' });
      } else {
        const msg = (err || out).split('\n').slice(-8).join('\n') || 'Connectivity test failed';
        reject(new Error(msg));
      }
    });

    proc.on('error', (e) => {
      reject(e);
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // Set CORS headers for all requests
    setCorsHeaders(req, res);
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // Health check endpoint for Render
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/ui/') || url.pathname === '/index.html')) {
      serveStatic(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/chains') {
      const chains = getAvailableChains();
      sendJson(res, 200, { chains, defaultChainId: DEFAULT_CHAIN });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      // Return in-memory config (no file persistence for security)
      const cfg = inMemoryConfig || {};
      // Never return password
      const safeCfg = { ...cfg };
      delete safeCfg.password;
      sendJson(res, 200, { 
        config: safeCfg, 
        configPath: '(in-memory only, not saved to disk)',
        note: 'Config is session-based. Enter your details each time.'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await readBody(req);
      const input = JSON.parse(body || '{}');
      const next = buildConfig(input, inMemoryConfig || {});

      // Store in memory only (no file save for security)
      inMemoryConfig = next;
      
      sendJson(res, 200, {
        ok: true,
        chainId: next.chainId,
        chainDisplayName: next.chainDisplayName,
        note: 'Config stored in memory only (not saved to disk)'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const cfg = inMemoryConfig;
      if (!cfg || !cfg.email || !cfg.baseUrl || !cfg.chainId) {
        sendJson(res, 400, { error: 'Config not set. Please fill in email, base URL, and chain first.' });
        return;
      }

      const body = await readBody(req);
      const input = JSON.parse(body || '{}');
      const headed = input.headed !== false;
      const workers = Number.isFinite(input.workers) ? input.workers : parseInt(String(input.workers || '1'), 10);
      const password = (input.password || '').toString();

      if (!password) {
        sendJson(res, 400, { error: 'Password required for each run. Please enter your password.' });
        return;
      }

      const runId = startRun({ headed, workers, password });
      sendJson(res, 200, { ok: true, runId });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/test-connection') {
      const body = await readBody(req);
      const input = JSON.parse(body || '{}');
      const baseUrl = (input.baseUrl || '').trim();
      const email = (input.email || '').trim();
      const password = (input.password || '').toString();

      if (!baseUrl || !email || !password) {
        sendJson(res, 400, { error: 'baseUrl, email, and password are required' });
        return;
      }

      const result = await runConnectivityTest({ baseUrl, email, password });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      });
      res.write('\n');
      sseClients.add(res);

      // bootstrap: send current state and existing logs
      res.write(`data: ${JSON.stringify({ type: 'run', state: runState })}\n\n`);
      for (const l of logLines) {
        res.write(`data: ${JSON.stringify({ type: 'log', line: l })}\n\n`);
      }

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    sendText(res, 404, 'Not found');
  } catch (err) {
    const status = err?.statusCode || 500;
    sendJson(res, status, { error: err.message || 'Internal error' });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Config UI server running at http://localhost:${PORT}`);
  console.log('Config file:', CONFIG_FILE);
});
