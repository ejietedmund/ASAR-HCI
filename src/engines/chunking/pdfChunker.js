import * as pdfjsLib from 'pdfjs-dist';
import { downscaleDataUrl, imageObjToDataUrl } from './imageUtils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const HEADING_SCALE = 1.2;
const HEADING_SOFT_SCALE = 1.12;
const HEADING_MAX_CHARS = 72;
const HEADING_MAX_WORDS = 14;
const HEADER_BAND = 0.05;
const HEADER_MIN_PAGES = 3;
const PAGE_NUMBER_BAND = 0.08;

// Uniform chunk targets: every reading chunk is paced to roughly the same
// length so no single chunk ever becomes a wall of text.
export const TARGET_CHUNK_WORDS = 220;
export const MAX_CHUNK_WORDS = 280;
export const MIN_CHUNK_WORDS = 70;
const SENTENCE_GROUP_TARGET_WORDS = 80;
const SENTENCE_MAX_WORDS = 60;
const MAX_IMAGES_PER_PAGE = 8;
const MAX_IMAGES_PER_CHUNK = 6;

const OPS_SAVE = 10;
const OPS_RESTORE = 11;
const OPS_TRANSFORM = 12;
const OPS_PAINT_IMAGE = 85;
const OPS_PAINT_INLINE_IMAGE = 86;
const OPS_PAINT_IMAGE_REPEAT = 88;
const IDENTITY = [1, 0, 0, 1, 0, 0];

export function sanitiseStr(str) {
  if (typeof str !== 'string') return '';
  return str.replace(
    /[\uE000-\uF8FF\uFFFD\uFFF0-\uFFFF\u25A0-\u25FF\u2758-\u2759\u0000-\u0008\u000B-\u001F]/g,
    ' \u00A7BULLET\u00A7 '
  );
}

export function expandBullets(text) {
  if (typeof text !== 'string') return '';
  const parts = text
    .split(/\s*(?:\u00A7BULLET\u00A7\s*)+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return text.replace(/\u00A7BULLET\u00A7/g, '').trim();
  }

  return parts.map((part) => `\u2022 ${part}`).join('\n');
}

function matMul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function placement(matrix, pageHeight) {
  const [a, b, c, d, e, f] = matrix;
  const xs = [e, a + e, c + e, a + c + e];
  const ys = [f, b + f, d + f, b + d + f];
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    left: Math.min(...xs),
    top: pageHeight - maxY,
    width: Math.max(...xs) - Math.min(...xs),
    height: maxY - minY,
    center: pageHeight - (minY + maxY) / 2,
  };
}

async function extractPageImages(page, pageHeight) {
  const found = [];
  try {
    const opList = await page.getOperatorList();
    const stack = [];
    let current = IDENTITY;
    const addFromObj = async (obj, matrix, fixedSize) => {
      if (!obj || obj.imageMask || !obj.width || !obj.height) return;
      if (found.length >= MAX_IMAGES_PER_PAGE) return;
      const raw = imageObjToDataUrl(obj);
      if (!raw) return;
      const src = await downscaleDataUrl(raw);
      if (!src) return;
      const box = fixedSize
        ? { left: null, top: null, width: obj.width, height: obj.height, center: Number.NaN }
        : placement(matrix, pageHeight);
      found.push({ ...box, src, width: obj.width, height: obj.height });
    };
    for (let i = 0; i < opList.fnArray.length; i += 1) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS_SAVE) {
        stack.push(current);
        current = current.slice();
      } else if (fn === OPS_RESTORE) {
        current = stack.pop() || IDENTITY;
      } else if (fn === OPS_TRANSFORM) {
        current = matMul(current, args);
      } else if (fn === OPS_PAINT_IMAGE || fn === OPS_PAINT_IMAGE_REPEAT) {
        const objId = args[0];
        if (page.objs && page.objs.has(objId)) {
          await addFromObj(page.objs.get(objId), current, fn === OPS_PAINT_IMAGE_REPEAT);
        }
      } else if (fn === OPS_PAINT_INLINE_IMAGE) {
        await addFromObj(args && args[0], current, false);
      }
    }
  } catch {
    return [];
  }
  return found;
}

function addToCoverage(coverage, pageNum, y0, y1) {
  const existing = coverage.get(pageNum);
  if (!existing) {
    coverage.set(pageNum, { pageNum, minY: y0, maxY: y1 });
    return;
  }
  if (y0 < existing.minY) existing.minY = y0;
  if (y1 > existing.maxY) existing.maxY = y1;
}

function coverageToArray(coverage) {
  return [...coverage.values()];
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function normalize(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function joinItems(items) {
  const parts = [...items].sort((a, b) => a.x - b.x).map((item) => sanitiseStr(item.str));
  let out = '';
  for (const part of parts) {
    if (!out) {
      out = part;
      continue;
    }
    if (/\s$/.test(out) || /^\s/.test(part)) {
      out += part;
    } else if (/^[.,;:!?)\]}'"]/.test(part)) {
      out += part;
    } else {
      out += ' ' + part;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

async function extractPages(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const content = await page.getTextContent();
    const styles = content.styles || {};
    const images = await extractPageImages(page, pageHeight);
    const items = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string' || item.str === '') continue;
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const fontSize = Math.hypot(transform[2], transform[3]) || Math.abs(transform[3]) || 10;
      const style = styles[item.fontName] || {};
      items.push({
        str: item.str,
        fontSize,
        fontFamily: style.fontFamily || style.fontName || item.fontName || '',
        x: transform[4],
        y: pageHeight - transform[5],
        width: item.width || 0,
        pageNum,
        pageHeight,
      });
    }
    pages.push({ pageNum, pageHeight, pageWidth: viewport.width, items, images });
    if (typeof page.cleanup === 'function') page.cleanup();
  }
  if (typeof pdf.destroy === 'function') await pdf.destroy();
  return pages;
}

/**
 * PDF bullet glyphs are extracted inside a single line. Splitting on the
 * sentinel gives one line per bullet, so list items never bleed into a heading
 * or collapse into one unreadable paragraph. Also splits inline numbered lists
 * (e.g. "1. A 2. B 3. C") onto separate lines so each item renders distinctly.
 */
export function splitBulletSegments(text) {
  const raw = (text || '').replace(/\u00A7BULLET\u00A7/g, ' \u00A7BULLET\u00A7 ').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  let segments = raw
    .split('\u00A7BULLET\u00A7')
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length > 1) {
    segments = segments.map((segment, index) => (index === 0 ? segment : `\u2022 ${segment}`));
  }

  const out = [];
  for (const seg of segments) {
    // Split runs of inline numbered items: "1. ... 2. ... 3. ..."
    const parts = seg.split(/\s+(?=\d{1,3}[.)]\s+\S)/g).map((p) => p.trim()).filter(Boolean);
    const numberedCount = parts.filter((p) => /^\d{1,3}[.)]\s/.test(p)).length;
    if (parts.length > 1 && numberedCount >= 2) {
      out.push(...parts);
    } else {
      out.push(seg);
    }
  }
  return out;
}

function clusterRows(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(item.y - last.y) <= Math.max(2, 0.5 * (item.fontSize || 12))) {
      last.items.push(item);
      last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length;
    } else {
      rows.push({ y: item.y, pageNum: item.pageNum, pageHeight: item.pageHeight, fontSize: item.fontSize, items: [item] });
    }
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}

function detectTableBlocks(items) {
  // Heuristic table detection for text PDFs. Kept conservative because
  // PPTX-exported PDFs often have wrapped/bulleted text placed at varied x
  // positions that can look "grid-like" but are not real tables.
  const rows = clusterRows(items);
  const blocks = [];
  let i = 0;
  while (i < rows.length) {
    const start = i;
    let cols = null;
    let j = i;
    while (j < rows.length) {
      const cells = rows[j].items.filter((it) => sanitiseStr(it.str).replace(/\s+/g, ' ').trim());
      if (cells.length < 2) break;
      const xs = cells.map((c) => Math.round(c.x / 6) * 6);
      if (!cols) {
        cols = xs.slice().sort((a, b) => a - b);
      } else {
        const aligned = xs.filter((x) => cols.some((c) => Math.abs(c - x) <= 14));
        const sameCount = Math.abs(cells.length - cols.length) <= 1;
        const strongOverlap = aligned.length >= Math.max(2, Math.min(cols.length, xs.length));
        if (!sameCount || !strongOverlap) break;
        xs.forEach((x) => { if (!cols.some((c) => Math.abs(c - x) <= 14)) cols.push(x); });
        cols.sort((a, b) => a - b);
        if (cols.length > 6) break; // too many "columns" usually means wrapped prose/layout, not a table
      }
      j += 1;
    }
    const count = j - start;
    if (count >= 3 && cols && cols.length >= 2 && cols.length <= 6) {
      const tableRows = rows.slice(start, j).map((row) => {
        const colCount = cols.length;
        const cells = Array.from({ length: colCount }, () => '');
        for (const it of row.items) {
          let best = 0;
          let bestD = Infinity;
          cols.forEach((c, idx) => {
            const d = Math.abs(it.x - c);
            if (d < bestD) { bestD = d; best = idx; }
          });
          const txt = sanitiseStr(it.str).replace(/\s+/g, ' ').trim();
          if (!txt) continue;
          cells[best] = cells[best] ? `${cells[best]} ${txt}` : txt;
        }
        return cells.map((c) => c.replace(/\|/g, '\\|').trim());
      }).filter((r) => r.some((c) => c));

      const totalCells = tableRows.length * cols.length;
      const nonEmpty = tableRows.reduce((n, r) => n + r.filter(Boolean).length, 0);
      const occupancy = totalCells ? nonEmpty / totalCells : 0;
      const rowsWithMulti = tableRows.filter((r) => r.filter(Boolean).length >= 2).length;
      const avgLen = nonEmpty ? tableRows.flat().filter(Boolean).join(' ').length / nonEmpty : 0;
      const bulletish = tableRows.some((r) => r.some((c) => /^[\u2022â—¦â–ª\-\*]/.test(c)));
      const sentenceLike = avgLen > 42; // prose wrapped across pseudo-columns
      const looksTabular = rowsWithMulti >= Math.max(2, Math.ceil(tableRows.length * 0.7));

      if (
        tableRows.length >= 3 &&
        looksTabular &&
        occupancy >= 0.45 &&
        occupancy <= 0.95 &&
        !bulletish &&
        !sentenceLike
      ) {
        const header = tableRows[0];
        const body = tableRows.slice(1);
        const sep = header.map(() => '---');
        const markdown = [
          `| ${header.join(' | ')} |`,
          `| ${sep.join(' | ')} |`,
          ...body.map((r) => `| ${r.join(' | ')} |`),
        ].join('\n');
        blocks.push({
          type: 'table',
          y: rows[start].y,
          y1: rows[j - 1].y,
          pageNum: rows[start].pageNum,
          pageHeight: rows[start].pageHeight,
          markdown,
        });
        i = j;
        continue;
      }
    }
    i = start + 1;
  }
  return blocks;
}

function buildLines(items, { detectTables = true } = {}) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const tableBlocks = detectTables ? detectTableBlocks(sorted) : [];
  const tableConsumed = (item) => tableBlocks.some((b) => item.pageNum === b.pageNum && item.y >= b.y - 1 && item.y <= b.y1 + 1);
  const normalItems = sorted.filter((it) => !tableConsumed(it));

  const grouped = [];
  let current = null;
  for (const item of normalItems) {
    const cleanStr = sanitiseStr(item.str);
    if (!cleanStr) continue;
    const sameLine =
      current &&
      current.pageNum === item.pageNum &&
      Math.abs(item.y - current.y) <= 0.5 * current.anchorFont;
    if (sameLine) {
      current.items.push({ ...item, str: cleanStr });
      if (item.fontSize > current.fontSize) {
        current.fontSize = item.fontSize;
        current.fontFamily = item.fontFamily || '';
      }
    } else {
      current = {
        pageNum: item.pageNum,
        pageHeight: item.pageHeight,
        y: item.y,
        anchorFont: item.fontSize,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily || '',
        items: [{ ...item, str: cleanStr }],
      };
      grouped.push(current);
    }
  }
  const lines = grouped
    .flatMap((line) => {
      const raw = joinItems(line.items);
      if (!raw) return [];
      const base = {
        fontSize: line.fontSize,
        fontFamily: line.fontFamily,
        y: line.y,
        pageNum: line.pageNum,
        pageHeight: line.pageHeight,
      };
      return splitBulletSegments(raw).map((text) => ({ ...base, text }));
    })
    .filter((line) => line.text.length > 0);

  for (const b of tableBlocks) {
    lines.push({ isTable: true, text: b.markdown, y: b.y, pageNum: b.pageNum, pageHeight: b.pageHeight, fontSize: 12, fontFamily: '' });
  }
  lines.sort((a, b) => a.pageNum - b.pageNum || a.y - b.y);
  return lines;
}

function stripRunningHeaders(lines) {
  const edgePages = new Map();
  for (const line of lines) {
    const ratio = line.y / (line.pageHeight || 1);
    if (ratio >= HEADER_BAND && ratio <= 1 - HEADER_BAND) continue;
    const key = normalize(line.text);
    if (!key) continue;
    if (!edgePages.has(key)) edgePages.set(key, new Set());
    edgePages.get(key).add(line.pageNum);
  }
  const running = new Set();
  for (const [key, pages] of edgePages) {
    if (pages.size >= HEADER_MIN_PAGES) running.add(key);
  }
  if (!running.size) return lines;
  return lines.filter((line) => {
    const ratio = line.y / (line.pageHeight || 1);
    const isEdge = ratio < HEADER_BAND || ratio > 1 - HEADER_BAND;
    if (!isEdge) return true;
    return !running.has(normalize(line.text));
  });
}

const PAGE_NUMBER_PATTERNS = [
  /^(?:page|p\.?)\s*\d{1,4}(?:\s*(?:of|\/|–|-|to)\s*\d{1,4})?$/i,
  /^\d{1,4}$/,
  /^\d{1,4}\s*\/\s*\d{1,4}$/,
  /^[-–.(\[]?\s*\d{1,4}\s*[-–.)\]]?$/,
];

/** Footer/header page numbers ("12", "Page 3", "- 7 -", "3 / 20") are noise. */
export function looksLikePageNumber(text) {
  const cleaned = normalize(text).replace(/\.$/, '').trim();
  if (!cleaned || cleaned.length > 20 || !/\d/.test(cleaned)) return false;
  return PAGE_NUMBER_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function stripPageNumbers(lines) {
  return lines.filter((line) => {
    const ratio = line.y / (line.pageHeight || 1);
    const isEdge = ratio < PAGE_NUMBER_BAND || ratio > 1 - PAGE_NUMBER_BAND;
    if (!isEdge) return true;
    return !looksLikePageNumber(line.text);
  });
}

function modalFontSize(lines) {
  const histogram = new Map();
  for (const line of lines) {
    const key = Math.round(line.fontSize * 2) / 2;
    histogram.set(key, (histogram.get(key) || 0) + line.text.length);
  }
  let best = 0;
  let bestWeight = -1;
  const sizes = [...histogram.keys()].sort((a, b) => a - b);
  for (const size of sizes) {
    const weight = histogram.get(size);
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best || 12;
}

const BOLD_FONT = /(bold|black|heavy|semibold|semi-bold|demibold|demi(?!-?light))/i;
const BULLET_START = /^[•◦▪▸*\-–.]\s*/;

/**
 * A heading is a short, unpunctuated line that stands apart from the body by
 * size, weight or casing. Long lines and whole sentences are never headings,
 * so a heading can never grow into a full-size chunk on its own.
 */
export function isHeadingLine(line, bodySize) {
  const text = (line.text || '').trim();
  if (!text || text.includes('\u00A7BULLET\u00A7')) return false;
  if (text.length > HEADING_MAX_CHARS) return false;
  const words = countWords(text);
  if (!words || words > HEADING_MAX_WORDS) return false;
  if (/[.;,]$/.test(text)) return false;
  if (BULLET_START.test(text)) return false;
  if (words === 1 && text.length <= 2) return false;

  const size = line.fontSize || bodySize;
  const muchBigger = size >= bodySize * HEADING_SCALE;
  const bigger = size >= bodySize * HEADING_SOFT_SCALE;
  const bold = BOLD_FONT.test(line.fontFamily || '');
  const letters = text.replace(/[^A-Za-z]/g, '');
  const caps =
    letters.length >= 2 &&
    size >= bodySize * 0.95 &&
    words <= 8 &&
    text.length <= 48 &&
    text === text.toUpperCase();

  if (muchBigger) return true;
  if (bigger && (bold || words <= 10)) return true;
  if (bold && words <= 10 && text.length <= 60) return true;
  return caps;
}

function isHeading(line, bodySize) {
  return isHeadingLine(line, bodySize);
}

function buildParagraphs(lines) {
  const paragraphs = [];
  let current = null;
  for (const line of lines) {
    const isBullet = /^[\u2022●▪◦■□]/.test(line.text);
    const isNumbered = /^\d{1,3}[.)]\s+/.test(line.text);
    const listItem = isBullet || isNumbered;
    const gap = current && current.pageNum === line.pageNum ? line.y - current.lastY : Number.POSITIVE_INFINITY;
    const threshold = 1.8 * (current ? current.lastFont : line.fontSize);
    if (current && !listItem && !current.listItem && gap <= threshold) {
      current.text += ' ' + line.text;
      current.lastY = line.y;
      current.y1 = line.y;
      current.lastFont = line.fontSize;
      current.wordCount = countWords(current.text);
    } else {
      current = {
        text: line.text,
        pageNum: line.pageNum,
        pageRef: line.pageNum,
        lastY: line.y,
        y0: line.y,
        y1: line.y,
        lastFont: line.fontSize,
        wordCount: countWords(line.text),
        bullet: isBullet,
        listItem,
      };
      paragraphs.push(current);
    }
  }
  return paragraphs;
}

function splitLongSentence(sentence, maxWords) {
  const tokens = sentence.trim().split(/\s+/);
  const pieces = [];
  for (let i = 0; i < tokens.length; i += maxWords) {
    pieces.push(tokens.slice(i, i + maxWords).join(' '));
  }
  return pieces.filter(Boolean);
}

/**
 * Turns raw extracted lines into small display units: bullet lines stay whole,
 * plain paragraphs are grouped into short sentence groups (~80 words). Units
 * carry an approximate y-range so figures can still be attached to the text
 * that surrounds them.
 */
function buildUnits(lines) {
  const units = [];
  for (const paragraph of buildParagraphs(lines)) {
    const cleaned = expandBullets(paragraph.text)
      .split('\n')
      .map((part) => part.trim())
      .filter(Boolean);
    const span = Math.max(0, paragraph.y1 - paragraph.y0);
    const totalWords = Math.max(1, countWords(cleaned.join(' ')));
    let consumed = 0;
    const pushUnit = (text) => {
      const words = Math.max(1, countWords(text));
      const startFrac = consumed / totalWords;
      consumed += words;
      const endFrac = Math.min(1, consumed / totalWords);
      units.push({
        text,
        wordCount: words,
        pageNum: paragraph.pageNum,
        pageRef: paragraph.pageRef,
        y0: paragraph.y0 + span * startFrac,
        y1: paragraph.y0 + span * endFrac,
      });
    };
    for (const line of cleaned) {
      if (/^[\u2022●▪◦■□]/.test(line) || /^\d{1,3}[.)]\s+/.test(line)) {
        pushUnit(line);
        continue;
      }
      const sentences = (line.match(/[^.!?]+[.!?]*\s*|[^.!?]+$/g) || [line])
        .map((sentence) => sentence.trim())
        .filter(Boolean);
      let group = [];
      let groupWords = 0;
      const flushGroup = () => {
        if (!group.length) return;
        pushUnit(group.join(' '));
        group = [];
        groupWords = 0;
      };
      for (const sentence of sentences) {
        const parts =
          countWords(sentence) > SENTENCE_MAX_WORDS
            ? splitLongSentence(sentence, SENTENCE_MAX_WORDS)
            : [sentence];
        for (const part of parts) {
          const words = countWords(part);
          if (groupWords + words > SENTENCE_GROUP_TARGET_WORDS && group.length) flushGroup();
          group.push(part);
          groupWords += words;
        }
      }
      flushGroup();
    }
  }
  return units;
}

function groupWordsOf(group) {
  return group.reduce((sum, unit) => sum + unit.wordCount, 0);
}

/**
 * Recursively halves groups that still exceed the hard maximum, cutting at the
 * unit boundary closest to the middle so no chunk ever overflows.
 */
function splitOversizedGroups(groups, maxWords = MAX_CHUNK_WORDS) {
  const out = [];
  for (const group of groups) {
    const words = groupWordsOf(group);
    if (words <= maxWords || group.length < 2) {
      out.push(group);
      continue;
    }
    let cut = 1;
    let bestDiff = Infinity;
    let acc = 0;
    for (let i = 0; i < group.length - 1; i += 1) {
      acc += group[i].wordCount;
      const diff = Math.abs(acc - words / 2);
      if (diff < bestDiff) {
        bestDiff = diff;
        cut = i + 1;
      }
    }
    out.push(...splitOversizedGroups([group.slice(0, cut), group.slice(cut)], maxWords));
  }
  return out;
}

/**
 * A new page is a natural place to end a chunk: cut there as long as both
 * sides stay above the minimum chunk length.
 */
function splitGroupsAtPageBreaks(groups) {
  const out = [];
  for (const group of groups) {
    const total = groupWordsOf(group);
    let current = [];
    let words = 0;
    for (const unit of group) {
      const previous = current[current.length - 1];
      const startsNewPage = previous && previous.pageNum !== unit.pageNum;
      const remaining = total - words;
      if (startsNewPage && words >= MIN_CHUNK_WORDS && remaining >= MIN_CHUNK_WORDS) {
        out.push(current);
        current = [];
        words = 0;
      }
      current.push(unit);
      words += unit.wordCount;
    }
    if (current.length) out.push(current);
  }
  return out;
}

/**
 * Splits units into contiguous groups whose word counts are as even as
 * possible, each group aiming for the target chunk length. This is what keeps
 * the average words per chunk consistent across the whole document.
 */
export function partitionUnits(units, target = TARGET_CHUNK_WORDS) {
  if (!units.length) return [];
  const totalWords = units.reduce((sum, unit) => sum + unit.wordCount, 0);
  if (totalWords <= MAX_CHUNK_WORDS) return splitGroupsAtPageBreaks([units]);

  let groupCount = Math.max(1, Math.round(totalWords / target));
  groupCount = Math.max(groupCount, Math.ceil(totalWords / MAX_CHUNK_WORDS));
  while (groupCount > 1 && totalWords / groupCount < MIN_CHUNK_WORDS) groupCount -= 1;

  const groups = [];
  let cursor = 0;
  let consumedWords = 0;
  for (let g = 0; g < groupCount; g += 1) {
    const groupsLeft = groupCount - g;
    const ideal = (totalWords - consumedWords) / groupsLeft;
    const group = [];
    let acc = 0;
    while (cursor < units.length) {
      const unitsLeft = units.length - cursor;
      const mustReserve = groupsLeft - 1;
      const unit = units[cursor];
      const wouldTake = acc + unit.wordCount;
      const overshoot = wouldTake - ideal;
      if (group.length > 0 && (overshoot > unit.wordCount * 0.6 || unitsLeft - 1 < mustReserve)) break;
      group.push(unit);
      acc = wouldTake;
      cursor += 1;
      if (acc >= ideal) break;
    }
    groups.push(group);
    consumedWords += acc;
  }
  while (cursor < units.length) {
    groups[groups.length - 1].push(units[cursor]);
    cursor += 1;
  }
  const nonEmpty = groups.filter((group) => group.length > 0);
  return splitOversizedGroups(splitGroupsAtPageBreaks(nonEmpty));
}

function pagesLabel(coverage) {
  const pageNumbers = [...new Set((coverage || []).map((range) => range.pageNum))].sort((a, b) => a - b);
  if (!pageNumbers.length) return '';
  if (pageNumbers.length === 1) return `Page ${pageNumbers[0]}`;
  return `Pages ${pageNumbers[0]}\u2013${pageNumbers[pageNumbers.length - 1]}`;
}

function chunksFromGroups(groups, sectionTitle) {
  const chunks = [];
  groups.forEach((group, groupIndex) => {
    const coverageMap = new Map();
    for (const unit of group) {
      addToCoverage(coverageMap, unit.pageNum, unit.y0, unit.y1);
    }
    const coverage = coverageToArray(coverageMap);
    let title;
    if (sectionTitle) {
      title = groupIndex === 0 ? sectionTitle : `${sectionTitle} (continued)`;
    } else {
      title = pagesLabel(coverage);
    }
    const body = group.map((unit) => unit.text).join('\n\n');
    chunks.push({
      title,
      body,
      wordCount: group.reduce((sum, unit) => sum + unit.wordCount, 0),
      pageRef: group[0].pageRef,
      hasText: body.replace(/\s/g, '').length > 0,
      coverage,
    });
  });
  return chunks;
}

function buildSectionChunks(lines, sectionTitle) {
  const units = buildUnits(lines);
  if (sectionTitle === null && units.length) {
    // Paragraph strategy: a short opening line can act as the section title.
    const first = units[0];
    if (first.text.length < HEADING_MAX_CHARS && !/^[\u2022â—¦]/.test(first.text)) {
      const rest = units.slice(1);
      const restWords = rest.reduce((sum, unit) => sum + unit.wordCount, 0);
      if (restWords >= MIN_CHUNK_WORDS) {
        return [
          {
            title: first.text,
            body: '',
            wordCount: first.wordCount,
            pageRef: first.pageRef,
            hasText: true,
            coverage: [{ pageNum: first.pageNum, minY: first.y0, maxY: first.y1 }],
          },
          ...chunksFromGroups(partitionUnits(rest, TARGET_CHUNK_WORDS), first.text),
        ];
      }
    }
  }
  return chunksFromGroups(partitionUnits(units, TARGET_CHUNK_WORDS), sectionTitle);
}

function headingSections(lines, bodySize) {
  const sections = [];
  let current = { title: null, lines: [] };
  const push = () => {
    if (current.title !== null || current.lines.length) sections.push(current);
  };
  for (const line of lines) {
    if (isHeading(line, bodySize)) {
      if (current.title !== null && current.lines.length === 0) {
        current.title = `${current.title} ${line.text}`.trim();
        continue;
      }
      if (current.title === null && current.lines.length) {
        // Preamble before the first heading (cover text, running header that
        // survived stripping): fold it into the first titled section rather
        // than emitting a fragment chunk.
        current = { title: line.text, lines: current.lines };
      } else {
        push();
        current = { title: line.text, lines: [] };
      }
    } else {
      current.lines.push(line);
    }
  }
  push();
  return sections;
}

/**
 * Slide decks exported to PDF keep slide-shaped pages (16:9 or 4:3) and only
 * a title plus a handful of lines per page. Detecting that shape lets us chunk
 * one page per slide instead of guessing from heading fonts alone.
 */
export function looksLikeSlideDeck(pages, lines) {
  if (!Array.isArray(pages) || pages.length < 2) return false;
  const slideShaped = pages.filter(
    (page) => page.pageWidth && page.pageHeight / page.pageWidth <= 0.82
  ).length;
  if (slideShaped / pages.length < 0.6) return false;
  const words = lines.reduce((sum, line) => sum + countWords(line.text), 0);
  if (!words) return false;
  const wordsPerPage = words / pages.length;
  const linesPerPage = lines.length / pages.length;
  return wordsPerPage <= 170 && linesPerPage <= 22;
}

/**
 * One slide per chunk: the first heading-looking line becomes the chunk title
 * and the rest of the page becomes a bullet list. Pages are never merged.
 */
function slideDeckChunks(lines, pages, bodySize) {
  const byPage = new Map();
  for (const line of lines) {
    if (!byPage.has(line.pageNum)) byPage.set(line.pageNum, []);
    byPage.get(line.pageNum).push(line);
  }
  const chunks = [];
  for (const page of pages) {
    const pageLines = byPage.get(page.pageNum) || [];
    if (!pageLines.length) continue;
    let titleLine = pageLines.find((line) => isHeading(line, bodySize)) || null;
    if (!titleLine) {
      const first = pageLines[0];
      if (
        countWords(first.text) <= 12 &&
        first.text.length <= HEADING_MAX_CHARS &&
        !/[.;,]$/.test(first.text) &&
        !/^[\u2022â—¦â–ª]/.test(first.text)
      ) {
        titleLine = first;
      }
    }
    const title = titleLine ? titleLine.text : `Slide ${page.pageNum}`;
    const rest = pageLines.filter((line) => line !== titleLine);
    const groups = rest.length ? partitionUnits(buildUnits(rest), TARGET_CHUNK_WORDS) : [];
    if (groups.length) {
      chunks.push(...chunksFromGroups(groups, title));
      continue;
    }
    if (!titleLine) continue;
    chunks.push({
      title,
      body: '',
      wordCount: countWords(titleLine.text),
      pageRef: page.pageNum,
      hasText: true,
      coverage: [{ pageNum: page.pageNum, minY: titleLine.y, maxY: titleLine.y }],
    });
  }
  return chunks;
}

function pageChunks(lines) {
  const byPage = new Map();
  for (const line of lines) {
    if (!byPage.has(line.pageNum)) byPage.set(line.pageNum, []);
    byPage.get(line.pageNum).push(line);
  }
  const chunks = [];
  const pageNumbers = [...byPage.keys()].sort((a, b) => a - b);
  for (const pageNum of pageNumbers) {
    const pageLines = byPage.get(pageNum);
    const pageHeight = pageLines[0].pageHeight || 0;
    const units = buildUnits(pageLines);
    const groups = partitionUnits(units, TARGET_CHUNK_WORDS);
    groups.forEach((group, groupIndex) => {
      const coverageMap = new Map();
      for (const unit of group) {
        addToCoverage(coverageMap, unit.pageNum, unit.y0, unit.y1);
      }
      const body = group.map((unit) => unit.text).join('\n\n');
      chunks.push({
        title: groupIndex === 0 ? `Page ${pageNum}` : `Page ${pageNum} (continued)`,
        body,
        wordCount: group.reduce((sum, unit) => sum + unit.wordCount, 0),
        pageRef: pageNum,
        hasText: body.replace(/\s/g, '').length > 0,
        coverage: coverageMap.size
          ? coverageToArray(coverageMap)
          : [{ pageNum, minY: 0, maxY: pageHeight }],
      });
    });
  }
  return chunks;
}

function mergeChunkInto(previous, chunk) {
  const parts = [previous.body];
  if (sectionKey(previous) !== sectionKey(chunk) && chunk.title) {
    parts.push(`# ${chunk.title}`);
  }
  parts.push(chunk.body);
  previous.body = parts.filter(Boolean).join('\n\n');
  previous.wordCount += chunk.wordCount;
  previous.hasText = previous.hasText || chunk.hasText;
  previous.coverage = [...(previous.coverage || []), ...(chunk.coverage || [])];
  if ((chunk.pageRef ?? 0) < (previous.pageRef ?? Number.POSITIVE_INFINITY)) {
    previous.pageRef = chunk.pageRef;
  }
}

/**
 * Folds a tiny remainder of a section back into that same section so the next
 * heading always starts a brand-new chunk. Sections are never merged across a
 * heading boundary.
 */
function mergeTinyChunks(chunks) {
  if (chunks.length < 2) return chunks;
  const merged = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      sectionKey(previous) === sectionKey(chunk) &&
      chunk.wordCount < MIN_CHUNK_WORDS &&
      previous.wordCount + chunk.wordCount <= Math.round(MAX_CHUNK_WORDS * 1.15)
    ) {
      mergeChunkInto(previous, chunk);
      continue;
    }
    merged.push(chunk);
  }
  return merged;
}

function sectionKey(chunk) {
  return (chunk.title || '').replace(/\s\(continued\)$/, '');
}

function assignImagesToChunks(chunks, pages) {
  const imagesByPage = new Map();
  for (const page of pages) {
    if (page.images && page.images.length) imagesByPage.set(page.pageNum, page.images);
  }
  if (!imagesByPage.size || !chunks.length) return;

  const fallbackChunkFor = (pageNum) => {
    let fallback = null;
    for (const chunk of chunks) {
      if ((chunk.pageRef ?? 0) <= pageNum) fallback = chunk;
    }
    return fallback || chunks[0];
  };

  for (const [pageNum, images] of imagesByPage) {
    for (const image of images) {
      let best = null;
      let bestDistance = Infinity;
      for (const chunk of chunks) {
        if ((chunk.images || []).length >= MAX_IMAGES_PER_CHUNK) continue;
        const ranges = (chunk.coverage || []).filter((range) => range.pageNum === pageNum);
        if (!ranges.length) continue;
        let distance = Infinity;
        for (const range of ranges) {
          if (image.center >= range.minY - 24 && image.center <= range.maxY + 24) {
            distance = 0;
            break;
          }
          const gap = Math.min(
            Math.abs(image.center - range.minY),
            Math.abs(image.center - range.maxY)
          );
          if (gap < distance) distance = gap;
        }
        if (distance < bestDistance) {
          bestDistance = distance;
          best = chunk;
        }
      }
      if (!best || Number.isNaN(bestDistance)) best = fallbackChunkFor(pageNum);
      if (!best) continue;
      if (!Array.isArray(best.images)) best.images = [];
      if (best.images.some((existing) => existing.src === image.src)) continue;
      if (best.images.length >= MAX_IMAGES_PER_CHUNK) continue;
      best.images.push({
        src: image.src,
        width: image.width,
        height: image.height,
        page: pageNum,
      });
    }
  }
}

function insertImageOnlyChunks(chunks, pages, label = 'Page') {
  const covered = new Set();
  for (const chunk of chunks) {
    for (const range of chunk.coverage || []) covered.add(range.pageNum);
  }
  for (const page of pages) {
    if (covered.has(page.pageNum) || !page.images || !page.images.length) continue;
    const imageOnly = {
      title: `${label} ${page.pageNum}`,
      body: '',
      wordCount: 0,
      pageRef: page.pageNum,
      hasText: false,
      coverage: [{ pageNum: page.pageNum, minY: 0, maxY: page.pageHeight }],
    };
    let at = chunks.length;
    for (let i = 0; i < chunks.length; i += 1) {
      if ((chunks[i].pageRef ?? 0) > page.pageNum) {
        at = i;
        break;
      }
    }
    chunks.splice(at, 0, imageOnly);
    covered.add(page.pageNum);
  }
}

export async function chunkPdf(arrayBuffer) {
  const pages = await extractPages(arrayBuffer);
  if (!pages.length) return [];
  // First pass without heuristic tables so slide-deck detection isn't fooled by layout grids.
  let baseLines = pages.flatMap((page) => buildLines(page.items, { detectTables: false }));
  baseLines = stripRunningHeaders(baseLines);
  baseLines = stripPageNumbers(baseLines);
  const hasImages = pages.some((page) => page.images && page.images.length);
  if (!baseLines.length && !hasImages) return [];

  const bodySize = modalFontSize(baseLines);
  const headingCandidates = baseLines.filter((line) => isHeading(line, bodySize)).length;
  const deckLike = looksLikeSlideDeck(pages, baseLines);
  // Skip PDF heuristic table detection for slide-deck exports (common PPTX->PDF case);
  // their wrapped/bulleted text is frequently misread as grids. True PPTX tables are
  // handled in the PPTX chunker.
  let lines = deckLike ? baseLines : pages.flatMap((page) => buildLines(page.items, { detectTables: true }));
  if (!deckLike) {
    lines = stripRunningHeaders(lines);
    lines = stripPageNumbers(lines);
  }
  const strategy = deckLike
    ? 'slides'
    : lines.length && headingCandidates / pages.length >= 0.5
      ? 'heading'
      : 'paragraph';

  let method = strategy;
  let chunks = [];
  if (strategy === 'slides') {
    chunks = slideDeckChunks(lines, pages, bodySize);
  } else if (strategy === 'heading') {
    for (const section of headingSections(lines, bodySize)) {
      chunks.push(...buildSectionChunks(section.lines, section.title));
    }
  } else if (lines.length) {
    chunks = buildSectionChunks(lines, null);
  }

  if (chunks.length < 2 && lines.length && method !== 'slides') {
    chunks = pageChunks(lines);
    method = 'page';
  }
  if (method !== 'slides') chunks = mergeTinyChunks(chunks);

  insertImageOnlyChunks(chunks, pages, method === 'slides' ? 'Slide' : 'Page');
  assignImagesToChunks(chunks, pages);

  return chunks.map((chunk, index) => {
    const { coverage, ...rest } = chunk;
    return {
      ...rest,
      title: chunk.title || `Section ${index + 1}`,
      index,
      chunkingMethod: method,
      images: Array.isArray(chunk.images) ? chunk.images : [],
    };
  });
}

