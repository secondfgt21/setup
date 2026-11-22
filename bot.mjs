/**
 * Google Payments Profile Auto-Closer untuk Termux (Playwright Core)
 * Menjalankan 12 langkah otomatis + konverter Base32 Secret -> 6-digit TOTP.
 *
 * Jalankan: node bot.mjs
 * Opsional override path Chromium: CHROMIUM_PATH=/path/to/chromium node bot.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

// PATCH WAJIB TERMUX NATIVE:
// playwright-core melempar "Error: Unsupported platform: android" saat inisialisasi
// jika process.platform === 'android'. Patch ke 'linux' SEBELUM dynamic import().
if (process.platform === 'android') {
  Object.defineProperty(process, 'platform', {
    value: 'linux',
    configurable: true,
  });
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ||= '1';
  process.env.XDG_CACHE_HOME ||= path.join(os.homedir(), '.cache');
}

const { chromium } = await import('playwright-core');

const SETTINGS_URL = 'https://payments.google.com/gp/w/u/0/home/settings';
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
        `${C.bold}${C.brightCyan}GPAY AUTO-CLOSER & FAMILY CLEANER${C.reset}`,
        `${C.dim}Total Antrean: ${C.white}${totalAccounts} akun${C.dim}  •  Mode: ${C.brightGreen}${HEADLESS ? 'Headless' : 'UI'}${C.reset}`,
      ],
      C.brightCyan
    );
  },

  accountHeader(index, total, stats) {
    const ratio = index / Math.max(1, total);
    const pct = Math.round(ratio * 100);
    const bar = buildBar(ratio, 12);
    this.box(
      [
        `${C.bold}${C.white}AKUN [${index + 1}/${total}]${C.reset}  ${bar} ${C.brightCyan}${pct}%${C.reset}`,
        `${C.dim}Sumber :${C.reset} ${C.white}akun #${index + 1} (accounts.json)${C.reset}`,
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
        `${C.bold}${C.brightGreen}RINGKASAN EKSEKUSI${C.reset}  ${bar} ${C.brightCyan}100%${C.reset}`,
        `${C.dim}Total Akun :${C.reset} ${C.white}${total}${C.reset}  ${C.dim}(${formatDuration(totalMs)})${C.reset}`,
        `${C.brightGreen}✓ Sukses   :${C.reset} ${stats.success}  ${C.dim}(Tutup: ${stats.closed}, Kosong: ${stats.noProfile})${C.reset}`,
        `${C.brightRed}✗ Gagal    :${C.reset} ${stats.failed}`,
        `${C.cyan}★ Family   :${C.reset} ${stats.familyMembersRemoved} anggota dihapus`,
      ],
      stats.failed === 0 ? C.brightGreen : C.yellow
    );
  },
};

// ============================================================================
// KONVERTER BASE32 SECRET KEY -> 6-DIGIT GOOGLE AUTHENTICATOR TOTP (RFC 6238)
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
    throw new Error('totpSecret di accounts.json kosong!');
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
  const key = base32ToBuffer(secret);
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
    serverIso: new Date(nowMs).toISOString(),
  };
}

// ============================================================================
// HELPER AMBIL DATA DARI TAB WEBSITE SUMBER (EMAIL, PASSWORD, LIVE TOTP)
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
    // 1. Jika mengambil Live TOTP dan ada countdown "Xs tersisa", tunggu jika <= 4 detik
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

      // Coba klik tombol "SALIN KODE OTP" jika tersedia
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

    // 2. Untuk Email & Password, klik tombol Copy/Salin di sebelah field atau tombol SALIN RAW
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
        // Pola Impura: [0]=Copy Email, [1]=Copy Password, [2]=Copy Authen Key
        await resetClipboardHook();
        await copyButtons.nth(1).click();
        await sourcePage.waitForTimeout(350);
        const clipPass = await readClipboard();
        if (clipPass && !/^[•*]+$/.test(clipPass.trim())) {
          extracted = clipPass.trim();
        }
      }

      // Fallback: tombol "SALIN RAW (EMAIL---PASS---2FA)"
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

    // 3. Fallback deteksi DOM langsung (isolasi TextNode agar tidak tercampur teks tombol Salin/Copy)
    if (!extracted) {
      extracted = await sourcePage.evaluate((targetKind) => {
        const bodyText = document.body ? document.body.innerText : '';

        if (targetKind === 'email') {
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
          // Cek input/textarea terlebih dahulu
          for (const inp of document.querySelectorAll('input, textarea')) {
            const m = String(inp.value || '').trim().match(emailRegex);
            if (m) return m[0];
          }
          // Telusuri TextNode satu per satu (abaikan teks di dalam <button>)
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (parent && parent.closest('button, [role="button"], script, style')) continue;
            const txt = String(node.nodeValue || '').trim();
            const m = txt.match(emailRegex);
            if (m) return m[0];
          }
          // Fallback terakhir lewat innerText (mempertahankan batas baris/elemen)
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
    throw new Error(`Gagal mengambil "${kind}" dari website sumber (link accounts.json disensor). Isi Selector ${kind} di Konfigurasi jika perlu.`);
  }
  ui.ok(`Ambil ${kind} dari Tab Website (disensor)`);
  return extracted;
}

// ============================================================================
// DETEKSI CHROMIUM TERMUX / PROOT-DISTRO
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
    // Ignore if playwright-core cannot resolve default executable
  }
  throw new Error(
    'Binary Chromium tidak ditemukan! Jalankan setup-termux.sh atau set CHROMIUM_PATH.'
  );
}

// ============================================================================
// HELPER PENCARIAN ELEMENT DI PAGE UTAMA & SEMUA IFRAME GOOGLE PAYMENTS
// ============================================================================
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
      // Abaikan frame yang sedang navigasi
    }
  }
  return null;
}

async function scrollAllFramesToBottom(page) {
  await page.keyboard.press('End').catch(() => {});
  const scopes = [page, ...page.frames()];
  for (const scope of scopes) {
    try {
      await scope.evaluate(async () => {
        window.scrollBy(0, 1200);
        window.scrollTo(0, document.body ? document.body.scrollHeight : 99999);
        const scrollTargets = [
          document.scrollingElement,
          document.documentElement,
          document.body,
          ...Array.from(document.querySelectorAll('[role="dialog"], main, section, div')).filter(
            (el) => el.scrollHeight > el.clientHeight + 20
          ),
        ].filter(Boolean);

        for (const el of scrollTargets) {
          el.scrollTop = el.scrollHeight;
        }
      });
    } catch {
      // Frame mungkin cross-origin atau tertutup
    }
  }
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
      // Coba direktori berikutnya
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
      } else {
        ui.warn('Folder Download belum bisa diakses. Jalankan "termux-setup-storage" di Termux.');
      }
    }
  } catch (shotErr) {
    ui.warn(`Gagal mengambil screenshot: ${shotErr.message}`);
  }

  try {
    const title = await page.title().catch(() => '-');
    const frames = page.frames().map((f, i) => `[${i}] ${shortUrl(f.url())}`);
    ui.sub(`Langkah gagal : ${currentStep}`);
    ui.sub(`URL terakhir  : ${shortUrl(page.url())}`);
    ui.sub(`Judul halaman : ${title}`);
    ui.sub(`Frame aktif   : ${frames.length} (${frames.slice(0, 3).join(', ')})`);

    const snippets = [];
    for (const scope of [page, ...page.frames()]) {
      const txt = await scope
        .evaluate(() => (document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : ''))
        .catch(() => '');
      if (txt) snippets.push(txt.slice(0, 260));
    }
    if (snippets.length > 0) {
      ui.sub(`Teks layar    : ${snippets.join(' | ').slice(0, 220)}`);
    }
  } catch {
    // Abaikan error logging tambahan
  }
}

async function submitTotpChallenge(page, getOtpFn, getClockOffsetFn) {
  const totpInputSelector =
    'input[name="totpPin"], #totpPin, input[type="tel"][autocomplete="one-time-code"], input[aria-label*="code" i], input[aria-label*="kode" i]';
  const tryAnotherSelector =
    'button:has-text("Coba cara lain"), button:has-text("Cara lainnya"), button:has-text("Try another way"), button:has-text("More ways"), a:has-text("Cara lainnya"), [role="button"]:has-text("Coba cara lain"), [role="button"]:has-text("Cara lainnya"), [role="button"]:has-text("Try another way")';

  // Tunggu halaman verifikasi 2 langkah selesai dimuat (salah satu elemen tantangan muncul)
  await page
    .locator(`${totpInputSelector}, ${tryAnotherSelector}`)
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => {});

  let totpInput = page.locator(totpInputSelector).first();
  if (!(await totpInput.isVisible().catch(() => false))) {
    const tryAnotherBtn = page.locator(tryAnotherSelector).first();

    if (await tryAnotherBtn.isVisible().catch(() => false)) {
      ui.sub('Klik "Coba cara lain" untuk memilih Google Authenticator...');
      await tryAnotherBtn.click();
      await page.waitForTimeout(1800);
    }

    const authOption = page
      .locator(
        'li:has-text("Authenticator"), div[role="link"]:has-text("Authenticator"), div[data-challengetype="6"], button:has-text("Authenticator"), [role="listitem"]:has-text("Authenticator")'
      )
      .first();

    if (await authOption.isVisible().catch(() => false)) {
      await authOption.click();
      await page.waitForTimeout(1800);
    }
  }

  totpInput = page.locator(totpInputSelector).first();
  await totpInput.waitFor({ state: 'visible', timeout: 20000 });

  for (let attempt = 0; attempt < 2; attempt++) {
    const { otp, remaining, serverIso } = await getOtpFn();
    const offsetSec = Math.round((getClockOffsetFn ? getClockOffsetFn() : 0) / 1000);
    ui.sub(`Sinkronisasi waktu Google: ${serverIso.slice(11, 19)}Z (selisih ${offsetSec}s)`);
    ui.ok(`Memasukkan OTP 6-digit: ${C.bold}${otp}${C.reset}${C.green} (sisa ${remaining}s)`);
    ui.spin('Mengirim & memverifikasi kode OTP...');

    await totpInput.click();
    await totpInput.fill('');
    await totpInput.type(otp, { delay: 75 });
    await page.waitForTimeout(400);

    const nextBtn = page
      .locator('#totpNext button, #totpNext, button:has-text("Berikutnya"), button:has-text("Next")')
      .first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
    } else {
      await totpInput.press('Enter');
    }

    // Tunggu URL berpindah dari /challenge/totp
    const moved = await page
      .waitForURL((u) => !u.href.includes('/challenge/totp'), { timeout: 12000 })
      .then(() => true)
      .catch(() => false);

    if (moved) {
      await page.waitForTimeout(1500);
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
      throw new Error(`OTP Google Authenticator ditolak Google ("${errMsg}"). Cek Base32 Secret Key atau mode Tab Website.`);
    }
  }

  ui.sub(`URL setelah submit OTP: ${shortUrl(page.url())}`);
}

// ============================================================================
// LANGKAH 13: KOSONGKAN GOOGLE FAMILY (SISAKAN 1 PENGELOLA AKUN KELUARGA)
// ============================================================================
async function cleanupGoogleFamily(page, accountLabel, getPassword, getOtp, getClockOffsetFn, setStepFn) {
  const FAMILY_URL = 'https://myaccount.google.com/family/details';
  let removedCount = 0;
  setStepFn('Langkah 13: Cek & Kosongkan Google Family');
  ui.step('13', `Membuka Google Family (${shortUrl(FAMILY_URL)})`);
  await page.goto(FAMILY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const emptyFamilyRegex =
    /you can create a family group|get started|anda dapat membuat grup keluarga|buat grup keluarga/i;
  const managerRoleRegex = /pengelola akun keluarga|family manager/i;
  const pwdSelector =
    'input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([name="hiddenPassword"]):not([aria-hidden="true"])';
  const totpInputSelector =
    'input[name="totpPin"], #totpPin, input[type="tel"][autocomplete="one-time-code"], input[aria-label*="code" i], input[aria-label*="kode" i]';
  const tryAnotherSelector =
    'button:has-text("Coba cara lain"), button:has-text("Cara lainnya"), button:has-text("Try another way"), button:has-text("More ways"), a:has-text("Cara lainnya"), [role="button"]:has-text("Coba cara lain"), [role="button"]:has-text("Cara lainnya"), [role="button"]:has-text("Try another way")';

  const isEmptyFamilyScreen = async () => {
    const hasManagerOrMember = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.getByText(/pengelola akun keluarga|family manager|^\s*(anggota|member)\s*$/i)
    );
    if (hasManagerOrMember) return false;
    const hasEmptyText = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.getByText(emptyFamilyRegex)
    );
    return Boolean(hasEmptyText);
  };

  // Tunggu tampilan Family termuat
  for (let w = 0; w < 10; w++) {
    if (await isEmptyFamilyScreen()) {
      ui.info(`Family ${accountLabel} sudah kosong (belum ada grup)`);
      return { removed: removedCount };
    }
    const hasList = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.getByText(/keluarga anda di google|your family on google|pengelola akun keluarga|family manager/i)
    );
    if (hasList) break;
    await page.waitForTimeout(1000);
  }

  if (await isEmptyFamilyScreen()) {
    ui.info(`Family ${accountLabel} sudah kosong (belum ada grup)`);
    return { removed: removedCount };
  }

  for (let round = 0; round < 10; round++) {
    if (!page.url().includes('/family/details')) {
      await page.goto(FAMILY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2000);
    }

    if (await isEmptyFamilyScreen()) {
      ui.ok(`Family ${accountLabel} sudah kosong`);
      return { removed: removedCount };
    }

    // Cari baris email yang memiliki label "Anggota" / "Member" (bukan "Pengelola akun keluarga")
    const memberLabelText = await page.evaluate(() => {
      document
        .querySelectorAll('[data-bot-family-member]')
        .forEach((el) => el.removeAttribute('data-bot-family-member'));

      const roleLineRegex = /^(?:anggota|member)$/i;
      const excludeRegex =
        /pengelola akun keluarga|family manager|kirim undangan|send invitation|detail anggota|family member details/i;
      const candidates = Array.from(
        document.querySelectorAll('a, button, [role="button"], [role="link"], [role="listitem"], li, div[jsaction], div')
      );

      let best = null;
      let bestLen = Infinity;
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 28 || rect.height > 200) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const text = (el.innerText || '').trim();
        if (!text || excludeRegex.test(text)) continue;
        const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        if (!lines.some((l) => roleLineRegex.test(l))) continue;
        if (text.length < bestLen) {
          best = el;
          bestLen = text.length;
        }
      }
      if (best) {
        best.setAttribute('data-bot-family-member', '1');
        return best.innerText.replace(/\s+/g, ' ').trim();
      }
      return '';
    });

    if (!memberLabelText) {
      const hasManager = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.getByText(managerRoleRegex)
      );
      if (hasManager) {
        ui.ok(`Family bersih — tersisa 1 Pengelola akun keluarga`);
        return { removed: removedCount };
      }
      if (await isEmptyFamilyScreen()) {
        ui.info(`Family ${accountLabel} sudah kosong`);
        return { removed: removedCount };
      }
      throw new Error('Daftar anggota Family tidak terbaca di halaman family/details.');
    }

    setStepFn(`Langkah 13: Hapus Anggota Family (${memberLabelText})`);
    ui.sub(`[Family #${round + 1}] Pilih anggota: "${memberLabelText}"`);
    ui.spin(`Membuka detail anggota Family #${round + 1}...`);
    const memberBtn = page.locator('[data-bot-family-member="1"]').first();
    await memberBtn.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await memberBtn.click({ timeout: 5000 });
    } catch {
      await memberBtn.click({ force: true, timeout: 5000 });
    }
    await page.waitForTimeout(2000);

    // Pict 2: Klik "Hapus anggota" / "Remove member"
    const removeMemberBtn = await (async () => {
      for (let t = 0; t < 15; t++) {
        const found =
          (await findVisibleLocatorInAllFrames(page, (scope) =>
            scope.locator('button, a, [role="button"], [role="link"]').filter({
              hasText: /^\s*(hapus anggota|remove member)\s*$/i,
            })
          )) ||
          (await findVisibleLocatorInAllFrames(page, (scope) =>
            scope.getByText(/hapus anggota|remove member/i)
          ));
        if (found) return found;
        await page.waitForTimeout(1000);
      }
      return null;
    })();

    if (!removeMemberBtn) {
      throw new Error(`Tombol "Hapus anggota" tidak ditemukan untuk "${memberLabelText}".`);
    }

    ui.sub('Klik tombol "Hapus anggota"...');
    await removeMemberBtn.locator.scrollIntoViewIfNeeded().catch(() => {});
    await removeMemberBtn.locator.click();
    await page.waitForTimeout(2000);

    // Pict 3 & Pict 4: Smart Re-Auth (Password saja, Authenticator saja, keduanya, atau tanpa verifikasi ulang)
    const confirmRemoveBtnSelector = 'button, [role="button"]';
    const confirmHeaderRegex =
      /hapus anggota keluarga|remove family member|perubahan pada grup keluarga|changes to your family group/i;

    let readyToConfirmRemove = false;
    for (let authStep = 0; authStep < 30; authStep++) {
      // Cek apakah sudah sampai di halaman Pict 5 ("Hapus anggota keluarga?" + tombol "Hapus")
      const hasConfirmText = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.getByText(confirmHeaderRegex)
      );
      const hasConfirmBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.locator(confirmRemoveBtnSelector).filter({ hasText: /^\s*(hapus|remove)\s*$/i })
      );
      if (hasConfirmText && hasConfirmBtn) {
        readyToConfirmRemove = true;
        break;
      }

      // Cek apakah form Password muncul (Pict 3)
      const pwdLoc = await findVisibleLocatorInAllFrames(page, (scope) => scope.locator(pwdSelector));
      if (pwdLoc) {
        ui.sub('[Smart Auth] Form password terdeteksi, mengisi password...');
        await pwdLoc.locator.fill(await getPassword());
        const nextBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.locator('#passwordNext, button:has-text("Berikutnya"), button:has-text("Next")')
        );
        if (nextBtn) {
          await nextBtn.locator.click();
        } else {
          await pwdLoc.locator.press('Enter');
        }
        await page.waitForTimeout(2500);
        continue;
      }

      // Cek apakah form Google Authenticator / 2SV muncul (Pict 4)
      const totpVisible = await page.locator(totpInputSelector).first().isVisible().catch(() => false);
      const tryOtherVisible =
        page.url().includes('accounts.google.com') &&
        (await page.locator(tryAnotherSelector).first().isVisible().catch(() => false));

      if (totpVisible || tryOtherVisible) {
        ui.sub('[Smart Auth] Form Authenticator OTP terdeteksi, mengisi OTP...');
        await submitTotpChallenge(page, getOtp, getClockOffsetFn);
        await page.waitForTimeout(2500);
        continue;
      }

      // Cek jika ada tombol Lanjutkan / Continue atau pemilih akun di accounts.google.com
      if (page.url().includes('accounts.google.com')) {
        const contBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.locator('button, [role="button"]').filter({ hasText: /^\s*(lanjutkan|continue)\s*$/i })
        );
        if (contBtn) {
          await contBtn.locator.click();
          await page.waitForTimeout(2000);
          continue;
        }
      }

      await page.waitForTimeout(1000);
    }

    if (!readyToConfirmRemove) {
      throw new Error('Halaman konfirmasi akhir "Hapus anggota keluarga?" tidak muncul setelah verifikasi.');
    }

    // Pict 5: Klik tombol final "Hapus" / "Remove"
    const finalRemoveBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.locator(confirmRemoveBtnSelector).filter({ hasText: /^\s*(hapus|remove)\s*$/i })
    );
    if (!finalRemoveBtn) {
      throw new Error('Tombol konfirmasi "Hapus" pada halaman Hapus anggota keluarga tidak ditemukan.');
    }

    if (DRY_RUN) {
      ui.warn(`[DRY_RUN] Berhenti sebelum klik final Hapus "${memberLabelText}"`);
      return { removed: removedCount };
    }

    ui.sub(`Klik konfirmasi akhir "Hapus" untuk "${memberLabelText}"...`);
    await finalRemoveBtn.locator.scrollIntoViewIfNeeded().catch(() => {});
    await finalRemoveBtn.locator.click();
    removedCount += 1;
    ui.ok(`Anggota #${round + 1} berhasil dihapus dari Family`);
    await page.waitForTimeout(3000);

    // Tunggu kembali ke tampilan daftar family/details
    await page
      .waitForURL((u) => u.href.includes('/family/details'), { timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(2000);
  }
  return { removed: removedCount };
}

async function processAccount(account, index, total, stats) {
  const accountStart = Date.now();
  const accountUrl =
    typeof account === 'string'
      ? account.trim()
      : String(account?.url || account?.link || '').trim();
  const useWebsiteTab = Boolean(accountUrl) || CREDENTIAL_SOURCE === 'website_tab';
  const resolvedUrl = accountUrl || WEBSITE_SOURCE.url;
  const accountLabel = `akun #${index + 1} yang diisi di accounts.json`;

  ui.accountHeader(index, total, stats);
  ui.spin(`Menyiapkan browser Chromium untuk akun #${index + 1}...`);

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
    // Tangkap teks yang disalin website lewat navigator.clipboard.writeText / execCommand
    // agar selalu terbaca di Chromium headless Termux tanpa bergantung clipboard OS.
    window.__lastCopiedText = '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text) => {
        window.__lastCopiedText = String(text ?? '');
        try {
          return await origWrite(text);
        } catch {
          return undefined;
        }
      };
    }
    const origExec = document.execCommand?.bind(document);
    if (origExec) {
      document.execCommand = (cmd, ...args) => {
        if (String(cmd).toLowerCase() === 'copy') {
          const sel = window.getSelection()?.toString();
          if (sel) window.__lastCopiedText = sel;
        }
        return origExec(cmd, ...args);
      };
    }
  });

  let sourcePage = null;
  if (useWebsiteTab) {
    if (!resolvedUrl || !/^https?:\/\//i.test(resolvedUrl)) {
      throw new Error(`Link website untuk ${accountLabel} tidak valid.`);
    }
    sourcePage = await context.newPage();
    ui.step('TAB-1', `Membuka link akun #${index + 1} (URL disensor)`);
    await sourcePage.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sourcePage.waitForTimeout(2000);
  }

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  let googleClockOffsetMs = 0;

  // Sinkronkan jam dengan HTTP Date header resmi dari server Google
  page.on('response', (res) => {
    try {
      if (res.url().includes('google.com')) {
        const dateHdr = res.headers()['date'];
        if (dateHdr) {
          const serverMs = Date.parse(dateHdr);
          if (!Number.isNaN(serverMs)) {
            googleClockOffsetMs = serverMs - Date.now();
          }
        }
      }
    } catch {
      // Abaikan
    }
  });

  const getEmail = async () =>
    useWebsiteTab
      ? fetchFromSourceTab(sourcePage, page, 'email')
      : account.email;

  const getPassword = async () =>
    useWebsiteTab
      ? fetchFromSourceTab(sourcePage, page, 'password')
      : account.password;

  const getOtp = async () => {
    if (useWebsiteTab) {
      const liveOtp = await fetchFromSourceTab(sourcePage, page, 'totp');
      return { otp: liveOtp, remaining: 30, serverIso: new Date(Date.now() + googleClockOffsetMs).toISOString() };
    }
    let res = generateTOTP(account.totpSecret, 30, 6, googleClockOffsetMs);
    if (res.remaining <= 5) {
      await ui.countdown((res.remaining + 1) * 1000, 'Siklus OTP baru');
      res = generateTOTP(account.totpSecret, 30, 6, googleClockOffsetMs);
    }
    return res;
  };

  let currentStep = 'Inisialisasi';
  let activeDebugPage = page;

  try {
    // [LANGKAH 1 & 2] Masuk ke URL settings & tunggu redirect login
    currentStep = 'Langkah 1-2: Buka Settings & Redirect Login';
    ui.step('01-02', 'Membuka Google Payments Settings...');
    await page.goto(SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(STEP_DELAY_MS);

    if (page.url().includes('accounts.google.com')) {
      ui.sub(`Redirect login: ${shortUrl(page.url())}`);

      // [LANGKAH 3] Masukkan Email
      currentStep = 'Langkah 3: Input Email';
      ui.step('03', 'Memasukkan email...');
      const emailValue = await getEmail();
      const emailInput = page.locator('input[type="email"], #identifierId').first();
      await emailInput.waitFor({ state: 'visible', timeout: 25000 });
      await emailInput.fill(emailValue);
      await page.locator('#identifierNext, button:has-text("Berikutnya"), button:has-text("Next")').first().click();
      await page.waitForTimeout(STEP_DELAY_MS);

      const emailError = page
        .getByText(/tidak dapat menemukan akun|couldn['’]t find your google account|masukkan email atau nomor telepon yang valid|enter a valid email/i)
        .first();
      if (await emailError.isVisible().catch(() => false)) {
        const errMsg = (await emailError.innerText().catch(() => 'Email ditolak Google')).trim();
        throw new Error(`Email pada ${accountLabel} ditolak Google ("${errMsg}").`);
      }

      // [LANGKAH 4] Masukkan Password
      currentStep = 'Langkah 4: Input Password';
      ui.step('04', 'Memasukkan password...');
      const pwdValue = await getPassword();
      const pwdInput = page
        .locator('input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([name="hiddenPassword"]):not([aria-hidden="true"])')
        .first();
      await pwdInput.waitFor({ state: 'visible', timeout: 25000 });
      await pwdInput.fill(pwdValue);
      await page.locator('#passwordNext, button:has-text("Berikutnya"), button:has-text("Next")').first().click();
      await page.waitForTimeout(STEP_DELAY_MS);

      // [LANGKAH 5] Masukkan OTP Google Authenticator
      currentStep = 'Langkah 5: Verifikasi Google Authenticator OTP';
      ui.step('05', 'Verifikasi Google Authenticator OTP...');
      await submitTotpChallenge(page, getOtp, () => googleClockOffsetMs);
      await page.waitForTimeout(3000);
    }

    // [LANGKAH 6] Lewati pop-up (Set a home address, Passkey, Face ID, dll) sampai masuk Settings
    currentStep = 'Langkah 6: Lewati Pop-up Pasca Login';
    ui.step('06', 'Mengecek & melewati pop-up pasca login...');
    const primarySkipRegex =
      /\b(skip|lewati|lain kali|not now|nanti saja|tidak sekarang|lain kali saja|no thanks|tidak, terima kasih|jangan aktifkan|don['’]t turn on|skip for now|lewati sekarang)\b/i;
    const secondarySkipRegex =
      /^\s*(batal|cancel|tutup|close|mengerti|got it)\s*$/i;
    const totalSkipLoops = Math.max(MAX_SKIP_ATTEMPTS, 8);

    for (let attempt = 0; attempt < totalSkipLoops; attempt++) {
      const currentUrl = page.url();
      if (currentUrl.startsWith('https://payments.google.com')) {
        break;
      }

      // 1) Prioritaskan tombol Skip / Lewati / Lain kali / Not now (termasuk di halaman Set a home address)
      let foundSkip = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.locator('button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]').filter({
          hasText: primarySkipRegex,
        })
      );

      // 2) Fallback: cari elemen role=button/link atau teks exact "Skip" / "Lain kali"
      if (!foundSkip) {
        foundSkip = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.getByRole('button', { name: primarySkipRegex })
        );
      }
      if (!foundSkip) {
        foundSkip = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.getByText(/^\s*(skip|lewati|lain kali|not now|lain kali saja|nanti saja)\s*$/i)
        );
      }

      // 3) Fallback sekunder (Close / Cancel / Got it) jika tombol Skip utama tidak ada
      if (!foundSkip) {
        foundSkip = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.locator('button, a, [role="button"]').filter({ hasText: secondarySkipRegex })
        );
      }

      if (foundSkip) {
        const label = (await foundSkip.locator.innerText().catch(() => 'Skip')).trim() || 'Skip';
        ui.sub(`Lewati pop-up (${shortUrl(currentUrl)}) -> "${label}"`);
        await foundSkip.locator.scrollIntoViewIfNeeded().catch(() => {});
        try {
          await foundSkip.locator.click({ timeout: 5000 });
        } catch {
          try {
            await foundSkip.locator.click({ force: true, timeout: 5000 });
          } catch {
            await foundSkip.locator.evaluate((el) => el.click()).catch(() => {});
          }
        }
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2500);
      } else {
        await page.waitForTimeout(1800);
      }
    }

    if (page.url().includes('accounts.google.com') || page.url().includes('gds.google.com')) {
      throw new Error(
        `Login/pop-up belum terlewati (masih tertahan di ${shortUrl(page.url())}). Cek screenshot 12-digit.`
      );
    }

    if (!page.url().includes('/gp/w/u/0/home/settings')) {
      ui.sub('Mengarahkan ulang ke halaman settings target...');
      await page.goto(SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    ui.sub(`Halaman aktif: ${shortUrl(page.url())}`);

    // [LANGKAH 7] Tunggu konten settings/iframe termuat, cek apakah akun tidak punya profil pembayaran, lalu scroll & cari "Tutup profil pembayaran"
    currentStep = 'Langkah 7: Cari & Klik Tutup Profil Pembayaran';
    ui.step('07', 'Memeriksa status profil pembayaran...');

    const noProfileRegex =
      /tambahkan metode pembayaran|nikmati pembayaran yang cepat dan aman|add a payment method|enjoy fast and secure payments/i;
    const activeProfileRegex =
      /status profil pembayaran|payments profile status|tutup profil pembayaran|close payments? profile|id profil pembayaran|payments profile id/i;

    let paymentsProfileCleared = false;

    // Tunggu minimal ada konten settings atau layar kosong "Tambahkan metode pembayaran"
    for (let waitSettings = 0; waitSettings < 10; waitSettings++) {
      const hasActiveProfile = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.getByText(activeProfileRegex)
      );
      if (hasActiveProfile) break;

      const hasNoProfile = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.getByText(noProfileRegex)
      );
      if (hasNoProfile) {
        ui.info(`Akun #${index + 1} tidak punya profil pembayaran. Lanjut cek Family...`);
        paymentsProfileCleared = true;
        break;
      }

      const hasSettingsText = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.getByText(/profil pembayaran|payments profile|pengaturan|settings/i)
      );
      if (hasSettingsText) break;
      await page.waitForTimeout(1000);
    }

    const closeProfileRegex = /tutup profil pembayaran|close payments? profile/i;
    let foundCloseLink = null;

    if (!paymentsProfileCleared) {
      for (let scrollTry = 0; scrollTry < 10; scrollTry++) {
        await scrollAllFramesToBottom(page);
        await page.waitForTimeout(1200);

        foundCloseLink = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.locator('a, button, [role="button"], [role="link"]').filter({ hasText: closeProfileRegex })
        );
        if (!foundCloseLink) {
          // Fallback jika elemen berupa <span> atau <div> tanpa role="button"
          foundCloseLink = await findVisibleLocatorInAllFrames(page, (scope) =>
            scope.getByText(closeProfileRegex)
          );
        }
        if (foundCloseLink) break;

        const noProfileFallback = await findVisibleLocatorInAllFrames(page, (scope) =>
          scope.getByText(noProfileRegex)
        );
        if (noProfileFallback) {
          ui.info(`Akun #${index + 1} tidak punya profil pembayaran. Lanjut cek Family...`);
          paymentsProfileCleared = true;
          break;
        }
      }
    }

    if (!paymentsProfileCleared && !foundCloseLink) {
      throw new Error('Tombol "Tutup profil pembayaran" tidak ditemukan (cek screenshot 12-digit).');
    }

    if (!paymentsProfileCleared) {

    const pagesBeforeClose = new Set(context.pages());
    const popupWaiter = context.waitForEvent('page', { timeout: 25000 }).catch(() => null);

    await foundCloseLink.locator.scrollIntoViewIfNeeded();
    await foundCloseLink.locator.click();
    ui.ok('Klik "Tutup profil pembayaran"');

    // [LANGKAH 8 & 9] Deteksi apakah Google membuka jendela pop-up baru ("A new window will appear...") atau redirect langsung
    currentStep = 'Langkah 8-9: Verifikasi Ulang Password';
    ui.step('08-09', 'Menunggu verifikasi ulang password...');
    const pwdSelector =
      'input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([name="hiddenPassword"]):not([aria-hidden="true"])';
    const warningRegex =
      /akses ke layanan akan seketika berubah|access to services will change|closing your payments profile|closing your google payments profile|why are you closing/i;

    let authPage = null;
    let skipReAuth = false;

    for (let waitAuth = 0; waitAuth < 25; waitAuth++) {
      // Cek 1: Jendela pop-up baru terbuka di context
      const newTab = context.pages().find((p) => !pagesBeforeClose.has(p) && !p.isClosed());
      if (newTab) {
        authPage = newTab;
        ui.sub(`Pop-up verifikasi terdeteksi: ${shortUrl(authPage.url()) || '(memuat...)'}`);
        break;
      }

      // Cek 2: Tab utama langsung redirect ke accounts.google.com
      if (page.url().includes('accounts.google.com')) {
        authPage = page;
        ui.sub(`Redirect re-auth tab utama: ${shortUrl(page.url())}`);
        break;
      }

      // Cek 3: Input password muncul di halaman/iframe yang sama
      const inlinePwd = await findVisibleLocatorInAllFrames(page, (scope) => scope.locator(pwdSelector));
      if (inlinePwd) {
        authPage = page;
        ui.sub('Form password re-auth terdeteksi inline.');
        break;
      }

      // Cek 4: Modal peringatan penutupan sudah langsung muncul tanpa re-auth
      const alreadyWarning = await findVisibleLocatorInAllFrames(page, (scope) => scope.getByText(warningRegex));
      if (alreadyWarning) {
        skipReAuth = true;
        ui.sub('Langsung masuk modal konfirmasi tanpa re-auth.');
        break;
      }

      await page.waitForTimeout(1000);
    }

    if (!authPage && !skipReAuth) {
      const waitedPopup = await Promise.race([popupWaiter, page.waitForTimeout(500).then(() => null)]);
      if (waitedPopup && !waitedPopup.isClosed()) {
        authPage = waitedPopup;
      }
    }

    if (!skipReAuth) {
      if (!authPage) {
        throw new Error(
          'Jendela pop-up maupun form verifikasi ulang password tidak muncul setelah klik Close payments profile.'
        );
      }

      activeDebugPage = authPage;
      await authPage.bringToFront().catch(() => {});
      await authPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
      await authPage.waitForTimeout(1500);

      // Jika pop-up menampilkan pemilih akun / konfirmasi email dulu, tangani
      const accountTile = await findVisibleLocatorInAllFrames(authPage, (scope) =>
        scope.locator('[data-identifier], [data-email]')
      );
      const pwdCheckNow = await findVisibleLocatorInAllFrames(authPage, (scope) => scope.locator(pwdSelector));
      if (!pwdCheckNow && accountTile) {
        await accountTile.locator.click().catch(() => {});
        await authPage.waitForTimeout(2000);
      }

      const reAuthPwdLoc = await (async () => {
        for (let t = 0; t < 25; t++) {
          if (authPage.isClosed()) return null;
          const found = await findVisibleLocatorInAllFrames(authPage, (scope) => scope.locator(pwdSelector));
          if (found) return found;
          await authPage.waitForTimeout(1000);
        }
        return null;
      })();

      if (reAuthPwdLoc) {
        const pwdForReAuth = await getPassword();
        if (authPage !== page) {
          await authPage.bringToFront().catch(() => {});
        }
        await reAuthPwdLoc.locator.fill(pwdForReAuth);
        const nextBtn = await findVisibleLocatorInAllFrames(authPage, (scope) =>
          scope.locator('#passwordNext, button:has-text("Berikutnya"), button:has-text("Next")')
        );
        if (nextBtn) {
          await nextBtn.locator.click();
        } else {
          await reAuthPwdLoc.locator.press('Enter');
        }
        await authPage.waitForTimeout(2500);
      }

      // Tangani jika Google meminta verifikasi TOTP ulang di pop-up/halaman re-auth
      if (
        !authPage.isClosed() &&
        authPage.url().includes('accounts.google.com') &&
        (await authPage
          .locator('input[name="totpPin"], #totpPin, button:has-text("Coba cara lain"), button:has-text("Try another way")')
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        ui.sub('Verifikasi TOTP tambahan di jendela re-auth...');
        await submitTotpChallenge(authPage, getOtp, () => googleClockOffsetMs);
      }

      if (authPage !== page) {
        ui.sub('Menunggu jendela pop-up verifikasi tertutup otomatis...');
        await authPage.waitForEvent('close', { timeout: 25000 }).catch(() => {});
        activeDebugPage = page;
        await page.bringToFront().catch(() => {});
      } else {
        await page.waitForURL((url) => url.href.includes('payments.google.com'), { timeout: 45000 });
      }
      await page.waitForTimeout(2500);
    }

    // [LANGKAH 10] Tunggu pop-up "Akses ke layanan akan seketika berubah" & scroll ke paling bawah
    currentStep = 'Langkah 10: Tunggu Pop-up Akses ke Layanan & Scroll Bawah';
    ui.step('10', 'Menunggu modal konfirmasi penutupan...');

    let modalFound = null;
    for (let waitTry = 0; waitTry < 20; waitTry++) {
      modalFound = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.getByText(warningRegex)
      );
      if (modalFound) break;
      await page.waitForTimeout(1000);
    }

    if (!modalFound) {
      throw new Error('Pop-up "Akses ke layanan akan seketika berubah" tidak muncul dalam batas waktu.');
    }

    ui.sub('Modal terdeteksi, scroll ke paling bawah...');
    await scrollAllFramesToBottom(page);
    await page.waitForTimeout(1200);

    // [LANGKAH 11] Pilih alasan "Saya tidak perlu profil ini lagi"
    currentStep = 'Langkah 11: Pilih Alasan Penutupan';
    ui.step('11', 'Memilih alasan "Saya tidak perlu profil ini lagi"...');
    const reasonTextRegex =
      /saya tidak perlu profil ini lagi|i don['’]t need this profile anymore|i no longer need this profile/i;

    // Jika opsi alasan berbentuk dropdown/select, buka terlebih dahulu
    const dropdownTrigger = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope.locator('[role="listbox"], [role="combobox"], select, button:has-text("Alasan"), button:has-text("Reason"), div[aria-haspopup="listbox"]')
    );
    if (dropdownTrigger) {
      await dropdownTrigger.locator.scrollIntoViewIfNeeded();
      await dropdownTrigger.locator.click();
      await page.waitForTimeout(1000);
    }

    const reasonOption = await findVisibleLocatorInAllFrames(page, (scope) =>
      scope
        .locator('[role="option"], [role="menuitem"], [role="radio"], label, div, span')
        .filter({ hasText: reasonTextRegex })
    );

    if (!reasonOption) {
      throw new Error('Opsi alasan "Saya tidak perlu profil ini lagi" tidak ditemukan.');
    }

    await reasonOption.locator.scrollIntoViewIfNeeded();
    await reasonOption.locator.click();
    await page.waitForTimeout(STEP_DELAY_MS);

    // [LANGKAH 12] Klik tombol final "Tutup profil pembayaran"
    currentStep = 'Langkah 12: Klik Final Tutup Profil Pembayaran';
    ui.step('12', 'Mengirim konfirmasi akhir tutup profil...');
    await scrollAllFramesToBottom(page);

    let finalSubmitBtn =
      (await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.locator('[role="dialog"] button, [role="dialog"] [role="button"]').filter({ hasText: closeProfileRegex })
      )) ||
      (await findVisibleLocatorInAllFrames(page, (scope) =>
        scope.locator('button, [role="button"], input[type="submit"]').filter({ hasText: closeProfileRegex })
      ));

    // Jika Google memisahkan tombol "Continue / Lanjutkan" sebelum tombol final "Close payments profile"
    if (!finalSubmitBtn) {
      const continueBtn = await findVisibleLocatorInAllFrames(page, (scope) =>
        scope
          .locator('[role="dialog"] button, [role="dialog"] [role="button"], button, [role="button"]')
          .filter({ hasText: /^\s*(continue|lanjutkan)\s*$/i })
      );
      if (continueBtn) {
        ui.sub('Klik tombol "Continue/Lanjutkan" menuju konfirmasi akhir...');
        await continueBtn.locator.scrollIntoViewIfNeeded().catch(() => {});
        await continueBtn.locator.click();
        await page.waitForTimeout(1800);
        await scrollAllFramesToBottom(page);

        finalSubmitBtn =
          (await findVisibleLocatorInAllFrames(page, (scope) =>
            scope.locator('[role="dialog"] button, [role="dialog"] [role="button"]').filter({ hasText: closeProfileRegex })
          )) ||
          (await findVisibleLocatorInAllFrames(page, (scope) =>
            scope.locator('button, [role="button"], input[type="submit"]').filter({ hasText: closeProfileRegex })
          ));
      }
    }

    if (!finalSubmitBtn) {
      throw new Error('Tombol final "Tutup profil pembayaran" tidak ditemukan.');
    }

    if (DRY_RUN) {
      ui.warn('[DRY_RUN] Berhenti sebelum klik final Tutup Profil Pembayaran');
    } else {
      await finalSubmitBtn.locator.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await finalSubmitBtn.locator.click({ timeout: 5000 });
      } catch {
        await finalSubmitBtn.locator.click({ force: true, timeout: 5000 }).catch(async () => {
          await finalSubmitBtn.locator.evaluate((el) => el.click());
        });
      }
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(5000);
      ui.ok('Profil pembayaran berhasil ditutup!');
    }
    } // akhir blok if (!paymentsProfileCleared)

    // [LANGKAH 13] Kosongkan Google Family setelah profil pembayaran ditutup atau memang kosong
    activeDebugPage = page;
    const familyRes = await cleanupGoogleFamily(
      page,
      accountLabel,
      getPassword,
      getOtp,
      () => googleClockOffsetMs,
      (s) => {
        currentStep = s;
      }
    );

    stats.success += 1;
    if (paymentsProfileCleared) {
      stats.noProfile += 1;
    } else if (!DRY_RUN) {
      stats.closed += 1;
    }
    stats.familyMembersRemoved += familyRes?.removed || 0;

    const statusDetail = `${paymentsProfileCleared ? 'Tanpa profil' : 'Profil ditutup'} • Family -${familyRes?.removed || 0}`;
    ui.accountDone(index, total, true, Date.now() - accountStart, statusDetail);
  } catch (err) {
    stats.failed += 1;
    ui.fail(`Error akun #${index + 1}: ${err.message}`);
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
    throw new Error('File accounts.json tidak ditemukan di direktori saat ini.');
  }

  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('accounts.json harus berisi minimal 1 akun atau link URL.');
  }

  const stats = {
    success: 0,
    failed: 0,
    closed: 0,
    noProfile: 0,
    familyMembersRemoved: 0,
  };
  const startedAt = Date.now();

  process.on('SIGINT', () => {
    ui.stopSpin();
    ui.warn('Proses dihentikan oleh pengguna (SIGINT).');
    process.exit(130);
  });

  ui.banner(accounts.length);

  for (let i = 0; i < accounts.length; i++) {
    await processAccount(accounts[i], i, accounts.length, stats);
  }

  ui.summary(accounts.length, stats, Date.now() - startedAt);
}

main().catch((err) => {
  ui.stopSpin();
  ui.fail(`Fatal error: ${err.message || err}`);
  process.exit(1);
});

