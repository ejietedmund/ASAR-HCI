import * as pdfjsLib from 'pdfjs-dist';
import { imageObjToDataUrl } from './imageUtils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const HEADING_SCALE = 1.2;
const HEADING_MAX_CHARS = 80;
const PARAGRAPH_TARGET_WORDS = 250;
const PARAGRAPH_MAX_WORDS = 400;
const MIN_CHUNK_WORDS = 40;
const HEADER_BAND = 0.05;
const HEADER_MIN_PAGES = 3;

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
    ' §BULLET§ '
  );
}

export function expandBullets(text) {
  if (typeof text !== 'string') return '';
  const parts = text
    .split(/\s*(?:§BULLET§\s*)+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return text.replace(/§BULLET§/g, '').trim();
  }

  return parts.map((part) => `• ${part}`).join('\n');
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
    const addFromObj = (obj, matrix, fixedSize) => {
      if (!obj || obj.imageMask || !obj.width || !obj.height) return;
      const src = imageObjToDataUrl(obj);
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
          addFromObj(page.objs.get(objId), current, fn === OPS_PAINT_IMAGE_REPEAT);
        }
      } else if (fn === OPS_PAINT_INLINE_IMAGE) {
        addFromObj(args && args[0], current, false);
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
    const images = await extractPageImages(page, pageHeight);
    const items = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string' || item.str === '') continue;
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const fontSize = Math.hypot(transform[2], transform[3]) || Math.abs(transform[3]) || 10;
      items.push({
        str: item.str,
        fontSize,
        x: transform[4],
        y: pageHeight - transform[5],
        width: item.width || 0,
        pageNum,
        pageHeight,
      });
    }
    pages.push({ pageNum, pageHeight, items, images });
    if (typeof page.cleanup === 'function') page.cleanup();
  }
  if (typeof pdf.destroy === 'function') await pdf.destroy();
  return pages;
}

function buildLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const grouped = [];
  let current = null;
  for (const item of sorted) {
    const cleanStr = sanitiseStr(item.str);
    if (!cleanStr) continue;
    const sameLine =
      current &&
      current.pageNum === item.pageNum &&
      Math.abs(item.y - current.y) <= 0.5 * current.anchorFont;
    if (sameLine) {
      current.items.push({ ...item, str: cleanStr });
      if (item.fontSize > current.fontSize) current.fontSize = item.fontSize;
    } else {
      current = {
        pageNum: item.pageNum,
        pageHeight: item.pageHeight,
        y: item.y,
        anchorFont: item.fontSize,
        fontSize: item.fontSize,
        items: [{ ...item, str: cleanStr }],
      };
      grouped.push(current);
    }
  }
  return grouped
    .map((line) => ({
      text: joinItems(line.items),
      fontSize: line.fontSize,
      y: line.y,
      pageNum: line.pageNum,
      pageHeight: line.pageHeight,
    }))
    .filter((line) => line.text.length > 0);
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

function isHeading(line, bodySize) {
  return line.fontSize >= bodySize * HEADING_SCALE && line.text.length < HEADING_MAX_CHARS;
}

function createBodyAccumulator() {
  const parts = [];
  let last = null;
  return {
    add(line) {
      if (last) {
        const samePage = last.pageNum === line.pageNum;
        const gap = samePage ? line.y - last.y : Number.POSITIVE_INFINITY;
        const threshold = 1.5 * (last.fontSize || 12);
        parts.push((!samePage || gap > threshold ? '\n' : ' ') + line.text);
      } else {
        parts.push(line.text);
      }
      last = line;
    },
    text() {
      return parts
        .join('')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    },
  };
}

function finishChunk(chunk) {
  let body = chunk.body;
  let title = (chunk.title || '').trim();
  body = expandBullets(body);
  title = expandBullets(title).replace(/• /g, '').replace(/\n/g, ' ').trim();
  return {
    title,
    body,
    wordCount: countWords(body),
    pageRef: chunk.pageRef,
    hasText: (title + ' ' + body).replace(/§BULLET§/g, '').trim().length > 0,
  };
}

function headingChunks(lines, bodySize) {
  const chunks = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    chunks.push({
      ...finishChunk({ title: current.title, body: current.body.text(), pageRef: current.pageRef }),
      coverage: coverageToArray(current.coverage),
    });
    current = null;
  };
  for (const line of lines) {
    if (isHeading(line, bodySize)) {
      if (current && current.title && current.body.text() === '') {
        current.title = (current.title + ' ' + line.text).trim();
        addToCoverage(current.coverage, line.pageNum, line.y, line.y);
        continue;
      }
      flush();
      current = { title: line.text, pageRef: line.pageNum, body: createBodyAccumulator(), coverage: new Map() };
    } else {
      if (!current) current = { title: '', pageRef: line.pageNum, body: createBodyAccumulator(), coverage: new Map() };
      current.body.add(line);
    }
    addToCoverage(current.coverage, line.pageNum, line.y, line.y);
  }
  flush();
  return chunks;
}

function buildParagraphs(lines) {
  const paragraphs = [];
  let current = null;
  for (const line of lines) {
    const gap = current && current.pageNum === line.pageNum ? line.y - current.lastY : Number.POSITIVE_INFINITY;
    const threshold = 1.8 * (current ? current.lastFont : line.fontSize);
    if (current && gap <= threshold) {
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
      };
      paragraphs.push(current);
    }
  }
  return paragraphs;
}

function splitLongParagraph(paragraph) {
  if (paragraph.wordCount <= PARAGRAPH_MAX_WORDS) return [paragraph];
  const sentences = paragraph.text.match(/[^.!?]+[.!?]*\s*|[^.!?]+$/g) || [paragraph.text];
  const pieces = [];
  let buffer = [];
  let bufferWords = 0;
  const flushBuffer = () => {
    if (!buffer.length) return;
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    pieces.push({
      text,
      wordCount: countWords(text),
      pageRef: paragraph.pageRef,
      pageNum: paragraph.pageNum,
      y0: paragraph.y0, y1: paragraph.y1,
    });
    buffer = [];
    bufferWords = 0;
  };
  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (sentenceWords > PARAGRAPH_MAX_WORDS) {
      flushBuffer();
      const tokens = sentence.trim().split(/\s+/);
      for (let i = 0; i < tokens.length; i += PARAGRAPH_MAX_WORDS) {
        const text = tokens.slice(i, i + PARAGRAPH_MAX_WORDS).join(' ');
        pieces.push({
          text,
          wordCount: countWords(text),
          pageRef: paragraph.pageRef,
          pageNum: paragraph.pageNum,
          y0: paragraph.y0, y1: paragraph.y1,
        });
      }
      continue;
    }
    if (bufferWords + sentenceWords > PARAGRAPH_MAX_WORDS) flushBuffer();
    buffer.push(sentence.trim());
    bufferWords += sentenceWords;
  }
  flushBuffer();
  return pieces;
}

function paragraphChunks(lines) {
  const pieces = [];
  for (const paragraph of buildParagraphs(lines)) {
    pieces.push(...splitLongParagraph(paragraph));
  }
  const chunks = [];
  let current = null;
  const flush = () => {
    if (!current || !current.parts.length) {
      current = null;
      return;
    }
    const first = current.first || '';
    const useFirstAsTitle = first.length > 0 && first.length < HEADING_MAX_CHARS;
    const body = (useFirstAsTitle ? current.parts.slice(1) : current.parts).join('\n\n').trim();
    const title = useFirstAsTitle ? first : '';
    chunks.push({
      ...finishChunk({
        title,
        body,
        pageRef: current.pageRef,
      }),
      coverage: coverageToArray(current.coverage),
    });
    current = null;
  };
  for (const piece of pieces) {
    if (current && current.words >= PARAGRAPH_TARGET_WORDS) flush();
    if (current && current.words + piece.wordCount > PARAGRAPH_MAX_WORDS) flush();
    if (!current) {
      current = { parts: [], words: 0, pageRef: piece.pageRef, first: piece.text, coverage: new Map() };
    }
    current.parts.push(piece.text);
    current.words += piece.wordCount;
    addToCoverage(current.coverage, piece.pageNum ?? piece.pageRef, piece.y0 ?? piece.y1 ?? 0, piece.y1 ?? piece.y0 ?? 0);
  }
  flush();
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
    const accumulator = createBodyAccumulator();
    for (const line of byPage.get(pageNum)) accumulator.add(line);
    const body = accumulator.text();
    const pageHeight = byPage.get(pageNum)[0].pageHeight || 0;
    chunks.push({
      title: `Page ${pageNum}`,
      body,
      wordCount: countWords(body),
      pageRef: pageNum,
      hasText: body.length > 0,
      coverage: [{ pageNum, minY: 0, maxY: pageHeight }],
    });
  }
  return chunks;
}

function mergeSmallChunks(chunks) {
  const merged = chunks.map((chunk) => ({ ...chunk }));
  let changed = true;
  while (changed) {
    changed = false;
    if (merged.length > 1 && merged[0].wordCount < MIN_CHUNK_WORDS) {
      const [head, next] = merged;
      next.body = [head.body, next.body].filter(Boolean).join('\n\n').trim();
      next.wordCount = countWords(next.body);
      next.hasText = head.hasText || next.hasText;
      next.coverage = [...(head.coverage || []), ...(next.coverage || [])];
      merged.splice(0, 1);
      changed = true;
      continue;
    }
    for (let i = 1; i < merged.length; i += 1) {
      if (merged[i].wordCount < MIN_CHUNK_WORDS) {
        const previous = merged[i - 1];
        previous.body = [previous.body, merged[i].body].filter(Boolean).join('\n\n').trim();
        previous.wordCount = countWords(previous.body);
        previous.hasText = previous.hasText || merged[i].hasText;
        previous.coverage = [...(previous.coverage || []), ...(merged[i].coverage || [])];
        merged.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return merged;
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
      best.images.push({ src: image.src, width: image.width, height: image.height });
    }
  }
}

function insertImageOnlyChunks(chunks, pages) {
  const covered = new Set();
  for (const chunk of chunks) {
    for (const range of chunk.coverage || []) covered.add(range.pageNum);
  }
  for (const page of pages) {
    if (covered.has(page.pageNum) || !page.images || !page.images.length) continue;
    const imageOnly = {
      title: `Page ${page.pageNum}`,
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
  let lines = pages.flatMap((page) => buildLines(page.items));
  lines = stripRunningHeaders(lines);
  const hasImages = pages.some((page) => page.images && page.images.length);
  if (!lines.length && !hasImages) return [];

  const bodySize = modalFontSize(lines);
  const headingCandidates = lines.filter((line) => isHeading(line, bodySize)).length;
  const strategy = headingCandidates / pages.length >= 0.5 ? 'heading' : 'paragraph';

  let method = strategy;
  let chunks = strategy === 'heading' ? headingChunks(lines, bodySize) : paragraphChunks(lines);

  if (chunks.length < 2) {
    chunks = pageChunks(lines);
    method = 'page';
  } else {
    chunks = mergeSmallChunks(chunks);
  }

  insertImageOnlyChunks(chunks, pages);
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

