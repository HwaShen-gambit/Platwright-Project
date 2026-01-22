const $ = (id) => document.getElementById(id);

const serverPill = $('serverPill');
const runPill = $('runPill');
const connPill = $('connPill');
const logEl = $('log');

const emailEl = $('email');
const passwordEl = $('password');
const passwordToggleEl = $('passwordToggle');
const baseUrlEl = $('baseUrl');
const chainIdEl = $('chainId');
const headedEl = $('headed');
const workersEl = $('workers');

const reloadBtn = $('reloadBtn');
const saveBtn = $('saveBtn');
const saveRunBtn = $('saveRunBtn');
const runBtn = $('runBtn');
const testConnBtn = $('testConnBtn');
const clearLogsBtn = $('clearLogsBtn');

const configPathEl = $('configPath');

let eventSource;
let lastRunState = null;
const sessionPasswordKey = 'walletTestPassword';

function setPasswordVisibility(isVisible) {
  if (!passwordToggleEl) return;
  passwordEl.type = isVisible ? 'text' : 'password';
  passwordToggleEl.classList.toggle('is-visible', isVisible);
  const label = isVisible ? 'Hide password' : 'Show password';
  passwordToggleEl.setAttribute('aria-label', label);
  passwordToggleEl.setAttribute('title', label);
}

function syncPasswordSession() {
  const value = passwordEl.value;
  if (value) sessionStorage.setItem(sessionPasswordKey, value);
  else sessionStorage.removeItem(sessionPasswordKey);
}

function setPill(pillEl, text, kind) {
  pillEl.textContent = text;
  pillEl.classList.remove('ok', 'warn', 'bad');
  if (kind) pillEl.classList.add(kind);
}

function appendLog(line) {
  logEl.textContent += line;
  if (!logEl.textContent.endsWith('\n')) logEl.textContent += '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLogs() {
  logEl.textContent = '';
}

async function apiGet(path) {
  const res = await fetch(path, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `${path} failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function loadChains() {
  const data = await apiGet('/api/chains');
  chainIdEl.innerHTML = '';
  for (const c of data.chains) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.displayName} — ${c.name}`;
    chainIdEl.appendChild(opt);
  }
  if (data.defaultChainId) {
    chainIdEl.value = data.defaultChainId;
  }
}

async function loadConfig() {
  const data = await apiGet('/api/config');
  if (data?.config) {
    emailEl.value = data.config.email || '';
    baseUrlEl.value = data.config.baseUrl || '';
    if (data.config.chainId) chainIdEl.value = data.config.chainId;
  }
  const sessionPassword = sessionStorage.getItem(sessionPasswordKey);
  if (sessionPassword) {
    passwordEl.value = sessionPassword;
  }
  configPathEl.textContent = data?.configPath ? `Config: ${data.configPath}` : '';
}

function readFormConfig() {
  const email = emailEl.value.trim();
  const baseUrl = baseUrlEl.value.trim();
  const chainId = chainIdEl.value;

  if (!email) throw new Error('Email is required');
  if (!baseUrl) throw new Error('Base URL is required');
  if (!chainId) throw new Error('Chain is required');

  return { email, baseUrl, chainId };
}

async function saveConfig() {
  const cfg = readFormConfig();
  const resp = await apiPost('/api/config', cfg);
  appendLog(`[CONFIG] Saved. Chain: ${resp.chainDisplayName}`);
  return resp;
}

async function runTest() {
  const password = passwordEl.value;
  if (!password) {
    throw new Error('Password is required for each run');
  }
  const headed = headedEl.value === 'true';
  const workers = parseInt(workersEl.value, 10) || 1;
  const resp = await apiPost('/api/run', { headed, workers, password });
  appendLog(`[RUN] Started: ${resp.runId}`);
  syncPasswordSession();
}

async function testConnectivity() {
  const email = emailEl.value.trim();
  const baseUrl = baseUrlEl.value.trim();
  const password = passwordEl.value;

  if (!email) throw new Error('Email is required');
  if (!baseUrl) throw new Error('Base URL is required');
  if (!password) throw new Error('Password is required');

  setPill(connPill, 'Connectivity: testing...', 'loading');
  testConnBtn.disabled = true;
  testConnBtn.classList.remove('success');
  testConnBtn.classList.add('loading');
  testConnBtn.textContent = 'Testing...';
  runBtn.disabled = true;
  saveRunBtn.disabled = true;

  try {
    const resp = await apiPost('/api/test-connection', { email, password, baseUrl });
    const stage = resp.stage ? ` (${resp.stage})` : '';
    setPill(connPill, `Connectivity: success${stage}`, 'ok');
    appendLog(`[CONNECTIVITY] Success${stage}`);
    testConnBtn.classList.remove('loading');
    testConnBtn.classList.add('success');
    testConnBtn.textContent = '✓ Connected';
  } catch (e) {
    setPill(connPill, `Connectivity: failed`, 'bad');
    appendLog(`[CONNECTIVITY] Failed: ${e.message}`);
    testConnBtn.classList.remove('loading');
    testConnBtn.textContent = 'Test Connectivity';
  } finally {
    testConnBtn.disabled = false;
    runBtn.disabled = false;
    saveRunBtn.disabled = false;
  }
}

function connectEvents() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    setPill(serverPill, 'Server: connected', 'ok');
  };

  eventSource.onerror = () => {
    setPill(serverPill, 'Server: disconnected', 'bad');
  };

  eventSource.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'log') {
        appendLog(msg.line);
      }
      if (msg.type === 'run') {
        lastRunState = msg.state;
        const state = msg.state?.status || 'idle';
        if (state === 'running') setPill(runPill, `Run: running (${msg.state.runId})`, 'warn');
        else if (state === 'finished') {
          const ok = msg.state.exitCode === 0;
          setPill(runPill, `Run: finished (exit ${msg.state.exitCode})`, ok ? 'ok' : 'bad');
        } else {
          setPill(runPill, 'Run: idle');
        }
        runBtn.disabled = state === 'running';
        saveRunBtn.disabled = state === 'running';
      }
    } catch (e) {
      // ignore
    }
  };
}

reloadBtn.addEventListener('click', async () => {
  try {
    await loadChains();
    await loadConfig();
    appendLog('[UI] Reloaded config/chains');
  } catch (e) {
    appendLog(`[ERROR] ${e.message}`);
  }
});

saveBtn.addEventListener('click', async () => {
  try {
    await saveConfig();
  } catch (e) {
    appendLog(`[ERROR] ${e.message}`);
  }
});

saveRunBtn.addEventListener('click', async () => {
  try {
    await saveConfig();
    await runTest();
  } catch (e) {
    appendLog(`[ERROR] ${e.message}`);
  }
});

runBtn.addEventListener('click', async () => {
  try {
    // Always save config before running to ensure latest chain selection is used
    await saveConfig();
    await runTest();
  } catch (e) {
    appendLog(`[ERROR] ${e.message}`);
  }
});

clearLogsBtn.addEventListener('click', () => {
  clearLogs();
});

if (passwordToggleEl) {
  passwordToggleEl.addEventListener('click', () => {
    const isVisible = passwordEl.type === 'password';
    setPasswordVisibility(isVisible);
  });
}

passwordEl.addEventListener('input', () => {
  syncPasswordSession();
});

testConnBtn.addEventListener('click', async () => {
  try {
    await testConnectivity();
  } catch (e) {
    appendLog(`[ERROR] ${e.message}`);
  }
});

(async function init() {
  try {
    setPill(serverPill, 'Server: connecting…', 'warn');
    setPill(runPill, 'Run: idle');
    setPill(connPill, 'Connectivity: idle');
    testConnBtn.textContent = 'Test Connectivity';
    setPasswordVisibility(false);
    connectEvents();
    await loadChains();
    await loadConfig();
  } catch (e) {
    appendLog(`[ERROR] ${e.message}`);
  }
})();
