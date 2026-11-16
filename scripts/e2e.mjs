import assert from 'node:assert';
import { createServer } from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import puppeteer from 'puppeteer-core';
import { encodePngStored } from '../src/engines/chunking/imageUtils.js';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      let urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = join(root, urlPath);
      const data = await readFile(filePath);
      response.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
      response.end(data);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

function esc(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function makePdf(pagesLines, pageExtras = []) {
  const objs = [];
  const push = (body) => {
    objs.push(body);
    return objs.length;
  };
  const catalogNum = push('');
  const pagesNum = push('');
  const fontNum = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageNums = [];
  for (let pageIndex = 0; pageIndex < pagesLines.length; pageIndex += 1) {
    const lines = pagesLines[pageIndex];
    const extras = pageExtras[pageIndex] || {};
    const xobjIds = {};
    for (const image of extras.images || []) {
      const header = `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.data.length} >>\nstream\n`;
      xobjIds[image.name] = push(header + image.data.toString('latin1') + '\nendstream');
    }
    let stream = 'BT\n';
    let first = true;
    let curX = 0;
    let curY = 0;
    for (const line of lines) {
      const dx = first ? line.x : line.x - curX;
      const dy = first ? line.y : line.y - curY;
      stream += `/F1 ${line.size} Tf\n${dx} ${dy} Td\n(${esc(line.text)}) Tj\n`;
      curX = line.x;
      curY = line.y;
      first = false;
    }
    stream += 'ET\n';
    for (const draw of extras.draws || []) {
      stream += `q\n${draw.w} 0 0 ${draw.h} ${draw.x} ${draw.y} cm\n/${draw.name} Do\nQ\n`;
    }
    stream = stream.trim();
    const contentNum = push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const xobjPart = (extras.images || []).length
      ? ` /XObject << ${extras.images.map((image) => `/${image.name} ${xobjIds[image.name]} 0 R`).join(' ')} >>`
      : '';
    const pageNum = push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] /Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >>${xobjPart} >> >>`
    );
    pageNums.push(pageNum);
  }
  objs[catalogNum - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
  objs[pagesNum - 1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/**
 * 12 slides of ~100 words each: every slide heading starts its own chunk, so
 * the deck becomes 12 reading chunks.
 */
async function makePptxFixture() {
  const slide = (title, body, pic) =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>${
      body
        ? `<p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>`
        : ''
    }${
      pic
        ? '<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:pic>'
        : ''
    }</p:spTree></p:cSld></p:sld>`;
  const zip = new JSZip();
  const sentence = 'Attention models weigh every input token when producing each output. ';
  const titles = [
    'Lecture 6: Attention Models',
    'Why attention matters',
    'Self-attention in detail',
    'Multi-head attention',
    'Positional encoding',
    'Attention over sequences',
    'Efficient attention variants',
    'Training attention models',
    'Attention in vision',
    'Limitations and pitfalls',
    'Recent research directions',
    'Summary and readings',
  ];
  titles.forEach((title, index) => {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      slide(
        title,
        sentence.repeat(10).trim(),
        index === 0
      )
    );
  });
  const png1x1 = Buffer.from(encodePngStored(1, 1, new Uint8Array([255, 0, 0, 255])));
  zip.file('ppt/media/image1.png', png1x1);
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>'
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const RAW_RGB_4X4 = Buffer.from([
  255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 255,
  0, 255, 255, 0, 0, 0, 128, 128, 128, 64, 64, 64,
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
  32, 64, 128, 160, 32, 64, 96, 160, 32, 200, 100, 50,
]);

function makePdfFixture() {
  const body =
    'Attention lets a model weigh which inputs matter most when producing an output. This lecture covers the intuition, the equations, and the practical details needed to implement it.';
  const pages = [];
  const headings = [
    'Introduction',
    'Self-Attention',
    'Multi-Head Attention',
    'Positional Encoding',
    'Practical Tips',
    'Wrap-Up',
  ];
  for (let p = 0; p < headings.length; p += 1) {
    const lines = [
      { size: 10, x: 72, y: 770, text: 'UNIVERSITY OF EXAMPLE' },
      { size: 24, x: 72, y: 720, text: headings[p] },
    ];
    let y = 690;
    for (let i = 0; i < 6; i += 1) {
      lines.push({ size: 12, x: 72, y, text: `${body} Paragraph ${i + 1} on page ${p + 1}.` });
      y -= 20;
    }
    pages.push(lines);
  }
  return makePdf(pages, [
    {
      images: [{ name: 'Im1', width: 4, height: 4, data: RAW_RGB_4X4 }],
      draws: [{ name: 'Im1', w: 120, h: 60, x: 100, y: 480 }],
    },
  ]);
}

async function waitForText(page, text, timeout = 20000) {
  try {
    await page.waitForFunction(
      (needle) => document.body && document.body.innerText.toLowerCase().includes(needle.toLowerCase()),
      { timeout },
      text
    );
  } catch (error) {
    const snapshot = await page.evaluate(() => document.body.innerText.slice(0, 1200));
    console.log('--- page snapshot ---\n' + snapshot + '\n--- end snapshot ---');
    if (errors.length) console.log('--- browser errors ---\n' + errors.join('\n'));
    throw error;
  }
}

async function clickButton(page, text) {
  const clicked = await page.evaluate((needle) => {
    const button = [...document.querySelectorAll('button')].find(
      (el) => el.innerText.trim() === needle
    );
    if (!button) return false;
    button.click();
    return true;
  }, text);
  assert.ok(clicked, `button "${text}" should exist`);
}

async function clickButtonContaining(page, text) {
  const clicked = await page.evaluate((needle) => {
    const button = [...document.querySelectorAll('button')].find((el) =>
      el.innerText.includes(needle)
    );
    if (!button) return false;
    button.click();
    return true;
  }, text);
  assert.ok(clicked, `button containing "${text}" should exist`);
}

async function textOf(page, selector) {
  return page.$eval(selector, (el) => el.innerText.trim());
}

async function waitForMainImage(page, timeout = 10000) {
  let last = null;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    last = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('main img')];
      return {
        count: imgs.length,
        loaded: imgs.filter((i) => i.naturalWidth > 0).length,
        detail: imgs.map((i) => `${i.naturalWidth}x${i.naturalHeight} ${i.src.slice(0, 32)}`),
      };
    });
    if (last.loaded > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`image never rendered: ${JSON.stringify(last)}`);
}

let checks = 0;
const errors = [];
function pass(label) {
  checks += 1;
  console.log('ok -', label);
}

const server = await startServer();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await waitForText(page, 'Focused reading for your study materials');
  pass('home screen renders');
  await clickButton(page, 'Open your library');
  await waitForText(page, 'Upload your study material');
  pass('library/import screen renders');

  const pwaReady = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      registrations: registrations.length,
      manifest: Boolean(document.querySelector('link[rel="manifest"]')),
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  assert.equal(pwaReady.manifest, true);
  assert.equal(pwaReady.background, 'rgb(242, 242, 247)');
  pass(`manifest linked, background colour correct, sw registrations: ${pwaReady.registrations}`);

  const pptx = await makePptxFixture();
  const pptxPath = join(fileURLToPath(new URL('./', import.meta.url)), 'lecture.pptx');
  await writeFile(pptxPath, pptx);

  const input = await page.$('input[type="file"]');
  await input.uploadFile(pptxPath);
  await waitForText(page, 'How long do you want to read?');
  pass('upload lands on the goal planner automatically');

  await waitForText(page, '12 chunks left · about');
  await clickButton(page, '20 min');
  await clickButton(page, 'Start reading');
  await waitForText(page, 'Chunk 1 of 12');
  const timerText = await page.$eval('[data-testid="goal-timer"]', (el) => el.innerText.trim());
  assert.match(timerText, /^\d+:\d{2}$/, `goal countdown renders: ${timerText}`);
  pass('planner starts the session with a reading-time goal and countdown');

  const pptxImageCount = await page.$$eval('main article img', (imgs) => imgs.length);
  assert.equal(pptxImageCount, 0, `pptx images should be removed, found ${pptxImageCount}`);
  pass('pptx slide images are not rendered');

  await waitForText(page, 'lecture.pptx');
  await waitForText(page, 'A short check-in comes after chunk 5');
  await waitForText(page, 'Lecture 6: Attention Models');
  pass('reading session shows filename, progress and the slide heading');

  await clickButton(page, 'Next');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForText(page, 'Chunk 2 of 12');
  await waitForText(page, 'Why attention matters');
  await clickButton(page, 'Next');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForText(page, 'Chunk 3 of 12');
  pass('each slide starts its own chunk');
  const readingLayout = await page.evaluate(() => {
    const article = document.querySelector('main article');
    const rect = article.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      ratio: Math.round((rect.width / rect.height) * 1000) / 1000,
    };
  });
  assert.ok(readingLayout.width >= 800, JSON.stringify(readingLayout));
  assert.ok(Math.abs(readingLayout.ratio - 16 / 9) < 0.08, JSON.stringify(readingLayout));
  pass('reading pane is a wide, slide-sized landscape card');
  await clickButton(page, 'Next');
  await waitForText(page, 'Quick check');
  const earlyCheck = await page.evaluate(() => document.body.innerText.includes('After chunk 3'));
  assert.ok(earlyCheck, 'pacing engine should tighten checkpoints when chunks are skimmed');
  pass('skimming detection tightens the checkpoint interval to every 3 chunks');

  await page.type('textarea', 'Attention weights decide which tokens matter.');
  await clickButton(page, 'Submit');
  await waitForText(page, 'Chunk 4 of 12');
  pass('checkpoint submit advances to the next chunk');

  await waitForText(page, "You're moving through this quickly");
  pass('skimming detection suggests a break');

  await clickButtonContaining(page, 'Take a 5-minute break');
  await waitForText(page, 'Rest your eyes for a moment');
  await waitForText(page, 'Break');
  pass('break overlay opens with a countdown');

  await clickButton(page, 'Resume reading');
  await waitForText(page, 'Chunk 4 of 12');
  pass('break overlay resumes the reading session');

  await clickButton(page, 'Mark chunk');
  await waitForText(page, 'Flag this chunk');
  await clickButton(page, 'Important');
  await clickButton(page, 'Save mark');
  await waitForText(page, 'Marked ✓');
  pass('annotate panel saves an important mark');

  await clickButton(page, 'Previous');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForText(page, 'Chunk 3 of 12');
  await clickButton(page, 'Next');
  await waitForText(page, 'Quick check');
  await clickButton(page, 'Skip');
  await waitForText(page, 'Chunk 4 of 12');
  pass('previous navigation re-opens the check-in for that chunk');

  for (let guard = 0; guard < 20; guard += 1) {
    const finished = await page.evaluate(() => document.body.innerText.includes('Session summary'));
    if (finished) break;
    const label = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const next = buttons.find((b) => ['Next', 'Finish'].includes(b.innerText.trim()));
      return next ? next.innerText.trim() : null;
    });
    if (!label) break;
    await clickButton(page, label);
    const checkpointOpen = await page.evaluate(() => document.body.innerText.toLowerCase().includes('quick check'));
    if (checkpointOpen) await clickButton(page, 'Skip');
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  await waitForText(page, 'Session summary');
  pass('finish navigates to the summary screen');

  const summaryRows = await page.$$eval('dl > div', (rows) =>
    rows.map((row) => row.innerText.replace(/\n+/g, ' ').trim())
  );
  assert.equal(summaryRows.length, 5);
  assert.ok(summaryRows.some((row) => row.startsWith('Chunks completed') && row.includes('12 of 12')), summaryRows.join(' | '));
  assert.ok(summaryRows.some((row) => row.startsWith('Check-ins answered')), summaryRows.join(' | '));
  assert.ok(summaryRows.some((row) => row.startsWith('Chunks marked important') && row.includes('1')), summaryRows.join(' | '));
  pass('summary reports chunks, checkpoints and marks');

  const fatigueCard = await page.evaluate(() => document.body.innerText.includes('Time for a short break?'));
  assert.equal(fatigueCard, false);
  pass('no fatigue card when the session looks healthy');

  await waitForText(page, 'Marks in this document');
  await waitForText(page, 'Chunk 4');
  await waitForText(page, 'Important');
  await clickButtonContaining(page, 'Go to chunk 4');
  await waitForText(page, 'Chunk 4 of 12');
  pass('summary lists marks with their chunk number and jumps back to them');
  await clickButton(page, 'Library');
  await waitForText(page, 'Your library');
  await waitForText(page, 'Chunk 12 of 12');
  pass('library shows resume progress');

  await clickButton(page, 'Goal');
  await waitForText(page, 'How long do you want to read?');
  await waitForText(page, 'continuing from chunk 4');
  await waitForText(page, '9 chunks left');
  await page.click('#goal-minutes');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.type('#goal-minutes', '1');
  await waitForText(page, 'The rest can wait for a second session');
  await waitForText(page, 'remaining chunks');
  await clickButton(page, '45 min');
  await waitForText(page, 'Looks good');
  pass('goal planner validates the budget against the chunks that are left');

  await clickButton(page, 'Settings');
  await waitForText(page, 'Preferences are saved on this device only');
  await clickButton(page, 'Large');
  await clickButton(page, 'Dark');
  await clickButton(page, 'Every 3');
  await page.waitForFunction(() => {
    const flash = document.querySelector('[data-testid="saved-flash"]');
    return flash && flash.classList.contains('opacity-100');
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(darkBackground, 'rgb(0, 0, 0)');
  pass('settings apply instantly: large text, dark theme, check-ins every 3');

  await clickButton(page, 'Library');
  await waitForText(page, 'Upload your study material');
  const pdf = makePdfFixture();
  const pdfPath = join(fileURLToPath(new URL('./', import.meta.url)), 'lecture.pdf');
  await writeFile(pdfPath, pdf);
  const input2 = await page.$('input[type="file"]');
  await input2.uploadFile(pdfPath);
  await waitForText(page, 'How long do you want to read?');
  await page.click('#goal-minutes');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.type('#goal-minutes', '1');
  await waitForText(page, 'The rest can wait for a second session');
  await waitForText(page, 'remaining chunks');
  await clickButton(page, '20 min');
  await waitForText(page, 'Looks good');
  pass('goal planner flags an infeasible budget for the remaining chunks');
  await clickButton(page, 'Start reading');
  await waitForText(page, 'Chunk 1 of 6');
  const firstTitle = await textOf(page, 'main h1');
  assert.equal(firstTitle, 'Introduction');
  pass('pdf import uses heading-based chunking titles');

  await waitForMainImage(page);
  const pdfImage = await page.evaluate(() => {
    const img = document.querySelector('main img');
    return {
      w: img.naturalWidth,
      h: img.naturalHeight,
      src: img.src.slice(0, 30),
      caption: img.closest('figure').querySelector('figcaption').innerText.trim(),
    };
  });
  assert.equal(pdfImage.w, 4, JSON.stringify(pdfImage));
  assert.equal(pdfImage.h, 4, JSON.stringify(pdfImage));
  assert.ok(pdfImage.src.startsWith('data:image/png;base64,'), pdfImage.src);
  assert.equal(pdfImage.caption, 'Figure 1 (Page 1)', JSON.stringify(pdfImage));
  pass('pdf figure renders in the chunk that surrounds it, captioned');

  const bodyStyle = await page.evaluate(() => {
    const paragraphs = [...document.querySelectorAll('main article p')];
    const bodyParagraph = paragraphs.find((p) => p.innerText.length > 120);
    const style = getComputedStyle(bodyParagraph);
    return { color: style.color, fontSize: style.fontSize };
  });
  assert.equal(bodyStyle.color, 'rgb(242, 242, 247)');
  assert.equal(bodyStyle.fontSize, '20px');
  const headingFont = await page.$eval('main h1', (el) => getComputedStyle(el).fontFamily);
  assert.ok(/Lora|Georgia|Palatino|serif/i.test(headingFont), headingFont);
  await waitForText(page, 'A short check-in comes after chunk 3');
  pass('dark theme, large reading text, serif headings and check-in interval apply');

  await clickButton(page, 'Next');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForText(page, 'Chunk 2 of 6');
  await clickButton(page, 'Next');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await waitForText(page, 'Chunk 3 of 6');
  await clickButton(page, 'Next');
  await waitForText(page, 'Quick check');
  await waitForText(page, 'After chunk 3');
  pass('checkpoint fires after chunk 3 with the saved frequency');
  await clickButton(page, 'Skip');
  await waitForText(page, 'Chunk 4 of 6');
  pass('checkpoint skip advances the session');

  for (let guard = 0; guard < 12; guard += 1) {
    const finished = await page.evaluate(() => document.body.innerText.includes('Session summary'));
    if (finished) break;
    const label = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const next = buttons.find((b) => ['Next', 'Finish'].includes(b.innerText.trim()));
      return next ? next.innerText.trim() : null;
    });
    if (!label) break;
    await clickButton(page, label);
    const checkpointOpen = await page.evaluate(() => document.body.innerText.toLowerCase().includes('quick check'));
    if (checkpointOpen) await clickButton(page, 'Skip');
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  await waitForText(page, 'Session summary');
  pass('pdf session completes to the summary');

  await clickButton(page, 'Back to library');
  await waitForText(page, 'lecture.pdf');
  pass('pdf document is listed in the library');

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (el) => el.getAttribute('aria-label') === 'Delete lecture.pdf'
    );
    if (button) button.click();
  });
  await waitForText(page, 'Remove lecture.pdf?');
  await clickButton(page, 'Delete');
  await page.waitForFunction(() => !document.body.innerText.includes('lecture.pdf'));
  await waitForText(page, 'lecture.pptx');
  pass('documents can be deleted from the library');

  await clickButtonContaining(page, 'lecture.pptx');
  await waitForText(page, 'How long do you want to read?');
  await waitForText(page, 'continuing from chunk 12');
  await page.click('#goal-minutes');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.type('#goal-minutes', '1');
  await clickButton(page, 'Start reading');
  await waitForText(page, 'Chunk 12 of 12');
  await waitForText(page, 'Time is up', 90000);
  pass('reading-time goal triggers the reminder when time is used up');

  await clickButton(page, 'Keep reading (+5 min)');
  await page.waitForFunction(() => !document.body.innerText.includes('Time is up'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="goal-timer"]');
    return el && /^[45]:\d{2}$/.test(el.innerText.trim());
  });
  pass('time-up reminder offers an extension and restarts the countdown');

  await clickButton(page, 'Finish');
  await waitForText(page, 'Session summary');
  await waitForText(page, 'finished the document');
  pass('finishing records the session after the reminder');

  const reloadPage = await browser.newPage();
  await reloadPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await waitForText(reloadPage, 'Focused reading for your study materials');
  const persisted = await reloadPage.evaluate(async () => {
    const databases = (await indexedDB.databases()).map((db) => db.name);
    return databases.includes('AcademicReader');
  });
  assert.equal(persisted, true);
  pass('home screen renders on reload and IndexedDB persists');
  await reloadPage.close();

  const unexpected = errors.filter((entry) => {
    const lower = entry.toLowerCase();
    return (
      !lower.includes('favicon') &&
      !lower.includes('failed to load resource') &&
      !lower.includes('err_socket_not_connected') &&
      !lower.includes('net::')
    );
  });
  assert.deepEqual(unexpected, [], `console errors: ${unexpected.join(' | ')}`);
  pass('no unexpected console or page errors');

  console.log(`\n${checks} browser checks passed`);
} finally {
  await browser.close();
  server.close();
  await rm(join(fileURLToPath(new URL('./', import.meta.url)), 'lecture.pptx'), {
    force: true,
  });
  await rm(join(fileURLToPath(new URL('./', import.meta.url)), 'lecture.pdf'), {
    force: true,
  });
}
