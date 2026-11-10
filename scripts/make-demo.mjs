import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const OUT_DIR = path.resolve('public/demo');

const PAGES = [
  {
    heading: 'Attention and Learning',
    blocks: [
      ['p', 'Attention is the gateway through which information enters working memory. When attention wanders, comprehension drops even if the eyes keep moving across the page. This short reader explores how deliberate pacing, self-testing, and honest reflection can keep study sessions focused.'],
      ['h', 'Why attention is limited'],
      ['p', 'Human attention is a scarce resource. It can be sustained for a while, but it depletes as effort accumulates. Researchers describe this as directed attention fatigue: the longer we force ourselves to concentrate without a break, the harder it becomes to resist distraction.'],
      ['p', 'The practical consequence is that marathon reading sessions are often inefficient. A learner may spend three hours at a desk and remember less than a learner who reads in several shorter, well-paced blocks with brief rests in between.'],
      ['b', 'Attention is limited and depletes with sustained effort.'],
      ['b', 'Short sessions with rest protect comprehension.'],
      ['b', 'Noticing fatigue early prevents wasted study time.'],
    ],
  },
  {
    heading: 'Chunking Study Material',
    blocks: [
      ['p', 'Chunking means breaking a long document into smaller, meaningful units. A chapter becomes sections, a section becomes paragraphs, and a slide deck becomes individual slides. Each chunk should be small enough to finish in one focused sitting.'],
      ['h', 'Why chunking works'],
      ['p', 'Working memory holds only a handful of items at once. Large blocks of text overwhelm it, so readers skim to cope. Short chunks reduce the load and make it easier to notice when understanding breaks down.'],
      ['p', 'Chunk boundaries also create natural stopping points. Instead of deciding whether to continue at an arbitrary moment, the reader completes a unit, pauses, and then chooses whether to go on.'],
      ['b', 'Small units fit working memory.'],
      ['b', 'Boundaries create natural breaks.'],
      ['b', 'Completion gives a sense of progress.'],
    ],
  },
  {
    heading: 'Retrieval Practice',
    blocks: [
      ['p', 'Retrieval practice is the act of pulling information out of memory rather than putting it in. After reading a chunk, a reader might close the text and explain the main idea aloud. This effortful recall strengthens memory far more than rereading.'],
      ['h', 'Checkpoints during reading'],
      ['p', 'A checkpoint is a brief pause in which the reader answers a question from memory. The question does not need to be graded. Its purpose is to interrupt passive reading and force the reader to reconstruct what was just learned.'],
      ['p', 'Even a skipped checkpoint carries information. If a reader repeatedly skips or answers in a few seconds, that pattern may signal fatigue or disengagement rather than mastery.'],
      ['b', 'Recall beats rereading.'],
      ['b', 'Ungraded checkpoints still improve memory.'],
      ['b', 'Skipping can be a signal, not just a choice.'],
    ],
  },
  {
    heading: 'Pacing and Fatigue',
    blocks: [
      ['p', 'Pacing is the deliberate control of reading speed and rest. Faster is not always better. A reader who races through a dense page may need to go back, which costs more time than reading carefully once.'],
      ['h', 'Signals of fatigue'],
      ['p', 'Three observable signals often appear together before a reader gives up. Reading time per chunk rises. Checkpoint answers become short or skipped. Navigation starts moving backward as the reader loses the thread.'],
      ['p', 'When several signals appear at once, the responsible response is to stop, rest, and return later. Continuing in a fatigued state produces the illusion of work without the benefit of learning.'],
      ['b', 'Rising time per chunk is a warning sign.'],
      ['b', 'Short or skipped answers suggest overload.'],
      ['b', 'Backward navigation suggests lost comprehension.'],
    ],
  },
  {
    heading: 'Planning a Session',
    blocks: [
      ['p', 'A good study plan starts with two numbers: how much there is to read and how much time is available. Comparing the two prevents the common mistake of setting a goal that cannot be met.'],
      ['h', 'Making the plan realistic'],
      ['p', 'Estimate reading time from the number of words, then add time for checkpoints. If the total exceeds the available window, reduce the number of chunks rather than rushing. It is better to finish a smaller portion well than to skim a larger one.'],
      ['p', 'A plan should also include a stopping rule. When the time is up, the reader stops and records where to resume. This makes it easier to return later without rereading the whole document.'],
      ['b', 'Compare reading load with available time.'],
      ['b', 'Reduce the goal instead of rushing.'],
      ['b', 'Record where to resume.'],
    ],
  },
  {
    heading: 'Reflecting on Progress',
    blocks: [
      ['p', 'Reflection turns a reading session into usable knowledge. A short summary of what was read, what was confusing, and what should be reviewed next helps the reader plan the following session.'],
      ['h', 'What to record'],
      ['p', 'Useful records include the number of chunks completed, the time spent, the checkpoints answered, and the sections marked as confusing or important. These details reveal patterns that are invisible during the session itself.'],
      ['p', 'Over time, the records show which conditions support focus. A reader may discover that sessions after lunch are weaker, or that a particular document format consistently causes fatigue. That knowledge is as valuable as the content itself.'],
      ['b', 'Summaries make progress visible.'],
      ['b', 'Marks identify what to review.'],
      ['b', 'Patterns guide better future sessions.'],
    ],
  },
];

function escapePdf(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '');
}

function wrap(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildContent(page, pageNumber) {
  const ops = [];
  let y = 744;

  ops.push(`BT /F1 20 Tf 72 ${y} Td (${escapePdf(page.heading)}) Tj ET`);
  y -= 34;

  for (const [type, text] of page.blocks) {
    if (type === 'h') {
      y -= 8;
      ops.push(`BT /F1 13 Tf 72 ${y} Td (${escapePdf(text)}) Tj ET`);
      y -= 20;
    } else if (type === 'b') {
      const lines = wrap(`- ${text}`, 88);
      for (const line of lines) {
        ops.push(`BT /F1 11 Tf 90 ${y} Td (${escapePdf(line)}) Tj ET`);
        y -= 15;
      }
      y -= 2;
    } else {
      for (const line of wrap(text, 88)) {
        ops.push(`BT /F1 11 Tf 72 ${y} Td (${escapePdf(line)}) Tj ET`);
        y -= 15;
      }
      y -= 8;
    }
    if (y < 80) break;
  }

  ops.push(`BT /F1 9 Tf 295 42 Td (Page ${pageNumber}) Tj ET`);
  return ops.join('\n');
}

function buildPdf() {
  const pageCount = PAGES.length;
  const maxObj = 3 + pageCount * 2;
  const contents = PAGES.map((page, index) => buildContent(page, index + 1));

  const kids = PAGES.map((_, index) => `${4 + index * 2} 0 R`).join(' ');

  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  for (let i = 0; i < pageCount; i += 1) {
    const pageNum = 4 + i * 2;
    const contentNum = pageNum + 1;
    const stream = contents[i];
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
    objects[contentNum] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let num = 1; num <= maxObj; num += 1) {
    offsets[num] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${maxObj + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let num = 1; num <= maxObj; num += 1) {
    pdf += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slideXml(lines) {
  const paragraphs = lines
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" sz="2000"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    `<p:cSld><p:spTree><p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  );
}

const SLIDES = [
  ['Attention and Learning', 'Why focus matters for study', 'Attention is a limited resource', 'Pacing and rest protect comprehension', 'Checkpoints turn reading into recall'],
  ['Chunking Study Material', 'Break long documents into small units', 'Each chunk fits in one sitting', 'Natural stopping points reduce overload', 'Progress becomes visible'],
  ['Retrieval Practice', 'Pull information out of memory', 'Explain the main idea after each chunk', 'Ungraded checkpoints still help', 'Skipping can signal fatigue'],
  ['Pacing and Fatigue', 'Watch time per chunk', 'Short answers suggest overload', 'Backward navigation suggests lost comprehension', 'Rest before continuing'],
  ['Planning a Session', 'Compare reading load with available time', 'Reduce the goal instead of rushing', 'Record where to resume', 'Finish a smaller portion well'],
  ['Reflecting on Progress', 'Summarise what was read', 'Mark confusing and important sections', 'Look for patterns across sessions', 'Use records to plan the next session'],
];

async function buildPptx() {
  const zip = new JSZip();

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    SLIDES.map(
      (_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    ).join('') +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
    '</Relationships>';

  const slideIds = SLIDES.map(
    (_, index) =>
      `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`
  ).join('');

  const presentation =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:sldIdLst>' +
    slideIds +
    '</p:sldIdLst>' +
    '</p:presentation>';

  const presentationRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    SLIDES.map(
      (_, index) =>
        `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
    ).join('') +
    '</Relationships>';

  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('ppt/presentation.xml', presentation);
  zip.file('ppt/_rels/presentation.xml.rels', presentationRels);

  SLIDES.forEach((lines, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, slideXml(lines));
  });

  return zip.generateAsync({ type: 'nodebuffer' });
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'academic-reading-demo.pdf'), buildPdf());
fs.writeFileSync(path.join(OUT_DIR, 'academic-reading-demo.pptx'), await buildPptx());
console.log('Demo files written to public/demo');
