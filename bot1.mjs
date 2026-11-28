import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import readline from 'node:readline';

if (process.platform === 'android') {
  Object.defineProperty(process, 'platform', {
    value: 'linux',
    configurable: true,
  });
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ||= '1';
  process.env.XDG_CACHE_HOME ||= path.join(os.homedir(), '.cache');
}

const { chromium } = await import('playwright-core');

const PASSWORD_CHANGE_URL =
  'https://myaccount.google.com/signinoptions/password?gar=WzIxXQ&continue=https://myaccount.google.com/security?gar%3DWzIxXQ%26hl%3Did%26utm_source%3DOGB%26utm_medium%3Dact&rapt=AEjHL4OYqrWy2dI3rucTXe9HArW_l_VsfoWqVRNxKMTNALcpMg2qVmvVRmUkZC9IhK7WGzvHyDZ-FXUxcapmLMNw68YeMjjwc7lNfjRNKPCjQ2JLLc5DiMw';

const AUTH_SETTINGS_URL =
  'https://myaccount.google.com/two-step-verification/authenticator?utm_source=google-account&utm_medium=web&utm_campaign=authenticator-screen&continue=https://myaccount.google.com/security';

const NEW_PASSWORD = 'impura123456';
const HEADLESS = true;
const DRY_RUN = false;
const SAVE_ERROR_TO_SDCARD = true;
const STEP_DELAY_MS = 1500;
const MAX_SKIP_ATTEMPTS = 10;
const BROWSER_LOCALE = 'id-ID';
const CREDENTIAL_SOURCE = 'website_tab';
const WEBSITE_SOURCE = {
  "url": "https://akun.impura.id/contoh-link",
  "emailSelector": "",
  "passwordSelector": "",
  "totpSelector": "",
  "readViaClipboard": false
};

// ============================================================================
// INTERACTIVE TERMINAL UI / LOGGER (TERMUX & DESKTOP FRIENDLY)
// ============================================================================
const USE_COLOR = !process.env.NO_COLOR;
const IS_TTY = Boolean(process.stdout.isTTY);
const C = {
  reset: USE_COLOR ? '\x1b[0m' : '',
  bold: USE_COLOR ? '\x1b[1m' : '',
  dim: USE_COLOR ? '\x1b[90m' : '',
  cyan: USE_COLOR ? '\x1b[36m' : '',
  brightCyan: USE_COLOR ? '\x1b[96m' : '',
  green: USE_COLOR ? '\x1b[32m' : '',
  brightGreen: USE_COLOR ? '\x1b[92m' : '',
  yellow: USE_COLOR ? '\x1b[33m' : '',
  brightYellow: USE_COLOR ? '\x1b[93m' : '',
  red: USE_COLOR ? '\x1b[31m' : '',
  brightRed: USE_COLOR ? '\x1b[91m' : '',
  magenta: USE_COLOR ? '\x1b[35m' : '',
  blue: USE_COLOR ? '\x1b[34m' : '',
  brightBlue: USE_COLOR ? '\x1b[94m' : '',
  white: USE_COLOR ? '\x1b[97m' : '',
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function getBoxWidth() {
  const cols = process.stdout.columns || 52;
  return Math.max(38, Math.min(cols - 2, 66));
}

function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function fitLine(str, maxLen) {
  const plain = stripAnsi(str);
  if (plain.length <= maxLen) return str;
  return `${plain.slice(0, Math.max(1, maxLen - 1))}…`;
}

function shortUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '-';
  try {
    const u = new URL(s);
    const clean = `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
    return clean.length > 44 ? `${clean.slice(0, 41)}...` : clean;
  } catch {
    return s.length > 44 ? `${s.slice(0, 41)}...` : s;
  }
}

function formatDuration(ms) {
  const sec = Math.max(0, ms / 1000);
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function buildBar(ratio, width = 14) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `${C.brightCyan}${'█'.repeat(filled)}${C.dim}${'░'.repeat(width - filled)}${C.reset}`;
}

function nowTime() {
  return new Date().toTimeString().slice(0, 8);
}

const ui = {
  _timer: null,
  _frame: 0,
  _spinText: '',
  _spinStart: 0,

  _clearLine() {
    if (IS_TTY) {
      process.stdout.write('\r\x1b[2K');
    }
  },

  _renderSpin() {
    if (!IS_TTY || !this._spinText) return;
    const frame = SPINNER_FRAMES[this._frame % SPINNER_FRAMES.length];
    this._frame += 1;
    const elapsed = ((Date.now() - this._spinStart) / 1000).toFixed(1);
    const maxCols = Math.max(24, (process.stdout.columns || 52) - 12);
    const label = fitLine(this._spinText, maxCols);
    process.stdout.write(`\r\x1b[2K${C.brightCyan}${frame}${C.reset} ${C.white}${label}${C.reset} ${C.dim}(${elapsed}s)${C.reset}`);
  },

  spin(text) {
    this._spinText = String(text || '');
    this._spinStart = Date.now();
    if (!IS_TTY) return;
    if (!this._timer) {
      this._timer = setInterval(() => this._renderSpin(), 90);
      if (this._timer.unref) this._timer.unref();
    }
    this._renderSpin();
  },

  stopSpin() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._spinText = '';
    this._clearLine();
  },

  _print(line) {
    this._clearLine();
    process.stdout.write(`${line}\n`);
    if (IS_TTY && this._spinText) {
      this._renderSpin();
    }
  },

  box(lines, borderColor = C.cyan) {
    this.stopSpin();
    const w = getBoxWidth();
    const inner = w - 4;
    const top = `${borderColor}┌${'─'.repeat(w - 2)}┐${C.reset}`;
    const bot = `${borderColor}└${'─'.repeat(w - 2)}┘${C.reset}`;
    process.stdout.write(`\n${top}\n`);
    for (const raw of lines) {
      const plainLen = stripAnsi(raw).length;
      if (plainLen <= inner) {
        const pad = ' '.repeat(inner - plainLen);
        process.stdout.write(`${borderColor}│${C.reset} ${raw}${pad} ${borderColor}│${C.reset}\n`);
      } else {
        const clipped = fitLine(stripAnsi(raw), inner);
        const pad = ' '.repeat(Math.max(0, inner - clipped.length));
        process.stdout.write(`${borderColor}│${C.reset} ${clipped}${pad} ${borderColor}│${C.reset}\n`);
      }
    }
    process.stdout.write(`${bot}\n`);
  },

  banner(totalAccounts) {
    this.box(
      [
        `${C.bold}${C.brightCyan}GOOGLE PASSWORD & AUTHENTICATOR ROTATOR${C.reset}`,
        `${C.dim}Total Antrean: ${C.white}${totalAccounts} akun${C.dim}  •  Sandi Baru: ${C.brightGreen}${NEW_PASSWORD}${C.reset}`,
      ],
      C.brightCyan
    );
  },

  accountHeader(index, total, stats, sourceText = `akun #${index + 1}`) {
    const ratio = index / Math.max(1, total);
    const pct = Math.round(ratio * 100);
    const bar = buildBar(ratio, 12);
    this.box(
      [
        `${C.bold}${C.white}AKUN [${index + 1}/${total}]${C.reset}  ${bar} ${C.brightCyan}${pct}%${C.reset}`,
        `${C.dim}Sumber :${C.reset} ${C.white}${sourceText}${C.reset}`,
        `${C.dim}Hasil  :${C.reset} ${C.brightGreen}✓ ${stats.success} Sukses${C.reset}  ${C.dim}•${C.reset}  ${C.brightRed}✗ ${stats.failed} Gagal${C.reset}`,
      ],
      C.blue
    );
  },

  step(tag, msg) {
    const t = `${C.dim}[${nowTime()}]${C.reset}`;
    const badge = `${C.bold}${C.brightCyan}[${tag}]${C.reset}`;
    this._print(`${t} ${badge} ${C.white}${msg}${C.reset}`);
    this.spin(msg);
  },

  ok(msg) {
    this._print(`   ${C.brightGreen}✓${C.reset} ${C.green}${msg}${C.reset}`);
  },

  sub(msg) {
    this._print(`   ${C.cyan}▸${C.reset} ${C.dim}${msg}${C.reset}`);
  },

  info(msg) {
    this._print(`   ${C.brightBlue}ℹ${C.reset} ${C.cyan}${msg}${C.reset}`);
  },

  warn(msg) {
    this._print(`   ${C.brightYellow}⚠${C.reset} ${C.yellow}${msg}${C.reset}`);
  },

  fail(msg) {
    this.stopSpin();
    this._print(`   ${C.brightRed}✖ ${msg}${C.reset}`);
  },

  async countdown(ms, label) {
    const endAt = Date.now() + ms;
    if (!IS_TTY) {
      this._print(`   ${C.yellow}⏳ ${label} (${Math.ceil(ms / 1000)}s)${C.reset}`);
      await new Promise((r) => setTimeout(r, ms));
      return;
    }
    const wasSpinning = this._spinText;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    while (Date.now() < endAt) {
      const remMs = Math.max(0, endAt - Date.now());
      const ratio = 1 - remMs / Math.max(1, ms);
      const bar = buildBar(ratio, 10);
      const remSec = (remMs / 1000).toFixed(1);
      process.stdout.write(`\r\x1b[2K   ${C.brightYellow}⏳${C.reset} ${C.yellow}${label}${C.reset} ${bar} ${C.white}${remSec}s${C.reset}`);
      await new Promise((r) => setTimeout(r, Math.min(200, remMs)));
    }
    this._clearLine();
    if (wasSpinning) {
      this.spin(wasSpinning);
    }
  },

  accountDone(index, total, ok, elapsedMs, detail) {
    this.stopSpin();
    const dur = formatDuration(elapsedMs);
    if (ok) {
      this._print(`\n${C.brightGreen}✔ AKUN [${index + 1}/${total}] SELESAI${C.reset} ${C.dim}(${dur}) — ${detail}${C.reset}`);
    } else {
      this._print(`\n${C.brightRed}✖ AKUN [${index + 1}/${total}] GAGAL${C.reset} ${C.dim}(${dur}) — ${detail}${C.reset}`);
    }
  },

  summary(total, stats, totalMs) {
    const bar = buildBar(1, 14);
    this.box(
      [
        `${C.bold}${C.brightGreen}RINGKASAN UBAH SANDI & AUTHEN${C.reset}  ${bar} ${C.brightCyan}100%${C.reset}`,
        `${C.dim}Total Akun :${C.reset} ${C.white}${total}${C.reset}  ${C.dim}(${formatDuration(totalMs)})${C.reset}`,
        `${C.brightGreen}✓ Berhasil :${C.reset} ${stats.success} (tersimpan di berhasil.txt)`,
        `${C.brightRed}✗ Gagal    :${C.reset} ${stats.failed}`,
      ],
      stats.failed === 0 ? C.brightGreen : C.yellow
    );
  },
};

// ============================================================================
// BASE32 TOTP CONVERTER & ACCOUNT PARSER
// ============================================================================
function extractBase32Secret(input) {
  const raw = String(input || '').trim();
  if (raw.toLowerCase().startsWith('otpauth://')) {
    try {
      const u = new URL(raw);
      const sec = u.searchParams.get('secret');
      if (sec) return sec.toUpperCase().replace(/[\s=-]+/g, '');
    } catch {
      const m = raw.match(/[?&]secret=([A-Za-z2-7=\s]+)/i);
      if (m && m[1]) return m[1].toUpperCase().replace(/[\s=-]+/g, '');
    }
  }
  return raw.toUpperCase().replace(/[\s=-]+/g, '');
}

function base32ToBuffer(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = extractBase32Secret(base32);
  if (!cleaned) {
    throw new Error('totpSecret / 2FA kosong!');
  }
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of cleaned) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) {
      throw new Error(`Karakter Base32 tidak valid: "${char}" (harus A-Z atau 2-7)`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret, period = 30, digits = 6, clockOffsetMs = 0) {
  const cleaned = extractBase32Secret(secret);
  const key = base32ToBuffer(cleaned);
  const nowMs = Date.now() + clockOffsetMs;
  const epoch = Math.floor(nowMs / 1000);
  const remaining = period - (epoch % period);
  const counter = Math.floor(epoch / period);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return {
    otp: String(codeInt % 10 ** digits).padStart(digits, '0'),
    remaining,
    secretLength: cleaned.length,
    serverIso: new Date(nowMs).toISOString(),
  };
}

function parseAccountEntry(account, index) {
  if (typeof account === 'string') {
    const raw = account.trim();
    if (raw.includes('---')) {
      const parts = raw.split('---');
      const email = (parts[0] || '').trim();
      const password = (parts[1] || '').trim();
      const totpSecret = parts.slice(2).join('---').trim();
      if (!email || !password || !totpSecret) {
        throw new Error(`Format akun #${index + 1} tidak lengkap. Gunakan: email---password---2fa`);
      }
      base32ToBuffer(totpSecret);
      return { mode: 'direct', email, password, totpSecret };
    }
    if (/^https?:\/\//i.test(raw)) {
      return { mode: 'website_tab', url: raw };
    }
    throw new Error(
      `Entri string akun #${index + 1} harus berupa URL http(s) atau format email---password---2fa.`
    );
  }

  if (account && typeof account === 'object') {
    const rawCombo = String(account.raw || account.combo || account.account || '').trim();
    if (rawCombo.includes('---')) {
      return parseAccountEntry(rawCombo, index);
    }

    const email = String(account.email || account.user || account.username || '').trim();
    const password = String(account.password || account.pass || '').trim();
    const totpSecret = String(
      account.totpSecret ||
        account['2fa'] ||
        account.twofa ||
        account.secret ||
        account.otpSecret ||
        account.authKey ||
        account.totp ||
        ''
    ).trim();

    if (email && password && totpSecret) {
      base32ToBuffer(totpSecret);
      return { mode: 'direct', email, password, totpSecret };
    }

    const url = String(account.url || account.link || '').trim();
    if (url) {
      if (!/^https?:\/\//i.test(url)) {
        throw new Error(`Link website untuk akun #${index + 1} tidak valid.`);
      }
      return { mode: 'website_tab', url };
    }
  }

  if (CREDENTIAL_SOURCE === 'website_tab' && WEBSITE_SOURCE.url) {
    return { mode: 'website_tab', url: WEBSITE_SOURCE.url };
  }

  throw new Error(
    `Data akun #${index + 1} di accounts.json tidak lengkap (isi URL atau email---password---2fa).`
  );
}

function loadAccounts(accountsPath) {
  const rawContent = fs.readFileSync(accountsPath, 'utf-8').trim();
  if (!rawContent) {
    throw new Error('File accounts.json kosong.');
  }

  try {
    const parsed = JSON.parse(rawContent);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.accounts)) return parsed.accounts;
    throw new Error('accounts.json harus berisi array akun/link atau objek { "accounts": [...] }.');
  } catch (jsonErr) {
    const lines = rawContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

    if (lines.length > 0 && lines.every((l) => l.includes('---') || /^https?:\/\//i.test(l))) {
      return lines;
    }
    throw new Error(`Gagal parsing accounts.json: ${jsonErr.message}`);
  }
}

function saveBerhasilResult(email, newPass, newSecret) {
  const line = `${email}---${newPass}---${newSecret}\n`;
  const filePath = path.resolve(process.cwd(), 'berhasil.txt');
  fs.appendFileSync(filePath, line, 'utf-8');
  ui.ok(`Tersimpan ke berhasil.txt: ${email}---${newPass}---${newSecret}`);
}

// ============================================================================
// HELPER AMBIL DATA DARI TAB WEBSITE SUMBER
// ============================================================================
async function fetchFromSourceTab(sourcePage, targetPage, kind) {
  await sourcePage.bringToFront();
  await sourcePage.waitForTimeout(500);

  const selectorMap = {
    email: WEBSITE_SOURCE.emailSelector,
    password: WEBSITE_SOURCE.passwordSelector,
    totp: WEBSITE_SOURCE.totpSelector,
  };
  const customSelector = (selectorMap[kind] || '').trim();
  let extracted = '';

  const resetClipboardHook = async () => {
    await sourcePage.evaluate(() => {
      window.__lastCopiedText = '';
    }).catch(() => {});
  };

  const readClipboard = async () =>
    sourcePage
      .evaluate(async () => {
        if (window.__lastCopiedText) return window.__lastCopiedText;
        try {
          return await navigator.clipboard.readText();
        } catch {
          return '';
        }
      })
      .catch(() => '');

  if (customSelector) {
    const loc = sourcePage.locator(customSelector).first();
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    if (WEBSITE_SOURCE.readViaClipboard) {
      await resetClipboardHook();
      await loc.click();
      await sourcePage.waitForTimeout(350);
      extracted = await readClipboard();
    } else {
      const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
      extracted =
        tag === 'input' || tag === 'textarea'
          ? await loc.inputValue().catch(() => '')
          : await loc.innerText().catch(() => '');
    }
  } else {
    if (kind === 'totp') {
      const remSec = await sourcePage
        .evaluate(() => {
          const txt = document.body ? document.body.innerText : '';
          const m = txt.match(/(\d+)\s*s\s*(?:tersisa|left|remaining)/i);
          return m ? Number(m[1]) : 30;
        })
        .catch(() => 30);

      if (remSec <= 4) {
        ui.spin(`Menunggu siklus OTP baru di website (${remSec}s)...`);
        await ui.countdown((remSec + 2) * 1000, 'Siklus OTP baru');
      }

      const copyOtpBtn = sourcePage
        .locator('button, [role="button"]')
        .filter({ hasText: /salin kode otp|copy otp/i })
        .first();
      if (await copyOtpBtn.isVisible().catch(() => false)) {
        await resetClipboardHook();
        await copyOtpBtn.click();
        await sourcePage.waitForTimeout(350);
        const clipOtp = (await readClipboard()).replace(/\s+/g, '');
        if (/^\d{6}$/.test(clipOtp)) {
          extracted = clipOtp;
        }
      }
    }

    if ((kind === 'email' || kind === 'password') && !extracted) {
      const copyButtons = sourcePage
        .locator('button, [role="button"]')
        .filter({ hasText: /^\s*(copy|salin)\s*$/i });
      const copyCount = await copyButtons.count().catch(() => 0);

      if (kind === 'email' && copyCount >= 1) {
        await resetClipboardHook();
        await copyButtons.nth(0).click();
        await sourcePage.waitForTimeout(350);
        const clipEmail = (await readClipboard()).trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clipEmail)) {
          extracted = clipEmail;
        }
      }

      if (kind === 'password' && copyCount >= 2) {
        await resetClipboardHook();
        await copyButtons.nth(1).click();
        await sourcePage.waitForTimeout(350);
        const clipPass = await readClipboard();
        if (clipPass && !/^[•*]+$/.test(clipPass.trim())) {
          extracted = clipPass.trim();
        }
      }

      if (!extracted) {
        const rawBtn = sourcePage
          .locator('button, [role="button"]')
          .filter({ hasText: /salin raw/i })
          .first();
        if (await rawBtn.isVisible().catch(() => false)) {
          await resetClipboardHook();
          await rawBtn.click();
          await sourcePage.waitForTimeout(350);
          const rawText = await readClipboard();
          const parts = rawText.split('---');
          if (kind === 'email' && parts.length >= 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parts[0].trim())) {
            extracted = parts[0].trim();
          } else if (kind === 'password' && parts.length >= 2 && parts[1].trim()) {
            extracted = parts[1].trim();
          }
        }
      }
    }

    if (!extracted) {
      extracted = await sourcePage.evaluate((targetKind) => {
        const bodyText = document.body ? document.body.innerText : '';

        if (targetKind === 'email') {
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
          for (const inp of document.querySelectorAll('input, textarea')) {
            const m = String(inp.value || '').trim().match(emailRegex);
            if (m) return m[0];
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (parent && parent.closest('button, [role="button"], script, style')) continue;
            const txt = String(node.nodeValue || '').trim();
            const m = txt.match(emailRegex);
            if (m) return m[0];
          }
          const mBody = bodyText.match(emailRegex);
          return mBody ? mBody[0].replace(/(?:salin|copy)$/i, '') : '';
        }

        if (targetKind === 'totp') {
          const lines = bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
          for (let i = 0; i < lines.length; i++) {
            if (/totp|otp|2fa|auth|kode|code/i.test(lines[i])) {
              const combined = `${lines[i]} ${lines[i + 1] || ''} ${lines[i + 2] || ''}`;
              const m = combined.replace(/(\d{3})\s+(\d{3})/g, '$1$2').match(/\b(\d{6})\b/);
              if (m) return m[1];
            }
          }
          const fallback = bodyText.replace(/(\d{3})\s+(\d{3})/g, '$1$2').match(/\b(\d{6})\b/);
          return fallback ? fallback[1] : '';
        }

        if (targetKind === 'password') {
          const pwdInput = document.querySelector('input[type="password"]');
          if (pwdInput && pwdInput.value && !/^[•*]+$/.test(pwdInput.value)) {
            return pwdInput.value;
          }
          const lines = bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
          for (let i = 0; i < lines.length; i++) {
            const mSame = lines[i].match(/(?:password|pass|sandi)\s*[:=]\s*(\S+)/i);
            if (mSame && mSame[1] && !/^[•*]+$/.test(mSame[1])) return mSame[1];
            if (/^(?:password|pass|kata sandi)\s*[:=]?$/i.test(lines[i]) && lines[i + 1]) {
              const nextVal = lines[i + 1].trim();
              if (!/^[•*]+$/.test(nextVal)) return nextVal;
            }
          }
        }
        return '';
      }, kind);
    }
  }

  extracted = String(extracted || '').trim();
  if (kind === 'email') {
    extracted = extracted.replace(/(?:salin|copy)$/i, '').trim();
  }
  if (kind === 'totp') {
    extracted = extracted.replace(/\s+/g, '').match(/\d{6}/)?.[0] || extracted;
  }

  await targetPage.bringToFront();
  await targetPage.waitForTimeout(300);

  if (!extracted) {
    throw new Error(`Gagal mengambil "${kind}" dari website sumber.`);
  }
  ui.ok(`Ambil ${kind} dari Tab Website (disensor)`);
  return extracted;
}

// ============================================================================
// CHROMIUM RESOLVER & HELPERS
// ============================================================================
function resolveChromiumExecutable() {
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
  try {
    const pwPath = chromium.executablePath();
    if (pwPath && fs.existsSync(pwPath)) {
      return pwPath;
    }
  } catch {
    // Ignore
  }
  throw new Error('Binary Chromium tidak ditemukan! Set CHROMIUM_PATH.');
}

async function findVisibleLocatorInAllFrames(page, locatorFactory) {
  const scopes = [page, ...page.frames()];
  for (const scope of scopes) {
    try {
      const list = locatorFactory(scope);
      const count = Math.min(await list.count(), 25);
      for (let i = 0; i < count; i++) {
        const loc = list.nth(i);
        if (await loc.isVisible().catch(() => false)) {
          return { scope, locator: loc };
        }
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

function resolveDownloadDir() {
  const candidates = [
    '/storage/emulated/0/Download',
    path.join(os.homedir(), 'storage', 'downloads'),
    '/sdcard/Download',
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) {
        fs.accessSync(dir, fs.constants.W_OK);
        return dir;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

async function saveDiagnosticScreenshot(page, account, index, currentStep) {
  const random12 = String(crypto.randomInt(100000000000, 1000000000000));
  const fileName = `${random12}.png`;
  const localShot = path.resolve(process.cwd(), fileName);

  try {
    ui.spin('Menyimpan screenshot diagnostik...');
    await page.screenshot({ path: localShot, fullPage: true });
    ui.warn(`Screenshot: ${fileName}`);
    ui.sub(`Lokasi: ${localShot}`);

    if (SAVE_ERROR_TO_SDCARD) {
      const downloadDir = resolveDownloadDir();
      if (downloadDir) {
        const publicShot = path.join(downloadDir, fileName);
        fs.copyFileSync(localShot, publicShot);
        ui.ok(`Tersalin ke Download: ${publicShot}`);
      }
    }
  } catch (shotErr) {
    ui.warn(`Gagal screenshot: ${shotErr.message}`);
  }
}

async function submitTotpChallenge(page, getOtpFn, getClockOffsetFn) {
  const totpInputSelector =
    'input[name="totpPin"], #totpPin, input[type="tel"][autocomplete="one-time-code"], input[aria-label*="code" i], input[aria-label*="kode" i]';
  const tryAnotherSelector =
    'button:has-text("Coba cara lain"), button:has-text("Cara lainnya"), button:has-text("Cara lainnya untuk memverifikasi"), button:has-text("Try another way"), button:has-text("More ways"), a:has-text("Cara lainnya"), a:has-text("Cara lainnya untuk memverifikasi"), [role="button"]:has-text("Coba cara lain"), [role="button"]:has-text("Cara lainnya"), [role="button"]:has-text("Cara lainnya untuk memverifikasi"), [role="button"]:has-text("Try another way")';

  const closeWatcher = new Promise((resolve) => {
    if (page.isClosed()) return resolve('closed');
    page.once('close', () => resolve('closed'));
  });

  await Promise.race([
    page
      .locator(`${totpInputSelector}, ${tryAnotherSelector}`)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {}),
    closeWatcher,
  ]);
  if (page.isClosed()) return;

  let totpInput = page.locator(totpInputSelector).first();
  if (!(await totpInput.isVisible().catch(() => false))) {
    const tryAnotherBtn = page.locator(tryAnotherSelector).first();
    if (await tryAnotherBtn.isVisible().catch(() => false)) {
      ui.sub('Klik "Coba cara lain" untuk Google Authenticator...');
      await tryAnotherBtn.click().catch(() => {});
      await page.waitForTimeout(1800).catch(() => {});
    }
    if (page.isClosed()) return;

    const authOption = page
      .locator(
        'li:has-text("Authenticator"), div[role="link"]:has-text("Authenticator"), div[data-challengetype="6"], button:has-text("Authenticator"), [role="listitem"]:has-text("Authenticator")'
      )
      .first();

    if (await authOption.isVisible().catch(() => false)) {
      await authOption.click().catch(() => {});
      await page.waitForTimeout(1800).catch(() => {});
    }
  }
  if (page.isClosed()) return;

  totpInput = page.locator(totpInputSelector).first();
  await Promise.race([
    totpInput.waitFor({ state: 'visible', timeout: 20000 }),
    closeWatcher.then(() => {
      throw new Error('POPUP_CLOSED');
    }),
  ]).catch((err) => {
    if (err?.message === 'POPUP_CLOSED' || page.isClosed()) return;
    throw err;
  });
  if (page.isClosed()) return;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (page.isClosed()) return;
    const { otp, remaining, serverIso } = await getOtpFn();
    if (page.isClosed()) return;
    const offsetSec = Math.round((getClockOffsetFn ? getClockOffsetFn() : 0) / 1000);
    ui.sub(`Sinkronisasi waktu Google: ${serverIso.slice(11, 19)}Z (selisih ${offsetSec}s)`);
    ui.ok(`Memasukkan OTP 6-digit: ${C.bold}${otp}${C.reset}${C.green} (sisa ${remaining}s)`);
    ui.spin('Mengirim & memverifikasi OTP...');

    await totpInput.click().catch(() => {});
    if (page.isClosed()) return;
    await totpInput.fill('').catch(() => {});
    if (page.isClosed()) return;
    await totpInput.type(otp, { delay: 75 }).catch(() => {});
    if (page.isClosed()) return;
    await page.waitForTimeout(400).catch(() => {});
    if (page.isClosed()) {
      ui.ok('Verifikasi OTP lolos (pop-up tertutup)');
      return;
    }

    const nextBtn = page
      .locator('#totpNext button, #totpNext, button:has-text("Berikutnya"), button:has-text("Next")')
      .first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click().catch(() => {});
    } else {
      await totpInput.press('Enter').catch(() => {});
    }

    const outcome = await Promise.race([
      page
        .waitForURL((u) => !u.href.includes('/challenge/totp'), { timeout: 12000 })
        .then(() => 'moved')
        .catch(() => 'timeout'),
      closeWatcher,
    ]);

    if (outcome === 'closed' || page.isClosed()) {
      ui.ok('Verifikasi OTP lolos (pop-up tertutup)');
      return;
    }

    if (outcome === 'moved') {
      await page.waitForTimeout(1500).catch(() => {});
      if (page.isClosed()) return;
      ui.ok(`Verifikasi OTP lolos -> ${shortUrl(page.url())}`);
      return;
    }

    const otpError = page
      .getByText(/kode salah|wrong code|tidak valid|invalid code|coba lagi|try again/i)
      .first();
    if (await otpError.isVisible().catch(() => false)) {
      const errMsg = (await otpError.innerText().catch(() => 'Kode OTP ditolak')).trim();
      ui.warn(`Peringatan OTP: "${errMsg}"`);
      if (attempt === 0) {
        await ui.countdown((Math.min(remaining, 30) + 2) * 1000, 'Tunggu siklus OTP baru');
        continue;
      }
      throw new Error(`OTP Google Authenticator ditolak ("${errMsg}").`);
    }
  }
}

async function promptUserForOtpOrSecret(promptMessage) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(promptMessage, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

// ============================================================================
// ROTASI GOOGLE AUTHENTICATOR
// ============================================================================
async function rotateAuthenticator(page, getPassword, getOtp, googleClockOffsetFn, email) {
  ui.step('09', 'Membuka setelan Google Authenticator...');
  await page.goto(AUTH_SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const pwdSelector =
    'input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([name="hiddenPassword"]):not([aria-hidden="true"])';
  const totpReAuthSelector =
    'input[name="totpPin"], #totpPin, input[type="tel"][autocomplete="one-time-code"], input[aria-label*="code" i], input[aria-label*="kode" i]';

  // Re-auth jika diminta di halaman authenticator
  for (let reAuth = 0; reAuth < 10; reAuth++) {
    const hasChangeAppBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.locator('button, [role="button"], a').filter({
        hasText: /ubah aplikasi pengautentikasi|change authenticator app|setup authenticator|konfigurasikan pengautentikasi/i,
      })
    );
    if (hasChangeAppBtn) break;

    const inlinePwd = await findVisibleLocatorInAllFrames(page, (scope) => scope.locator(pwdSelector));
    if (inlinePwd) {
      ui.sub('Re-auth sandi sebelum ubah Authenticator...');
      await inlinePwd.locator.fill(await getPassword()).catch(() => {});
      const nextBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.locator('#passwordNext, button:has-text("Berikutnya"), button:has-text("Next")')
      );
      if (nextBtn) await nextBtn.locator.click().catch(() => {});
      else await inlinePwd.locator.press('Enter').catch(() => {});
      await page.waitForTimeout(2500);
      continue;
    }

    const challengeVisible = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.locator(`${totpReAuthSelector}, button:has-text("Cara lainnya"), a:has-text("Cara lainnya"), button:has-text("Coba cara lain"), div:has-text("Periksa")`)
    );
    if (challengeVisible || page.url().includes('/challenge/')) {
      ui.sub('Verifikasi re-auth terdeteksi (Device prompt / TOTP)...');
      await submitTotpChallenge(page, getOtp, googleClockOffsetFn);
      await page.waitForTimeout(2500);
      continue;
    }

    await page.waitForTimeout(1000);
  }

  ui.step('10', 'Mengklik "Ubah aplikasi pengautentikasi"...');
  let changeAppBtn = null;
  for (let t = 0; t < 15; t++) {
    changeAppBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.locator('button, [role="button"], a').filter({
        hasText: /ubah aplikasi pengautentikasi|change authenticator app|setup authenticator|konfigurasikan pengautentikasi/i,
      })
    );
    if (changeAppBtn) break;
    await page.waitForTimeout(1000);
  }

  if (!changeAppBtn) {
    throw new Error('Tombol "Ubah aplikasi pengautentikasi" tidak ditemukan di halaman setting authenticator.');
  }

  await changeAppBtn.locator.scrollIntoViewIfNeeded().catch(() => {});
  await changeAppBtn.locator.click();
  await page.waitForTimeout(2000);

  ui.step('11', 'Menampilkan QR Code Authenticator & Menunggu Input Pengguna...');
  const qrShotPath = path.resolve(process.cwd(), 'qr-code.png');
  await page.screenshot({ path: qrShotPath, fullPage: true }).catch(() => {});
  ui.ok(`Screenshot QR Code tersimpan di: ${qrShotPath}`);

  if (SAVE_ERROR_TO_SDCARD) {
    const downloadDir = resolveDownloadDir();
    if (downloadDir) {
      const publicQrShot = path.join(downloadDir, 'qr-code.png');
      fs.copyFileSync(qrShotPath, publicQrShot);
      ui.ok(`Tersalin ke Download HP: ${publicQrShot}`);
    }
  }

  ui.warn('========================================================================');
  ui.warn(' SILAKAN SCAN QR CODE PADA SCREENSHOT (qr-code.png) DI HP ANDA ');
  ui.warn('========================================================================');

  const userInput = await promptUserForOtpOrSecret(
    '\n👉 Masukkan 6-digit kode verifikasi (atau 32-char secret) dari Google Authenticator baru: '
  );

  let newSecret = '';
  let otpCode = '';
  const cleanedInput = userInput.replace(/[\s=-]+/g, '').toUpperCase();

  if (/^\d{6}$/.test(cleanedInput)) {
    otpCode = cleanedInput;
    newSecret = 'MANUAL_SCANNED_SECRET';
  } else if (/^(?=.*[2-7])[A-Z2-7]{16,32}$/.test(cleanedInput)) {
    newSecret = cleanedInput;
    const clockOffset = googleClockOffsetFn ? googleClockOffsetFn() : 0;
    let newOtpObj = generateTOTP(newSecret, 30, 6, clockOffset);
    if (newOtpObj.remaining <= 5) {
      ui.sub(`Sisa waktu OTP baru terlalu singkat (${newOtpObj.remaining}s), menunggu siklus baru...`);
      await ui.countdown((newOtpObj.remaining + 1) * 1000, 'Siklus OTP baru');
      newOtpObj = generateTOTP(newSecret, 30, 6, clockOffset);
    }
    otpCode = newOtpObj.otp;
  } else {
    throw new Error(`Input tidak valid: "${userInput}" (harus 6-digit OTP atau 32-char secret Base32).`);
  }

  ui.step('12', `Mengirim kode verifikasi (${otpCode})...`);

  // Klik Berikutnya (Next) pada modal QR Code
  const nextBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
    scope.locator('button, [role="button"]').filter({ hasText: /berikutnya|next/i })
  );
  if (nextBtn) {
    await nextBtn.locator.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  const otpInput = page.locator('input[type="text"], input[type="tel"]').first();
  await otpInput.waitFor({ state: 'visible', timeout: 10000 });
  await otpInput.fill(otpCode);
  await page.waitForTimeout(500);

  const verifyBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
    scope.locator('button, [role="button"]').filter({ hasText: /verifikasi|verify|selesai|done/i })
  );
  if (verifyBtn) {
    await verifyBtn.locator.click();
  } else {
    await otpInput.press('Enter');
  }
  await page.waitForTimeout(4000);

  const authErrorRegex = /kode salah|wrong code|tidak valid|invalid code|coba lagi|try again|terjadi kesalahan|an error occurred/i;
  const hasAuthError = await findVisibleLocatorInAllFrames(page, (scope) =>
    scope.getByText(authErrorRegex)
  );
  if (hasAuthError) {
    const errText = await hasAuthError.locator.innerText().catch(() => 'Kode verifikasi ditolak');
    throw new Error(`Google menolak verifikasi Authenticator baru: "${errText.trim()}"`);
  }

  ui.ok('Google Authenticator berhasil diubah dan diverifikasi!');
  saveBerhasilResult(email, NEW_PASSWORD, newSecret);
}

// ============================================================================
// PROCESS ACCOUNT: LOGIN, CHANGE PASSWORD & ROTATE AUTHENTICATOR
// ============================================================================
async function processAccount(account, index, total, stats) {
  const accountStart = Date.now();
  let parsedAccount;
  try {
    parsedAccount = parseAccountEntry(account, index);
  } catch (parseErr) {
    ui.accountHeader(index, total, stats, `akun #${index + 1} (Format Tidak Valid)`);
    stats.failed += 1;
    ui.fail(`Error akun #${index + 1}: ${parseErr.message}`);
    ui.accountDone(index, total, false, Date.now() - accountStart, 'Validasi Format');
    return;
  }

  const useWebsiteTab = parsedAccount.mode === 'website_tab';
  const resolvedUrl = parsedAccount.url || '';
  const accountLabel = useWebsiteTab ? `akun #${index + 1}` : parsedAccount.email;
  const headerSource = useWebsiteTab
    ? `akun #${index + 1} • Tab Website`
    : `${parsedAccount.email} • 2FA Base32 (${extractBase32Secret(parsedAccount.totpSecret).length} char)`;

  ui.accountHeader(index, total, stats, headerSource);
  ui.spin(`Menyiapkan browser Chromium untuk ${accountLabel}...`);

  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--disable-blink-features=AutomationControlled',
      '--disable-popup-blocking',
      '--window-size=1280,900',
    ],
  });

  const context = await browser.newContext({
    locale: BROWSER_LOCALE,
    viewport: { width: 1280, height: 900 },
    permissions: useWebsiteTab ? ['clipboard-read', 'clipboard-write'] : [],
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.__lastCopiedText = '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text) => {
        window.__lastCopiedText = String(text ?? '');
        try { return await origWrite(text); } catch { return undefined; }
      };
    }
  });

  let sourcePage = null;
  if (useWebsiteTab) {
    if (!resolvedUrl || !/^https?:\/\//i.test(resolvedUrl)) {
      throw new Error(`Link website untuk ${accountLabel} tidak valid.`);
    }
    sourcePage = await context.newPage();
    ui.step('TAB-1', `Membuka link sumber (URL disensor)`);
    await sourcePage.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sourcePage.waitForTimeout(2000);
  } else {
    ui.info(`Mode Direct Credentials: ${parsedAccount.email}`);
  }

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  let googleClockOffsetMs = 0;

  page.on('response', (res) => {
    try {
      if (res.url().includes('google.com')) {
        const dateHdr = res.headers()['date'];
        if (dateHdr) {
          const serverMs = Date.parse(dateHdr);
          if (!Number.isNaN(serverMs)) googleClockOffsetMs = serverMs - Date.now();
        }
      }
    } catch {}
  });

  const getEmail = async () =>
    useWebsiteTab ? fetchFromSourceTab(sourcePage, page, 'email') : parsedAccount.email;
  const getPassword = async () =>
    useWebsiteTab ? fetchFromSourceTab(sourcePage, page, 'password') : parsedAccount.password;
  const getOtp = async () => {
    if (useWebsiteTab) {
      const liveOtp = await fetchFromSourceTab(sourcePage, page, 'totp');
      return { otp: liveOtp, remaining: 30, serverIso: new Date(Date.now() + googleClockOffsetMs).toISOString() };
    }
    let res = generateTOTP(parsedAccount.totpSecret, 30, 6, googleClockOffsetMs);
    if (res.remaining <= 5) {
      await ui.countdown((res.remaining + 1) * 1000, 'Siklus OTP baru');
      res = generateTOTP(parsedAccount.totpSecret, 30, 6, googleClockOffsetMs);
    }
    ui.sub(`Hash TOTP (${res.secretLength}-char) -> ${res.otp} (sisa ${res.remaining}s)`);
    return res;
  };

  let currentStep = 'Inisialisasi';
  let activeDebugPage = page;

  try {
    // 1. Buka URL Target Ganti Sandi Langsung
    currentStep = 'Langkah 1: Buka URL Ganti Sandi';
    ui.step('01', 'Membuka halaman Ubah Sandi Google...');
    await page.goto(PASSWORD_CHANGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(STEP_DELAY_MS);

    // 2. Jika redirect ke halaman login
    if (page.url().includes('accounts.google.com')) {
      ui.sub(`Redirect login terdeteksi: ${shortUrl(page.url())}`);

      currentStep = 'Langkah 2: Input Email';
      ui.step('02', 'Memasukkan email...');
      const emailValue = await getEmail();
      const emailInput = page.locator('input[type="email"], #identifierId').first();
      await emailInput.waitFor({ state: 'visible', timeout: 25000 });
      await emailInput.fill(emailValue);
      await page.locator('#identifierNext, button:has-text("Berikutnya"), button:has-text("Next")').first().click();
      await page.waitForTimeout(STEP_DELAY_MS);

      currentStep = 'Langkah 3: Input Password';
      ui.step('03', 'Memasukkan password...');
      const pwdValue = await getPassword();
      const pwdInput = page
        .locator('input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([name="hiddenPassword"]):not([aria-hidden="true"])')
        .first();
      await pwdInput.waitFor({ state: 'visible', timeout: 25000 });
      await pwdInput.fill(pwdValue);
      await page.locator('#passwordNext, button:has-text("Berikutnya"), button:has-text("Next")').first().click();
      await page.waitForTimeout(STEP_DELAY_MS);

      currentStep = 'Langkah 4: Verifikasi Google Authenticator';
      ui.step('04', 'Verifikasi Google Authenticator...');
      await submitTotpChallenge(page, getOtp, () => googleClockOffsetMs);
      await page.waitForTimeout(3000);
    }

    // 3. Lewati pop-up pasca login jika ada
    currentStep = 'Langkah 5: Lewati Pop-up Pasca Login';
    ui.step('05', 'Mengecek & melewati pop-up pasca login...');
    const primarySkipRegex =
      /\b(skip|lewati|lain kali|not now|nanti saja|tidak sekarang|lain kali saja|no thanks|tidak, terima kasih|jangan aktifkan|don['’]t turn on|skip for now|lewati sekarang)\b/i;

    for (let attempt = 0; attempt < 8; attempt++) {
      if (page.url().includes('/signinoptions/password')) break;
      const foundSkip = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.locator('button, a, [role="button"], [role="link"]').filter({ hasText: primarySkipRegex })
      );
      if (foundSkip) {
        await foundSkip.locator.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(2000);
      } else {
        await page.waitForTimeout(1500);
      }
    }

    if (!page.url().includes('/signinoptions/password')) {
      ui.sub('Mengarahkan ulang ke URL ganti sandi...');
      await page.goto(PASSWORD_CHANGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
    }

    // 4. Deteksi re-auth / verifikasi tambahan sebelum ubah sandi
    currentStep = 'Langkah 6: Verifikasi Re-Auth Ganti Sandi';
    ui.step('06', 'Memeriksa apakah Google meminta verifikasi re-auth password/TOTP...');
    const pwdSelector =
      'input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([name="hiddenPassword"]):not([aria-hidden="true"])';
    const totpReAuthSelector =
      'input[name="totpPin"], #totpPin, input[type="tel"][autocomplete="one-time-code"], input[aria-label*="code" i], input[aria-label*="kode" i]';

    for (let reAuthCheck = 0; reAuthCheck < 15; reAuthCheck++) {
      const hasNewPwdField = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.locator('input[name="password"], input[name="NewPassword"], input[type="password"]')
      );
      if (hasNewPwdField) {
        ui.info('Form sandi baru sudah langsung terbuka.');
        break;
      }

      const inlinePwd = await findVisibleLocatorInAllFrames(page, (scope) => scope.locator(pwdSelector));
      if (inlinePwd) {
        ui.sub('Memasukkan password untuk re-auth...');
        await inlinePwd.locator.fill(await getPassword()).catch(() => {});
        const nextBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.locator('#passwordNext, button:has-text("Berikutnya"), button:has-text("Next")')
        );
        if (nextBtn) await nextBtn.locator.click().catch(() => {});
        else await inlinePwd.locator.press('Enter').catch(() => {});
        await page.waitForTimeout(2500);
        continue;
      }

      const inlineTotp = await findVisibleLocatorInAllFrames(page, (scope) => scope.locator(totpReAuthSelector));
      if (inlineTotp) {
        ui.sub('Menyelesaikan verifikasi TOTP re-auth...');
        await submitTotpChallenge(page, getOtp, () => googleClockOffsetMs);
        await page.waitForTimeout(2500);
        continue;
      }

      await page.waitForTimeout(1000);
    }

    // 5. Masukkan Password Baru & Konfirmasi Password Baru (impura123456)
    currentStep = 'Langkah 7: Masukkan Password Baru';
    ui.step('07', `Mengisi password baru dengan "${NEW_PASSWORD}"...`);

    let newPwdInput = null;
    let confirmPwdInput = null;

    for (let t = 0; t < 20; t++) {
      const scopes = [page, ...page.frames()];
      for (const scope of scopes) {
        const inputs = scope.locator('input[type="password"]');
        const count = await inputs.count().catch(() => 0);
        if (count >= 2) {
          newPwdInput = inputs.nth(0);
          confirmPwdInput = inputs.nth(1);
          break;
        } else if (count === 1) {
          const inp = inputs.nth(0);
          const nameAttr = await inp.getAttribute('name').catch(() => '');
          const labelAttr = await inp.getAttribute('aria-label').catch(() => '');
          if (/new|baru/i.test(nameAttr + labelAttr)) {
            newPwdInput = inp;
          } else if (/confirm|konfirmasi/i.test(nameAttr + labelAttr)) {
            confirmPwdInput = inp;
          } else if (!newPwdInput) {
            newPwdInput = inp;
          } else if (!confirmPwdInput) {
            confirmPwdInput = inp;
          }
        }
      }
      if (newPwdInput && confirmPwdInput) break;
      await page.waitForTimeout(1000);
    }

    if (!newPwdInput || !confirmPwdInput) {
      throw new Error('Kolom input password baru / konfirmasi tidak ditemukan.');
    }

    await newPwdInput.scrollIntoViewIfNeeded().catch(() => {});
    await newPwdInput.fill(NEW_PASSWORD);
    await page.waitForTimeout(400);

    await confirmPwdInput.scrollIntoViewIfNeeded().catch(() => {});
    await confirmPwdInput.fill(NEW_PASSWORD);
    await page.waitForTimeout(600);
    ui.ok('Password baru berhasil diisi pada kedua kolom.');

    // 6. Klik Ubah Sandi / Change password
    currentStep = 'Langkah 8: Klik Ubah Sandi';
    ui.step('08', 'Mengklik tombol "Ubah sandi" / "Change password"...');

    const changeBtnRegex = /ubah sandi|change password|simpan sandi|save password|simpan|save/i;
    const submitBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.locator('button, [role="button"], input[type="submit"]').filter({ hasText: changeBtnRegex })
    );

    if (!submitBtn) {
      throw new Error('Tombol "Ubah sandi" (Change password) tidak ditemukan.');
    }

    if (DRY_RUN) {
      ui.warn('[DRY_RUN] Berhenti sebelum klik Ubah Sandi.');
    } else {
      await submitBtn.locator.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await submitBtn.locator.click({ timeout: 5000 });
      } catch {
        await submitBtn.locator.click({ force: true, timeout: 5000 }).catch(async () => {
          await submitBtn.locator.evaluate((el) => el.click());
        });
      }
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(3000);

      const alreadyUsedRegex = /anda sudah menggunakan sandi ini baru-baru ini|you['’]ve already used this password recently|pilih yang lain|choose another/i;
      const hasAlreadyUsed = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.getByText(alreadyUsedRegex)
      );

      if (hasAlreadyUsed) {
        ui.info('Sandi sudah pernah digunakan sebelumnya — lanjut langsung ke Authenticator...');
      } else {
        const passwordErrorRegex = /sandi tidak cocok|password doesn['’]t match|minimal|minimum|harus|must|coba lagi|try again|terjadi kesalahan|an error occurred|salah|wrong/i;
        const hasPwdError = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.getByText(passwordErrorRegex)
        );
        if (hasPwdError) {
          const errText = await hasPwdError.locator.innerText().catch(() => 'Gagal mengubah sandi');
          throw new Error(`Google menolak perubahan sandi: "${errText.trim()}"`);
        }
        ui.ok('Password berhasil diubah menjadi impura123456!');
      }
    }

    // 7. Lanjut mengubah Google Authenticator
    const activeEmail = useWebsiteTab ? await getEmail() : parsedAccount.email;
    await rotateAuthenticator(page, getPassword, getOtp, () => googleClockOffsetMs, activeEmail);

    stats.success += 1;
    ui.accountDone(index, total, true, Date.now() - accountStart, 'Sandi & Authen Berhasil Diubah');
  } catch (err) {
    stats.failed += 1;
    ui.fail(`Error ${accountLabel}: ${err.message}`);
    const targetShotPage = activeDebugPage && !activeDebugPage.isClosed() ? activeDebugPage : page;
    await saveDiagnosticScreenshot(targetShotPage, account, index, currentStep);
    ui.accountDone(index, total, false, Date.now() - accountStart, currentStep);
  } finally {
    ui.stopSpin();
    await browser.close();
  }
}

async function main() {
  const accountsPath = path.resolve(process.cwd(), 'accounts.json');
  if (!fs.existsSync(accountsPath)) {
    throw new Error('File accounts.json tidak ditemukan.');
  }

  const accounts = loadAccounts(accountsPath);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('accounts.json harus berisi minimal 1 akun.');
  }

  const stats = { success: 0, failed: 0 };
  const startedAt = Date.now();

  process.on('SIGINT', () => {
    ui.stopSpin();
    ui.warn('Dihentikan oleh pengguna (SIGINT).');
    process.exit(130);
  });

  ui.banner(accounts.length);

  for (let i = 0; i < accounts.length; i++) {
    await processAccount(accounts[i], i, accounts.length, stats);
  }

  ui.summary(accounts.length, stats, Date.now() - startedAt);
}

main().catch((err) => {
  ui.stopSysExit?.();
  ui.fail(`Fatal error: ${err.message || err}`);
  process.exit(1);
});
