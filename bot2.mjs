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

const ANSI_RESET = '\x1b[0m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_CYAN = '\x1b[36m';

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

async function checkEmailStatus(browser, email) {
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

  try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const emailSelector = 'input[type="email"], #identifierId';
    let emailInput = page.locator(emailSelector).first();
    const hasEmailBox = await emailInput
      .waitFor({ state: 'visible', timeout: 7000 })
      .then(() => true)
      .catch(() => false);

    if (!hasEmailBox) {
      await page.goto(FALLBACK_IDENTIFIER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      emailInput = page.locator(emailSelector).first();
      await emailInput.waitFor({ state: 'visible', timeout: 20000 });
    }

    await emailInput.fill(email);
    await page.locator('#identifierNext, button:has-text("Berikutnya"), button:has-text("Next")').first().click();

    const pwdSelector =
      'input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([name="hiddenPassword"]):not([aria-hidden="true"])';
    const captchaTextRegex =
      /konfirmasi bahwa anda bukan robot|confirm you['’]?re not a robot|saya bukan robot|i['’]?m not a robot|ketik teks yang anda lihat|type the text you hear or see/i;
    const accountInvalidRegex =
      /tidak dapat menemukan akun google anda|couldn['’]t find your google account|akun anda telah dinonaktifkan|your account has been disabled/i;

    for (let i = 0; i < 25; i++) {
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

      const hasInvalidAccount = await page
        .getByText(accountInvalidRegex)
        .first()
        .isVisible()
        .catch(() => false);
      if (hasInvalidAccount) {
        return { status: 'die', reason: 'Email tidak ditemukan atau dinonaktifkan' };
      }

      await page.waitForTimeout(800);
    }

    return { status: 'die', reason: `Timeout menunggu kolom password (${page.url().split('?')[0]})` };
  } finally {
    await context.close();
  }
}

async function main() {
  const { filePath, emails } = loadEmailList();
  const executablePath = resolveChromiumExecutable();

  console.log(`${ANSI_CYAN}Membaca ${emails.length} email dari ${path.basename(filePath)}...${ANSI_RESET}`);

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

  const liveList = [];
  const dieList = [];

  try {
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      try {
        const result = await checkEmailStatus(browser, email);
        if (result.status === 'live') {
          liveList.push(email);
          console.log(`${ANSI_GREEN}[${i + 1}/${emails.length}] LIVE | ${email} -> ${result.reason}${ANSI_RESET}`);
        } else {
          dieList.push(email);
          console.log(`${ANSI_YELLOW}[${i + 1}/${emails.length}] DIE  | ${email} -> ${result.reason}${ANSI_RESET}`);
        }
      } catch (err) {
        dieList.push(email);
        console.log(`${ANSI_YELLOW}[${i + 1}/${emails.length}] DIE  | ${email} -> Error: ${err.message}${ANSI_RESET}`);
      }

      saveResults(liveList, dieList);
    }
  } finally {
    await browser.close();
  }

  console.log('\n==========================================================');
  console.log(`${ANSI_GREEN}TOTAL LIVE : ${liveList.length} (disimpan ke live.txt)${ANSI_RESET}`);
  console.log(`${ANSI_YELLOW}TOTAL DIE  : ${dieList.length} (disimpan ke die.txt)${ANSI_RESET}`);
  console.log('==========================================================');
}

main().catch((err) => {
  console.error(`${ANSI_YELLOW}Fatal error: ${err.message}${ANSI_RESET}`);
  process.exit(1);
});
