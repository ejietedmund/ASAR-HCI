import fs from 'node:fs';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const PORT = 5199;
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

async function clickButton(page, labels) {
  return page.evaluate((wanted) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const button = buttons.find((candidate) =>
      wanted.some((label) => candidate.textContent.trim().includes(label))
    );
    if (!button) return false;
    button.click();
    return true;
  }, labels);
}

const server = await createServer({
  configFile: 'vite.config.js',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});

let browser;
try {
  await server.listen();
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.setDefaultTimeout(60000);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() =>
    document.body.innerText.includes('Upload your study material')
  );

  for (const demo of ['Try a demo PDF', 'Try demo slides']) {
    if (demo.startsWith('Try demo slides')) {
      await clickButton(page, ['Back to library']);
      await page.waitForFunction(() =>
        document.body.innerText.includes('Upload your study material')
      );
    }

    const clicked = await clickButton(page, [demo]);
    if (!clicked) throw new Error(`Could not find button: ${demo}`);

    await page.waitForFunction(
      () => document.body.innerText.includes('Chunk 1 of'),
      { timeout: 60000 }
    );

    let steps = 0;
    while (steps < 40) {
      steps += 1;
      const state = await page.evaluate(() => {
        if (document.body.innerText.includes('Session summary')) return 'summary';
        if (document.body.innerText.includes('Quick check')) return 'checkpoint';
        return 'reading';
      });

      if (state === 'summary') break;
      if (state === 'checkpoint') {
        await clickButton(page, ['Skip']);
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }

      const advanced = await clickButton(page, ['Finish', 'Next']);
      if (!advanced) throw new Error('No Next/Finish button found');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await page.waitForFunction(() =>
      document.body.innerText.includes('Session summary')
    );

    const completed = await page.evaluate(() =>
      document.body.innerText.includes('Chunks completed')
    );
    if (!completed) throw new Error('Summary did not render report rows');
    console.log(`ok - ${demo} reached summary`);
  }

  if (errors.length) {
    console.log('Browser errors:');
    errors.slice(0, 10).forEach((error) => console.log(`  - ${error}`));
    process.exitCode = 1;
  } else {
    console.log('Smoke test passed');
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}
