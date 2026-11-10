import fs from 'node:fs';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const PORT = 5200;
const URL = `http://127.0.0.1:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome/Edge not found. Set CHROME_PATH.');
}

async function clickButton(page, label) {
  return page.evaluate((wanted) => {
    const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
      candidate.textContent.trim().includes(wanted)
    );
    if (!button) return false;
    button.click();
    return true;
  }, label);
}

const server = await preview({
  configFile: 'vite.config.js',
  logLevel: 'error',
  preview: { host: '127.0.0.1', port: PORT, strictPort: true },
});

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() =>
    document.body.innerText.includes('Upload your study material')
  );

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await new Promise((resolve) => setTimeout(resolve, 1500));

  await clickButton(page, 'Try a demo PDF');
  await page.waitForFunction(() => document.body.innerText.includes('Chunk 1 of'));

  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    document.body.innerText.includes('Upload your study material')
  );

  await clickButton(page, 'Try a demo PDF');
  await page.waitForFunction(() => document.body.innerText.includes('Chunk 1 of'));

  console.log('Offline smoke test passed');
} finally {
  if (browser) await browser.close();
  await server.httpServer?.close();
}
