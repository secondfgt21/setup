import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const ROOT_DIR = process.cwd();

const MANAGED_FILES = new Set(['accounts.json', 'emails.txt', 'live.txt', 'die.txt']);
const EDITABLE_FILES = new Set(['accounts.json', 'emails.txt']);
const ALLOWED_SCRIPTS = new Set(['bot.mjs', 'bot1.mjs', 'bot2.mjs']);

let activeChild = null;
let activeScript = null;
let lastExitCode = null;
const logLines = [];
const MAX_LOGS = 500;

function appendLog(line) {
  const timestamp = new Date().toISOString().slice(11, 19);
  logLines.push(`[${timestamp}] ${line}`);
  if (logLines.length > MAX_LOGS) {
    logLines.splice(0, logLines.length - MAX_LOGS);
  }
}

function detectChromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/data/data/com.termux/files/usr/bin/chromium-browser',
    '/data/data/com.termux/files/usr/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readSafeFile(filename) {
  if (!MANAGED_FILES.has(filename)) return '';
  const target = path.resolve(ROOT_DIR, filename);
  if (!fs.existsSync(target)) return '';
  return fs.readFileSync(target, 'utf-8');
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>gpay-closer Runner</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 24px auto; max-width: 960px; padding: 0 16px; background: #0f172a; color: #e2e8f0; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .muted { color: #94a3b8; font-size: 0.9rem; margin-bottom: 20px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; font-weight: 600; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.stop { background: #dc2626; }
    button.secondary { background: #334155; }
    .badge { padding: 4px 10px; border-radius: 999px; font-size: 0.8rem; background: #1e293b; border: 1px solid #334155; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px; }
    .card h2 { font-size: 1rem; margin: 0 0 10px 0; display: flex; justify-content: space-between; align-items: center; }
    textarea, pre { width: 100%; box-sizing: border-box; background: #020617; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 10px; font-family: ui-monospace, monospace; font-size: 0.82rem; }
    textarea { min-height: 160px; resize: vertical; }
    pre { min-height: 220px; max-height: 360px; overflow: auto; margin: 0; white-space: pre-wrap; word-break: break-word; }
    .warn { background: #451a03; border: 1px solid #92400e; color: #fde68a; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; font-size: 0.88rem; }
  </style>
</head>
<body>
  <h1>gpay-closer</h1>
  <div class="muted">Playwright Core automation runner for <code>bot.mjs</code> (Payments Profile &amp; Family Closer), <code>bot1.mjs</code> (Password Changer), and <code>bot2.mjs</code> (Email Checker).</div>

  <div id="chromiumWarn" class="warn" style="display:none;">
    Chromium binary not detected in standard paths. Set <code>CHROMIUM_PATH</code> in your environment before running the bots.
  </div>

  <div class="row">
    <button id="runBot" onclick="startBot('bot.mjs')">Run bot.mjs</button>
    <button id="runBot1" onclick="startBot('bot1.mjs')">Run bot1.mjs</button>
    <button id="runBot2" onclick="startBot('bot2.mjs')">Run bot2.mjs</button>
    <button id="stopBtn" class="stop" onclick="stopBot()" disabled>Stop</button>
    <span class="badge" id="statusBadge">Idle</span>
    <span class="badge" id="chromiumBadge">Chromium: checking...</span>
  </div>

  <div class="card" style="margin-bottom:16px;">
    <h2>Console Output <button class="secondary" onclick="refreshState()">Refresh</button></h2>
    <pre id="logs"></pre>
  </div>

  <div class="grid">
    <div class="card">
      <h2>accounts.json <button class="secondary" onclick="saveFile('accounts.json')">Save</button></h2>
      <textarea id="file-accounts.json"></textarea>
    </div>
    <div class="card">
      <h2>emails.txt <button class="secondary" onclick="saveFile('emails.txt')">Save</button></h2>
      <textarea id="file-emails.txt"></textarea>
    </div>
    <div class="card">
      <h2>live.txt</h2>
      <pre id="file-live.txt" style="min-height:140px;"></pre>
    </div>
    <div class="card">
      <h2>die.txt</h2>
      <pre id="file-die.txt" style="min-height:140px;"></pre>
    </div>
  </div>

  <script>
    let initializedFiles = false;
    async function refreshState() {
      const res = await fetch('/api/state');
      const data = await res.json();
      document.getElementById('statusBadge').textContent = data.running
        ? 'Running: ' + data.activeScript
        : (data.lastExitCode === null ? 'Idle' : 'Last exit: ' + data.lastExitCode);
      document.getElementById('runBot1').disabled = data.running;
      document.getElementById('runBot2').disabled = data.running;
      document.getElementById('stopBtn').disabled = !data.running;

      const cBadge = document.getElementById('chromiumBadge');
      const cWarn = document.getElementById('chromiumWarn');
      if (data.chromiumPath) {
        cBadge.textContent = 'Chromium: ' + data.chromiumPath;
        cWarn.style.display = 'none';
      } else {
        cBadge.textContent = 'Chromium: not found';
        cWarn.style.display = 'block';
      }

      const logsEl = document.getElementById('logs');
      logsEl.textContent = data.logs.join('\\n') || '(No output yet)';
      logsEl.scrollTop = logsEl.scrollHeight;

      if (!initializedFiles) {
        document.getElementById('file-accounts.json').value = data.files['accounts.json'] || '';
        document.getElementById('file-emails.txt').value = data.files['emails.txt'] || '';
        initializedFiles = true;
      }
      document.getElementById('file-live.txt').textContent = data.files['live.txt'] || '(empty)';
      document.getElementById('file-die.txt').textContent = data.files['die.txt'] || '(empty)';
    }

    async function startBot(script) {
      await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      refreshState();
    }

    async function stopBot() {
      await fetch('/api/stop', { method: 'POST' });
      refreshState();
    }

    async function saveFile(name) {
      const content = document.getElementById('file-' + name).value;
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      if (!res.ok) {
        const err = await res.json();
        document.getElementById('statusBadge').textContent = 'Save error: ' + (err.error || 'Failed to save file');
        return;
      }
      document.getElementById('statusBadge').textContent = 'Saved ' + name;
      refreshState();
    }

    refreshState();
    setInterval(refreshState, 2000);
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHtml());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, 200, {
      running: Boolean(activeChild),
      activeScript,
      lastExitCode,
      chromiumPath: detectChromiumPath(),
      logs: logLines,
      files: {
        'accounts.json': readSafeFile('accounts.json'),
        'emails.txt': readSafeFile('emails.txt'),
        'live.txt': readSafeFile('live.txt'),
        'die.txt': readSafeFile('die.txt'),
      },
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/files') {
    try {
      const body = JSON.parse(await readRequestBody(req));
      const { name, content } = body || {};
      if (!EDITABLE_FILES.has(name) || typeof content !== 'string') {
        sendJson(res, 400, { error: 'Invalid file name or content' });
        return;
      }
      if (name === 'accounts.json') {
        try {
          JSON.parse(content);
        } catch (jsonErr) {
          const lines = content
            .trim()
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
          if (lines.length === 0 || !lines.every((l) => l.includes('---') || /^https?:\/\//i.test(l))) {
            throw jsonErr;
          }
        }
      }
      fs.writeFileSync(path.resolve(ROOT_DIR, name), content, 'utf-8');
      appendLog(`Saved ${name}`);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    if (activeChild) {
      sendJson(res, 409, { error: `Process ${activeScript} is already running` });
      return;
    }
    try {
      const body = JSON.parse(await readRequestBody(req));
      const script = body?.script;
      if (!ALLOWED_SCRIPTS.has(script)) {
        sendJson(res, 400, { error: 'Invalid script name' });
        return;
      }

      logLines.length = 0;
      activeScript = script;
      lastExitCode = null;
      appendLog(`Starting node ${script}...`);

      const child = spawn(process.execPath, [script], {
        cwd: ROOT_DIR,
        env: process.env,
      });
      activeChild = child;

      const handleOutput = (chunk) => {
        const text = String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) appendLog(line);
        }
      };

      child.stdout.on('data', handleOutput);
      child.stderr.on('data', handleOutput);
      child.on('close', (code) => {
        appendLog(`${script} exited with code ${code}`);
        lastExitCode = code;
        activeChild = null;
        activeScript = null;
      });
      child.on('error', (err) => {
        appendLog(`Failed to spawn ${script}: ${err.message}`);
        lastExitCode = 1;
        activeChild = null;
        activeScript = null;
      });

      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    if (activeChild) {
      activeChild.kill('SIGTERM');
      appendLog(`Sent SIGTERM to ${activeScript}`);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`gpay-closer server listening on http://${HOST}:${PORT}`);
});
