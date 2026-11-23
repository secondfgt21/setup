import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

if (process.platform === 'android') {
  Object.defineProperty(process, 'platform', {
    value: 'linux',
    configurable: true,
  });
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ||= '1';
  process.env.XDG_CACHE_HOME ||= path.join(os.homedir(), '.cache');
}

const { chromium } = await import('playwright-core');

const TARGET_URL =
  'https://accounts.google.com/v3/signin/challenge/pwd?TL=AAxq8ntbx332yw4K3k6EYfzGgTlj2HOHKIz0ixov9d5QmPfp1O9GxPg8eawWdFqo&checkConnection=youtube%3A295&checkedDomains=youtube&cid=1&continue=https%3A%2F%2Fplay.google.com%2Fweb%2Fstore%2Fpaymentmethods%3Fpli%3D1&dsh=S1578366593%3A1795129437713684&flowEntry=AddSession&flowName=GlifWebSignIn&pstMsg=1&service=googleplay';
const FALLBACK_IDENTIFIER_URL =
  'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fplay.google.com%2Fweb%2Fstore%2Fpaymentmethods%3Fpli%3D1&flowEntry=AddSession&flowName=GlifWebSignIn&service=googleplay';

const HEADLESS = true;

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
  blue: USE_COLOR ? '\x1b[34m' : '',
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

function formatDuration(ms) {
  const sec = Math.max(0, ms / 1000);
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function buildBar(ratio, width = 12) {
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
    process.stdout.write(`\r\x1b[2K${C.brightCyan}${frame}${C.reset} ${label} ${C.dim}(${elapsed}s)${C.reset}`);
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

  updateSpin(text) {
    this._spinText = String(text || '');
    if (IS_TTY) this._renderSpin();
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
    process.stdout.write(`${bot}\n\n`);
  },

  banner(fileName, totalEmails) {
    this.box(
      [
        `${C.bold}${C.brightCyan}GOOGLE EMAIL LIVE / DIE CHECKER${C.reset}`,
        `${C.dim}Sumber :${C.reset} ${C.white}${fileName}${C.reset} ${C.dim}(${totalEmails} email)${C.reset}`,
        `${C.dim}Output :${C.reset} ${C.brightGreen}live.txt${C.reset} ${C.dim}&${C.reset} ${C.brightYellow}die.txt${C.reset}`,
      ],
      C.brightCyan
    );
  },

  result(index, total, status, email, reason, elapsedMs) {
    const padNum = String(index + 1).padStart(String(total).length, '0');
    const t = `${C.dim}[${nowTime()}]${C.reset}`;
    const idxTag = `${C.dim}[${padNum}/${total}]${C.reset}`;
    const dur = `${C.dim}(${formatDuration(elapsedMs)})${C.reset}`;
    if (status === 'live') {
      this._print(`${t} ${idxTag} ${C.bold}${C.brightGreen}✓ LIVE${C.reset} ${C.white}${email}${C.reset} ${dur}`);
      this._print(`   ${C.green}▸ ${reason}${C.reset}`);
    } else {
      this._print(`${t} ${idxTag} ${C.bold}${C.brightRed}✖ DIE ${C.reset} ${C.yellow}${email}${C.reset} ${dur}`);
      this._print(`   ${C.dim}▸ ${reason}${C.reset}`);
    }
  },

  warn(msg) {
    this._print(`${C.brightYellow}⚠ ${msg}${C.reset}`);
  },

  fail(msg) {
    this.stopSpin();
    this._print(`${C.brightRed}✖ ${msg}${C.reset}`);
  },

  summary(checked, total, liveCount, dieCount, totalMs) {
    const ratio = checked / Math.max(1, total);
    const pct = Math.round(ratio * 100);
    const liveRate = checked > 0 ? Math.round((liveCount / checked) * 100) : 0;
    const bar = buildBar(ratio, 12);
    this.box(
      [
        `${C.bold}${C.brightCyan}RINGKASAN CEK EMAIL${C.reset}  ${bar} ${C.brightCyan}${pct}%${C.reset}`,
        `${C.dim}Diproses :${C.reset} ${C.white}${checked}/${total}${C.reset} ${C.dim}(${formatDuration(totalMs)})${C.reset}`,
        `${C.brightGreen}✓ LIVE   :${C.reset} ${liveCount} ${C.dim}(${liveRate}%) -> live.txt${C.reset}`,
        `${C.brightRed}✖ DIE    :${C.reset} ${dieCount} ${C.dim}-> die.txt${C.reset}`,
      ],
      liveCount > 0 ? C.brightGreen : C.yellow
    );
  },
};

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
  throw new Error('Binary Chromium tidak ditemukan! Install Chromium Termux atau set CHROMIUM_PATH.');
}

function loadEmailList() {
  const fileCandidates = ['email', 'email.txt', 'emails.txt'];
  let chosenPath = null;
  for (const name of fileCandidates) {
    const p = path.resolve(process.cwd(), name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      chosenPath = p;
      break;
    }
  }

  if (!chosenPath) {
    throw new Error('File daftar email tidak ditemukan! Buat file "email" atau "email.txt" berisi email per baris.');
  }

  const lines = fs
    .readFileSync(chosenPath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (lines.length === 0) {
    throw new Error(`File "${path.basename(chosenPath)}" kosong.`);
  }

  return { filePath: chosenPath, emails: lines };
}

function saveResults(liveList, dieList) {
  const livePath = path.resolve(process.cwd(), 'live.txt');
  const diePath = path.resolve(process.cwd(), 'die.txt');
  fs.writeFileSync(livePath, liveList.join('\n') + (liveList.length ? '\n' : ''), 'utf-8');
  fs.writeFileSync(diePath, dieList.join('\n') + (dieList.length ? '\n' : ''), 'utf-8');
}

const EMAIL_INPUT_SELECTOR = 'input[type="email"], #identifierId';

async function returnToIdentifierScreen(page, previousEmail, onPhase = () => {}) {
  const emailInput = page.locator(EMAIL_INPUT_SELECTOR).first();
  if (await emailInput.isVisible().catch(() => false)) {
    return emailInput;
  }

  if (previousEmail) {
    onPhase(`Klik modal ${previousEmail} untuk kembali...`);
    const chipCandidates = [
      page.locator(`[data-identifier="${previousEmail}"], [data-email="${previousEmail}"]`),
      page.locator('[role="button"], button, [aria-haspopup], div[jsaction], a').filter({ hasText: previousEmail }),
      page.getByText(previousEmail, { exact: false }),
    ];

    let clickedChip = false;
    for (const loc of chipCandidates) {
      const target = loc.first();
      if (await target.isVisible().catch(() => false)) {
        try {
          await target.click({ timeout: 4000 });
        } catch {
          await target.click({ force: true, timeout: 4000 }).catch(() => {});
        }
        clickedChip = true;
        break;
      }
    }

    if (clickedChip) {
      const appeared = await emailInput
        .waitFor({ state: 'visible', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) return emailInput;

      // Jika klik modal memunculkan daftar akun, klik "Gunakan akun lain" / "Use another account"
      const anotherAcc = page
        .locator('li, [role="link"], [role="button"], button, div')
        .filter({ hasText: /gunakan akun lain|use another account/i })
        .first();
      if (await anotherAcc.isVisible().catch(() => false)) {
        await anotherAcc.click({ force: true }).catch(() => {});
        const appearedAfter = await emailInput
          .waitFor({ state: 'visible', timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        if (appearedAfter) return emailInput;
      }
    }
  }

  // Fallback jika tombol kembali / modal tidak memunculkan input email
  onPhase('Navigasi ulang ke halaman input email...');
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  if (await emailInput.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
    return emailInput;
  }

  await page.goto(FALLBACK_IDENTIFIER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await emailInput.waitFor({ state: 'visible', timeout: 20000 });
  return emailInput;
}

async function checkEmailStatus(page, email, previousEmail, isFirst, onPhase = () => {}) {
  let emailInput;
  if (isFirst) {
    onPhase('Membuka halaman login Google...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    emailInput = page.locator(EMAIL_INPUT_SELECTOR).first();
    const hasEmailBox = await emailInput
      .waitFor({ state: 'visible', timeout: 7000 })
      .then(() => true)
      .catch(() => false);

    if (!hasEmailBox) {
      onPhase('Membuka halaman identifier cadangan...');
      await page.goto(FALLBACK_IDENTIFIER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      emailInput = page.locator(EMAIL_INPUT_SELECTOR).first();
      await emailInput.waitFor({ state: 'visible', timeout: 20000 });
    }
  } else {
    emailInput = await returnToIdentifierScreen(page, previousEmail, onPhase);
  }

  const pwdSelector =
    'input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([name="hiddenPassword"]):not([aria-hidden="true"])';
  const captchaTextRegex =
    /konfirmasi bahwa anda bukan robot|confirm you['’]?re not a robot|saya bukan robot|i['’]?m not a robot|ketik teks yang anda lihat|type the text you hear or see/i;
  const accountInvalidRegex =
    /tidak dapat menemukan akun google anda|couldn['’]t find your google account|akun anda telah dinonaktifkan|your account has been disabled/i;

  const prevErrorLoc = page.getByText(accountInvalidRegex).first();
  const hadPreviousInvalidError = await prevErrorLoc.isVisible().catch(() => false);

  onPhase(`Ganti & kirim email ${email}...`);
  await emailInput.click();
  await emailInput.press('ControlOrMeta+A').catch(() => {});
  await emailInput.fill('');
  await emailInput.fill(email);
  await page.locator('#identifierNext, button:has-text("Berikutnya"), button:has-text("Next")').first().click();

  if (hadPreviousInvalidError) {
    await prevErrorLoc.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
  }
  await page.waitForTimeout(450);
  onPhase('Menunggu respons Google...');

  for (let i = 0; i < 35; i++) {
    const pwdVisible = await page.locator(pwdSelector).first().isVisible().catch(() => false);
    if (pwdVisible) {
      return { status: 'live', reason: 'Kolom password tersedia' };
    }

    const currentUrl = page.url().toLowerCase();
    const hasCaptchaUrl =
      currentUrl.includes('/challenge/recaptcha') || currentUrl.includes('/challenge/captcha');
    const hasCaptchaFrame = await page
      .locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i], .g-recaptcha, #captchaimg')
      .first()
      .isVisible()
      .catch(() => false);
    const hasCaptchaText = await page
      .getByText(captchaTextRegex)
      .first()
      .isVisible()
      .catch(() => false);

    if (hasCaptchaUrl || hasCaptchaFrame || hasCaptchaText) {
      return { status: 'die', reason: 'Terkena verifikasi Captcha (Saya bukan robot)' };
    }

    if (!hadPreviousInvalidError || i >= 3) {
      const hasInvalidAccount = await prevErrorLoc.isVisible().catch(() => false);
      if (hasInvalidAccount) {
        return { status: 'die', reason: 'Email tidak ditemukan atau dinonaktifkan' };
      }
    }

    await page.waitForTimeout(450);
  }

  return { status: 'die', reason: `Timeout menunggu kolom password (${page.url().split('?')[0]})` };
}

async function main() {
  const { filePath, emails } = loadEmailList();
  const executablePath = resolveChromiumExecutable();
  const startedAt = Date.now();

  ui.banner(path.basename(filePath), emails.length);
  ui.spin('Meluncurkan browser Chromium (1 sesi cepat)...');

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
      '--window-size=1280,900',
    ],
  });

  const context = await browser.newContext({
    locale: 'id-ID',
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  const liveList = [];
  const dieList = [];
  let interrupted = false;

  const onSigInt = () => {
    interrupted = true;
    ui.stopSpin();
    ui.warn('Dihentikan oleh pengguna (SIGINT). Menyimpan hasil sementara...');
    saveResults(liveList, dieList);
    ui.summary(liveList.length + dieList.length, emails.length, liveList.length, dieList.length, Date.now() - startedAt);
    process.exit(130);
  };
  process.on('SIGINT', onSigInt);

  let previousEmail = '';
  try {
    for (let i = 0; i < emails.length; i++) {
      if (interrupted) break;
      const email = emails[i];
      const itemStart = Date.now();
      const pct = Math.round((i / Math.max(1, emails.length)) * 100);
      const tally = `${C.green}✓${liveList.length}${C.reset}/${C.red}✖${dieList.length}${C.reset}`;
      ui.spin(`[${i + 1}/${emails.length} • ${pct}% | ${tally}] ${email}`);

      try {
        const result = await checkEmailStatus(page, email, previousEmail, i === 0, (phase) => {
          ui.updateSpin(`[${i + 1}/${emails.length} | ${tally}] ${email} — ${C.dim}${phase}${C.reset}`);
        });
        if (result.status === 'live') {
          liveList.push(email);
          ui.result(i, emails.length, 'live', email, result.reason, Date.now() - itemStart);
        } else {
          dieList.push(email);
          ui.result(i, emails.length, 'die', email, result.reason, Date.now() - itemStart);
        }
      } catch (err) {
        dieList.push(email);
        ui.result(i, emails.length, 'die', email, `Error: ${err.message}`, Date.now() - itemStart);
      }

      previousEmail = email;
      saveResults(liveList, dieList);
    }
  } finally {
    process.off('SIGINT', onSigInt);
    ui.stopSpin();
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  ui.summary(liveList.length + dieList.length, emails.length, liveList.length, dieList.length, Date.now() - startedAt);
}

main().catch((err) => {
  ui.stopSpin();
  ui.fail(`Fatal error: ${err.message}`);
  process.exit(1);
});
