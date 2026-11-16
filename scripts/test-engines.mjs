import assert from 'node:assert';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import { chunkPptx, parseSlideParagraphs } from '../src/engines/chunking/pptxChunker.js';
import {
  chunkPdf,
  sanitiseStr,
  expandBullets,
  looksLikePageNumber,
  isHeadingLine,
  splitBulletSegments,
} from '../src/engines/chunking/pdfChunker.js';
import { validateFile, chunkFile, withDocumentMeta } from '../src/engines/chunking/index.js';
import { applyPacing } from '../src/engines/pacing/index.js';
import { detectFatigue } from '../src/engines/scheduler/index.js';
import { evaluateGoal } from '../src/engines/planner/index.js';
import { buildReport } from '../src/engines/reporting/index.js';
import { expectedReadingTime, capTimeSpent, createChunkTimer } from '../src/engines/engagement/index.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

let passed = 0;
async function ok(name, fn) {
  try {
    await fn();
  } catch (error) {
    console.log('FAIL -', name);
    console.log(error && error.stack ? error.stack : error);
    process.exitCode = 1;
    throw error;
  }
  passed += 1;
  console.log('ok -', name);
}

function esc(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(text, x, size, pageWidth = 612) {
  const usable = pageWidth - x - 18;
  const maxChars = Math.max(20, Math.floor(usable / (0.62 * size)));
  if (text.length <= maxChars) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < Math.floor(maxChars * 0.5)) {
      parts.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    } else {
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut + 1);
    }
  }
  if (rest) parts.push(rest);
  return parts;
}

function makePdf(pagesLines, pageExtras = [], { mediaBox = [612, 792] } = {}) {
  const [mediaWidth, mediaHeight] = mediaBox;
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
      const header = `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${image.filter ? ` /Filter ${image.filter}` : ''} /Length ${image.data.length} >>\nstream\n`;
      xobjIds[image.name] = push(header + image.data.toString('latin1') + '\nendstream');
    }
    let stream = 'BT\n';
    let first = true;
    let curX = 0;
    let curY = 0;
    for (const line of lines) {
      const dx = first ? line.x : line.x - curX;
      const dy = first ? line.y : line.y - curY;
      const parts = wrapLine(line.text, line.x, line.size, mediaWidth);
      const step = -(line.size * 1.2);
      parts.forEach((part, index) => {
        const move = index === 0 ? `${dx} ${dy} Td` : `0 ${step} Td`;
        stream += `/F1 ${line.size} Tf\n${move}\n(${esc(part)}) Tj\n`;
      });
      curX = line.x;
      curY = line.y + step * (parts.length - 1);
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
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${mediaWidth} ${mediaHeight}] /Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >>${xobjPart} >> >>`
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

const BODY_LONG =
  'Neural networks are computational models inspired by the brain. They consist of layers of neurons that transform input values into output predictions through weighted connections and nonlinear activation functions. Training adjusts the weights so that the network matches the target outputs on the examples it sees.';

await ok('validateFile rejects oversized files', () => {
  assert.throws(() => validateFile({ name: 'a.pdf', size: 26 * 1024 * 1024 }), /larger than 25 MB/);
});

await ok('validateFile rejects unsupported types', () => {
  assert.throws(() => validateFile({ name: 'notes.docx', size: 100 }), /Only \.pdf and \.pptx/);
});

await ok('validateFile accepts pdf and pptx', () => {
  assert.equal(validateFile({ name: 'Lecture.PDF', size: 100 }), 'pdf');
  assert.equal(validateFile({ name: 'Lecture.pptx', size: 100 }), 'pptx');
});

await ok('expectedReadingTime floors at 10 seconds', () => {
  assert.equal(expectedReadingTime(0), 10);
  assert.equal(expectedReadingTime(400), 200);
});

await ok('capTimeSpent caps at 3x expected', () => {
  assert.equal(capTimeSpent(10 * 60 * 1000, 200), 300000);
});

await ok('createChunkTimer accumulates and stops', async () => {
  const timer = createChunkTimer();
  timer.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  timer.pause();
  const elapsed = timer.elapsed();
  assert.ok(elapsed >= 25, `elapsed ${elapsed}`);
  const total = timer.stop();
  assert.equal(total, elapsed);
});

await ok('pacing tightens checkpoint frequency after 3 skims', () => {
  let state = { streak: 0, frequency: 5, changes: 0 };
  state = applyPacing(state, 500, 400);
  state = applyPacing(state, 500, 400);
  assert.equal(state.frequency, 5);
  state = applyPacing(state, 500, 400);
  assert.equal(state.frequency, 3);
  assert.equal(state.changes, 1);
  state = applyPacing(state, 500, 400);
  assert.equal(state.frequency, 3);
  state = applyPacing(state, 100000, 400);
  assert.equal(state.streak, 0);
});

await ok('fatigue requires two of three signals', () => {
  const slow = [10000, 10000, 10000, 20000, 22000, 25000];
  const navs = ['forward', 'backward', 'forward', 'backward', 'forward', 'forward'];
  const checks = [
    { response: '', responseTime: 1200, skipped: true },
    { response: 'ok', responseTime: 2000, skipped: false },
    { response: 'ok', responseTime: 9000, skipped: false },
  ];

  const timeOnly = detectFatigue({ chunkTimes: slow });
  assert.equal(timeOnly.signals.risingTime, true);
  assert.equal(timeOnly.detected, false, 'one signal is not enough');

  assert.equal(detectFatigue({ chunkTimes: slow, navigationEvents: navs }).detected, true);
  assert.equal(detectFatigue({ chunkTimes: [10000, 10000, 10000, 10000] }).signals.risingTime, false);

  const checksOnly = detectFatigue({ checkpointEvents: checks });
  assert.equal(checksOnly.signals.skippedCheckpoints, true);
  assert.equal(checksOnly.detected, false, 'one signal is not enough');

  assert.equal(detectFatigue({ navigationEvents: navs }).signals.backwardNavigation, true);
  assert.equal(
    detectFatigue({ checkpointEvents: checks, navigationEvents: navs }).detected,
    true,
    'two signals trigger fatigue'
  );
  assert.equal(detectFatigue({}).detected, false);
});

await ok('planner flags infeasible goals and suggests a plan', () => {
  const bad = evaluateGoal({ targetChunks: 20, availableMinutes: 10, frequency: 5 });
  assert.equal(bad.feasible, false);
  assert.ok(bad.suggestedChunks > 0 && bad.suggestedChunks < 20, `suggested ${bad.suggestedChunks}`);
  assert.match(bad.planText, /Read \d+ chunks now/);
  const good = evaluateGoal({ targetChunks: 5, availableMinutes: 60, frequency: 5 });
  assert.equal(good.feasible, true);
});

await ok('report aggregates logs and annotations', () => {
  const report = buildReport({
    logs: [
      { chunkIndex: 0, timeSpent: 60000, checkpointResponse: null, checkpointResponseTime: null },
      { chunkIndex: 1, timeSpent: 120000, checkpointResponse: 'answer', checkpointResponseTime: 9000 },
      { chunkIndex: 1, timeSpent: 1000, checkpointResponse: '', checkpointResponseTime: 1000 },
    ],
    annotations: [
      { type: 'confusing' },
      { type: 'confusing' },
      { type: 'important' },
    ],
    chunks: new Array(10).fill({}),
    pacingChanges: 1,
    startedAt: 0,
    endedAt: 600000,
  });
  assert.equal(report.chunksCompleted, 2);
  assert.equal(report.totalChunks, 10);
  assert.equal(report.checkpointsTotal, 2);
  assert.equal(report.checkpointsAnswered, 1);
  assert.equal(report.chunksMarkedConfusing, 2);
  assert.equal(report.chunksMarkedImportant, 1);
  assert.equal(report.sessionDuration, 10);
  assert.equal(report.empty, false);
  assert.equal(report.avgTimePerChunk, 60.3);
});

await ok('pptx keeps one slide per chunk, even for tiny slides', async () => {
  const slide = (runs) =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${runs
      .map(
        (text) =>
          `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
      )
      .join('')}</p:spTree></p:cSld></p:sld>`;
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', slide(['Neural Networks &amp; Learning', 'Line one.', 'Line two.']));
  zip.file('ppt/slides/slide2.xml', slide(['Slide two title']));
  zip.file('ppt/slides/slide3.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:sld>');
  zip.file('ppt/slides/slide10.xml', slide(['Slide ten', 'Body ten.']));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const chunks = await chunkPptx(buffer);
  assert.equal(chunks.length, 3, `expected 3 chunks, got ${chunks.length}`);
  assert.deepEqual(chunks.map((chunk) => chunk.slides), [[1], [2], [10]], 'empty slide 3 is skipped');
  assert.deepEqual(chunks.map((chunk) => chunk.pageRef), [1, 2, 10]);
  assert.deepEqual(
    chunks.map((chunk) => chunk.chunkingMethod),
    ['slides', 'slides', 'slides']
  );
  assert.equal(chunks[0].title, 'Neural Networks & Learning');
  assert.equal(chunks[0].hasText, true);
  assert.ok(chunks[0].body.includes('• Line one.'), chunks[0].body);
  assert.ok(chunks[0].body.includes('• Line two.'), chunks[0].body);
  assert.ok(!chunks[0].body.includes('# '), 'slide title is the chunk title, not a repeated heading');
  assert.equal(chunks[1].title, 'Slide two title');
  assert.equal(chunks[1].hasText, false);
  assert.equal(chunks[2].title, 'Slide ten');
  assert.ok(chunks[2].body.includes('• Body ten.'), chunks[2].body);
});

await ok('pptx splits long slide decks one slide per chunk', async () => {
  const sentence = 'Attention models weigh every input token when producing each output. ';
  const slide = (title, body) =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const zip = new JSZip();
  const totalSlides = 12;
  for (let i = 1; i <= totalSlides; i += 1) {
    zip.file(
      `ppt/slides/slide${i}.xml`,
      slide(`Slide ${i}: Transformers`, sentence.repeat(10).trim())
    );
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const chunks = await chunkPptx(buffer);
  assert.equal(chunks.length, totalSlides, `expected ${totalSlides} chunks, got ${chunks.length}`);
  assert.deepEqual(
    chunks.map((chunk) => chunk.slides),
    Array.from({ length: totalSlides }, (_, i) => [i + 1])
  );
  for (const chunk of chunks) {
    assert.ok(
      chunk.wordCount >= 70 && chunk.wordCount <= 280,
      `chunk length should stay inside the target range: ${chunk.wordCount}`
    );
  }
  assert.equal(chunks[1].title, 'Slide 2: Transformers');
  assert.ok(chunks[1].body.includes('• Attention models'), 'body bullets are formatted');
  assert.ok(!chunks[1].body.includes('# Slide 2'), 'a lone slide heading is the chunk title');
});

await ok('pptx bullets keep their nesting levels and numbered lists survive', () => {
  const xml =
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Deck title</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:txBody>' +
    '<a:p><a:pPr lvl="0" marL="342900"><a:buChar char="•"/></a:pPr><a:r><a:t>Top bullet</a:t></a:r></a:p>' +
    '<a:p><a:pPr lvl="1" marL="685800"><a:buChar char="-"/></a:pPr><a:r><a:t>Nested bullet</a:t></a:r></a:p>' +
    '<a:p><a:pPr marL="342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Numbered one</a:t></a:r></a:p>' +
    '<a:p><a:pPr marL="342900"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Numbered two</a:t></a:r></a:p>' +
    '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
  const { title, paragraphs } = parseSlideParagraphs(xml);
  assert.equal(title, 'Deck title');
  assert.equal(paragraphs.length, 4);
  assert.equal(paragraphs[0].level, 0);
  assert.equal(paragraphs[1].level, 1);
  assert.equal(paragraphs[2].isNumbered, true);
  assert.equal(paragraphs[3].isNumbered, true);
  assert.equal(paragraphs[0].numbered, true);
});

await ok('private-use bullet glyphs become readable bullet lines', () => {
  const raw = 'Introduction\uE000First point\uE000Second point';
  const sanitised = sanitiseStr(raw);
  assert.ok(!/[\uE000-\uF8FF\uFFFD]/.test(sanitised), 'private-use characters remain');
  const expanded = expandBullets(sanitised);
  assert.equal(expanded, '• Introduction\n• First point\n• Second point');
  assert.ok(!expanded.includes('§BULLET§'), 'sentinel leaked into output');
});

await ok('stray bullet sentinels are stripped when there is no list', () => {
  assert.equal(expandBullets('§BULLET§'), '');
  assert.equal(expandBullets('Plain text §BULLET§'), 'Plain text');
});

await ok('pdf heading strategy makes uniform chunks and strips running headers', async () => {
  const pages = [];
  const headings = ['Introduction', 'Background', 'Applications'];
  for (let p = 0; p < 3; p += 1) {
    const lines = [
      { size: 10, x: 72, y: 770, text: 'UNIVERSITY OF EXAMPLE' },
      { size: 24, x: 72, y: 720, text: headings[p] },
    ];
    let y = 680;
    for (let i = 0; i < 8; i += 1) {
      lines.push({ size: 12, x: 72, y, text: `${BODY_LONG} sentence ${i + 1} on page ${p + 1}.` });
      y -= 18;
    }
    pages.push(lines);
  }
  const chunks = await chunkPdf(makePdf(pages));
  assert.equal(
    chunks.length,
    6,
    `expected 6 chunks, got ${chunks.length}: ${chunks.map((c) => c.title).join(' | ')}`
  );
  assert.equal(chunks[0].title, 'Introduction');
  assert.equal(chunks[1].title, 'Introduction (continued)');
  assert.equal(chunks[2].title, 'Background');
  assert.equal(chunks[3].title, 'Background (continued)');
  assert.equal(chunks[0].chunkingMethod, 'heading');
  assert.ok(!chunks[0].body.includes('UNIVERSITY OF EXAMPLE'), 'running header should be stripped');
  for (const chunk of chunks) {
    assert.ok(chunk.hasText);
    assert.ok(
      chunk.wordCount >= 150 && chunk.wordCount <= 300,
      `chunk should stay near the target: ${chunk.wordCount}`
    );
  }
  const spread = Math.abs(chunks[0].wordCount - chunks[1].wordCount);
  assert.ok(spread <= 60, `chunks within a section should be even: ${chunks[0].wordCount} vs ${chunks[1].wordCount}`);
});

await ok('pdf paragraph strategy keeps chunks near the target length', async () => {
  const lines = [];
  let y = 740;
  for (let para = 0; para < 8; para += 1) {
    for (let line = 0; line < 4; line += 1) {
      lines.push({ size: 12, x: 72, y, text: `Paragraph ${para + 1} line ${line + 1}. ${BODY_LONG}` });
      y -= 14;
    }
    y -= 20;
  }
  const chunks = await chunkPdf(makePdf([lines]));
  assert.ok(chunks.length >= 2, `expected >= 2 chunks, got ${chunks.length}`);
  assert.equal(chunks[0].chunkingMethod, 'paragraph');
  for (const chunk of chunks) {
    assert.ok(chunk.wordCount <= 280, `chunk too big: ${chunk.wordCount}`);
    assert.ok(chunk.wordCount >= 70, `chunk too small: ${chunk.wordCount}`);
  }
  const counts = chunks.map((chunk) => chunk.wordCount);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  assert.ok(max / min <= 1.5, `chunks should be uniform: ${counts.join(', ')}`);
});

await ok('pdf footer and header page numbers are removed from chunk text', async () => {
  assert.equal(looksLikePageNumber('12'), true);
  assert.equal(looksLikePageNumber('Page 3'), true);
  assert.equal(looksLikePageNumber('Page 3.'), true);
  assert.equal(looksLikePageNumber('- 7 -'), true);
  assert.equal(looksLikePageNumber('3 / 20'), true);
  assert.equal(looksLikePageNumber('Chapter 3'), false);
  assert.equal(looksLikePageNumber('Section 2.1'), false);
  assert.equal(looksLikePageNumber('Figure 4'), false);

  const page = (heading, pageNumber) => [
    { size: 24, x: 72, y: 720, text: heading },
    { size: 12, x: 72, y: 690, text: BODY_LONG },
    { size: 12, x: 72, y: 672, text: BODY_LONG },
    { size: 12, x: 72, y: 654, text: BODY_LONG },
    { size: 10, x: 300, y: 30, text: pageNumber },
    { size: 10, x: 300, y: 770, text: pageNumber },
  ];
  const chunks = await chunkPdf(makePdf([page('Alpha', 'Page 1'), page('Beta', 'Page 2')]));
  assert.equal(chunks.length, 2, chunks.map((chunk) => chunk.title).join(' | '));
  const text = chunks.map((chunk) => chunk.body).join('\n');
  assert.ok(!/page 1/i.test(text), text.slice(0, 200));
  assert.ok(!/page 2/i.test(text), text.slice(-200));
});

await ok('pdf starts a new chunk at every heading, even for short sections', async () => {
  const headings = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const lines = [];
  let y = 730;
  for (const heading of headings) {
    lines.push({ size: 24, x: 72, y, text: heading });
    y -= 44;
    lines.push({
      size: 12,
      x: 72,
      y,
      text: 'Short section text that is deliberately brief and easy to skim through quickly.',
    });
    y -= 60;
  }
  const chunks = await chunkPdf(makePdf([lines]));
  assert.deepEqual(
    chunks.map((chunk) => chunk.title),
    headings,
    chunks.map((chunk) => `${chunk.title}:${chunk.wordCount}`).join(' | ')
  );
  for (const chunk of chunks) {
    assert.ok(chunk.body.includes('deliberately brief'), chunk.body);
    assert.ok(!chunk.body.includes('#'), 'no other section leaks into a heading chunk');
  }
});

await ok('pdf heading detection rejects long or sentence-like lines', async () => {
  const bodySize = 12;
  const line = (text, fontSize, fontFamily = 'ArialMT') => ({ text, fontSize, fontFamily });
  assert.equal(isHeadingLine(line('Introduction', 24), bodySize), true);
  assert.equal(isHeadingLine(line('Why attention matters?', 24), bodySize), true);
  assert.equal(isHeadingLine(line('Methods', 13.5, 'Arial-BoldMT'), bodySize), true);
  assert.equal(isHeadingLine(line('RESULTS', 12), bodySize), true);
  assert.equal(isHeadingLine(line('Body copy stays body copy', 12), bodySize), false);
  assert.equal(
    isHeadingLine(
      line('A Very Long Heading That Runs Across The Entire Line And Keeps Going On And On', 24),
      bodySize
    ),
    false
  );
  assert.equal(
    isHeadingLine(line('Attention '.repeat(20).trim(), 24), bodySize),
    false,
    'a heading can never be a whole chunk of text'
  );
  assert.equal(isHeadingLine(line('This sentence ends like a normal paragraph.', 24), bodySize), false);
  assert.equal(isHeadingLine(line('Figure 2. Attention overview.', 13.5), bodySize), false);
  assert.equal(isHeadingLine(line('UNIVERSITY OF EXAMPLE', 10), bodySize), false);
});

await ok('pdf keeps every section inside the hard word maximum', async () => {
  const lines = [];
  let y = 740;
  const sectionWords = `${BODY_LONG} ${BODY_LONG}`;
  for (let section = 0; section < 6; section += 1) {
    lines.push({ size: 24, x: 72, y, text: `Section ${section + 1}` });
    y -= 40;
    for (let line = 0; line < 4; line += 1) {
      lines.push({ size: 12, x: 72, y, text: `${sectionWords} Part ${line + 1}.` });
      y -= 16;
    }
    y -= 10;
  }
  const chunks = await chunkPdf(makePdf([lines]));
  assert.ok(chunks.length >= 6, `expected at least one chunk per section: ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.wordCount <= 280, `chunk over the hard cap: ${chunk.wordCount}`);
  }
  assert.ok(
    chunks.filter((chunk) => chunk.title === 'Section 1').length === 1,
    'the first section keeps its own heading chunk'
  );
});

await ok('pdf falls back to page chunking for tiny documents', async () => {
  const chunks = await chunkPdf(
    makePdf([[{ size: 24, x: 72, y: 720, text: 'Only a title' }]])
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunkingMethod, 'page');
  assert.equal(chunks[0].title, 'Page 1');
});

await ok('pdf detects slide-deck exports and keeps one page per chunk', async () => {
  const filler = [
    'Short bullets keep the slide readable.',
    'Each slide carries one idea.',
    'Visual hierarchy guides attention.',
    'Whitespace gives the eye rest.',
  ];
  const pages = [];
  for (let p = 1; p <= 6; p += 1) {
    const lines = [{ size: 30, x: 60, y: 80, text: `Deck slide ${p}` }];
    filler.forEach((text, index) => {
      lines.push({ size: 18, x: 60, y: 150 + index * 40, text: `${text} ${p}-${index}` });
    });
    pages.push(lines);
  }
  const chunks = await chunkPdf(makePdf(pages, [], { mediaBox: [960, 540] }));
  assert.equal(chunks.length, 6, `expected one chunk per slide: ${chunks.length}`);
  assert.deepEqual(
    chunks.map((chunk) => chunk.chunkingMethod),
    Array.from({ length: 6 }, () => 'slides')
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.title),
    Array.from({ length: 6 }, (_, i) => `Deck slide ${i + 1}`)
  );
  chunks.forEach((chunk, index) => {
    assert.equal(chunk.pageRef, index + 1);
    assert.ok(chunk.wordCount > 0, 'slide body survives chunking');
  });
});

await ok('pdf splits bullet runs so headings stay short', () => {
  const parts = splitBulletSegments(
    'How to minimize Overfitting §BULLET§ Reduce model complexity §BULLET§ Training with more data §BULLET§ Early stopping'
  );
  assert.deepEqual(parts, [
    'How to minimize Overfitting',
    '• Reduce model complexity',
    '• Training with more data',
    '• Early stopping',
  ]);
  assert.equal(isHeadingLine({ text: parts[0], fontSize: 22, fontFamily: 'Arial-Bold' }, 12), true);
  assert.equal(isHeadingLine({ text: parts[1], fontSize: 22, fontFamily: 'Arial-Bold' }, 12), false);
  assert.equal(isHeadingLine({ text: 'Title §BULLET§ body', fontSize: 22 }, 12), false);
});

await ok('chunkFile surfaces no-readable-content errors', async () => {
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:sld>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => chunkFile({ name: 'empty.pptx', size: buffer.length }, buffer), /No readable content/);
});

await ok('withDocumentMeta assigns stable ids and indexes', () => {
  const chunks = withDocumentMeta(
    [{ title: 'A', body: 'a', wordCount: 1, hasText: true, pageRef: 1 }],
    'doc_7'
  );
  assert.equal(chunks[0].id, 'doc_7_chunk_0');
  assert.equal(chunks[0].documentId, 'doc_7');
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[0].source, 'pdf');
});

const RAW_RGB_4X4 = Buffer.from([
  255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 255,
  0, 255, 255, 0, 0, 0, 128, 128, 128, 64, 64, 64,
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
  32, 64, 128, 160, 32, 64, 96, 160, 32, 200, 100, 50,
]);

function pngChunkData(png, type) {
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const chunkType = png.slice(offset + 4, offset + 8).toString('latin1');
    if (chunkType === type) return png.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  return null;
}

await ok('pdf carries images into the chunk whose text surrounds them', async () => {
  const lines = [
    { size: 10, x: 72, y: 770, text: 'UNIVERSITY OF EXAMPLE' },
    { size: 24, x: 72, y: 720, text: 'Introduction' },
    { size: 12, x: 72, y: 690, text: BODY_LONG },
    { size: 12, x: 72, y: 672, text: BODY_LONG },
    { size: 12, x: 72, y: 654, text: BODY_LONG },
    { size: 24, x: 72, y: 300, text: 'Methods' },
    { size: 12, x: 72, y: 270, text: BODY_LONG },
    { size: 12, x: 72, y: 252, text: BODY_LONG },
    { size: 12, x: 72, y: 234, text: BODY_LONG },
  ];
  const chunks = await chunkPdf(
    makePdf(
      [lines],
      [
        {
          images: [{ name: 'Im1', width: 4, height: 4, data: RAW_RGB_4X4 }],
          draws: [{ name: 'Im1', w: 60, h: 60, x: 100, y: 340 }],
        },
      ]
    )
  );
  assert.equal(chunks.length, 2, chunks.map((c) => c.title).join(' | '));
  assert.equal(chunks[0].images.length, 0, 'figure must not leak into the first section');
  assert.equal(chunks[1].images.length, 1, 'figure sits with the closest text');
  const src = chunks[1].images[0].src;
  assert.ok(src.startsWith('data:image/png;base64,'), src.slice(0, 40));
  const png = Buffer.from(src.slice('data:image/png;base64,'.length), 'base64');
  assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 4, 'png width');
  assert.equal(png.readUInt32BE(20), 4, 'png height');
  const raw = inflateSync(pngChunkData(png, 'IDAT'));
  assert.equal(raw.length, 4 * (1 + 4 * 4));
  assert.deepEqual([...raw.slice(0, 5)], [0, 255, 0, 0, 255], 'first pixel survives as-is');
  assert.equal(chunks[1].images[0].width, 4);
  assert.equal(chunks[1].images[0].height, 4);
  assert.equal(chunks[1].images[0].page, 1, 'image records its page for the caption');
});

await ok('pdf image-only documents import as image chunks', async () => {
  const buffer = makePdf(
    [[]],
    [
      {
        images: [{ name: 'Im1', width: 4, height: 4, data: RAW_RGB_4X4 }],
        draws: [{ name: 'Im1', w: 80, h: 80, x: 100, y: 500 }],
      },
    ]
  );
  const chunks = await chunkPdf(buffer);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].hasText, false);
  assert.equal(chunks[0].images.length, 1);
  assert.ok(chunks[0].images[0].src.startsWith('data:image/png;base64,'));
  const viaFile = await chunkFile({ name: 'figures.pdf', size: buffer.length }, buffer);
  assert.equal(viaFile.length, 1, 'image-only pdf must pass the readable-content check');
});

await ok('pptx strips embedded slide media (images removed)', async () => {
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const spRuns = (runs) =>
    runs
      .map(
        (text) =>
          `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
      )
      .join('');
  const slideWithPicture = (runs) =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>${spRuns(
      runs
    )}<p:pic><p:blipFill><a:blip r:embed="rId2"/><a:blip r:embed="rId3"/><a:blip r:embed="rId4"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`;
  const plainSlide = (runs) =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${spRuns(
      runs
    )}</p:spTree></p:cSld></p:sld>`;
  const rels = `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/chart.emf"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/missing.png"/></Relationships>`;
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', slideWithPicture(['Picture slide', 'Body one.']));
  zip.file('ppt/slides/_rels/slide1.xml.rels', rels);
  zip.file('ppt/media/image1.png', imageBytes);
  zip.file('ppt/media/chart.emf', Buffer.from([9, 9, 9]));
  zip.file('ppt/slides/slide2.xml', slideWithPicture([]));
  zip.file('ppt/slides/_rels/slide2.xml.rels', rels);
  zip.file('ppt/slides/slide3.xml', plainSlide(['Text only, no media']));
  zip.file('ppt/slides/_rels/slide3.xml.rels', rels);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  const chunks = await chunkPptx(buffer);
  // Slide 2 becomes empty once media is stripped, so it is skipped.
  assert.equal(chunks.length, 2, `text-bearing slides become chunks, got ${chunks.length}`);
  assert.deepEqual(
    chunks.map((chunk) => chunk.slides),
    [[1], [3]]
  );
  assert.equal(chunks[0].title, 'Picture slide');
  assert.equal(chunks[0].images.length, 0, 'pptx images must be removed');
  assert.ok(chunks[0].body.includes('• Body one.'), chunks[0].body);
  assert.equal(chunks[1].title, 'Text only, no media');
  assert.equal(chunks[1].images.length, 0);

  const viaFile = await chunkFile({ name: 'deck.pptx', size: buffer.length }, buffer);
  assert.equal(viaFile.length, 2);
});

console.log(`\n${passed} engine tests passed`);
