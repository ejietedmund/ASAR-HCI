import JSZip from 'jszip';
import { bytesToDataUrl, downscaleDataUrl } from './imageUtils.js';

const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

// Same uniform-chunk targets the PDF chunker uses, so every document reads at
// a consistent pace.
export const TARGET_CHUNK_WORDS = 220;
export const MAX_CHUNK_WORDS = 280;
export const MIN_CHUNK_WORDS = 70;
const SENTENCE_GROUP_TARGET_WORDS = 80;
const SENTENCE_MAX_WORDS = 60;

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function resolveZipPath(fromDir, target) {
  const parts = fromDir.split('/').concat(target.split('/'));
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

async function slideImages() {
  return [];
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&amp;/g, '&');
}

function escapeCell(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function tableToMarkdown(rows) {
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length), 0);
  if (!cols) return '';
  const norm = rows.map((r) => Array.from({ length: cols }, (_, i) => escapeCell(r[i] || '')));
  const header = norm[0];
  const body = norm.slice(1);
  const sep = header.map(() => '---');
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function parseTablesFromBlock(block) {
  const tables = [];
  for (const tbl of block.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>/g)) {
    const rows = [];
    for (const tr of tbl[0].matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
      const cells = [];
      for (const tc of tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)) {
        const parts = [];
        for (const para of tc[0].matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
          let text = '';
          for (const m of para[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
            text += decodeXmlEntities(m[1]);
          }
          text = text.replace(/\s+/g, ' ').trim();
          if (text) parts.push(text);
        }
        cells.push(parts.join(' '));
      }
      if (cells.some((c) => c)) rows.push(cells);
    }
    const md = tableToMarkdown(rows);
    if (md) tables.push(md);
  }
  return tables;
}

const BULLET_MARKS = ['•', '◦', '▪'];

/**
 * Extracts paragraphs shape by shape, keeping bullet levels and numbered
 * lists so slides render as real formatted lists instead of one flat blob.
 */
export function parseSlideParagraphs(xml) {
  const paragraphs = [];
  const shapeBlocks = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) || [];
  const graphicBlocks = xml.match(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g) || [];
  const isTitleShape = (block) => /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(block);

  let title = '';
  for (const block of shapeBlocks) {
    const txBody = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(block);
    if (!txBody) continue;
    const paraBlocks = txBody[1].match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
    for (const paraXml of paraBlocks) {
      let level = 0;
      let numbered = false;
      let bulleted = false;
      const pPr = /<a:pPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:pPr>)/.exec(paraXml);
      if (pPr) {
        const attrs = pPr[1] || '';
        const inner = pPr[2] || '';
        const lvl = /(?:^|\s)lvl="(\d+)"/.exec(attrs);
        level = lvl ? Math.min(2, parseInt(lvl[1], 10)) : 0;
        const marL = /(?:^|\s)marL="(\d+)"/.exec(attrs);
        const indented = (marL && parseInt(marL[1], 10) > 0) || level > 0;
        if (/<a:buAutoNum\b/.test(inner)) numbered = true;
        else if (/<a:buChar\b/.test(inner)) bulleted = true;
        else if (!/<a:buNone\b/.test(inner) && indented) bulleted = true;
      }
      let text = '';
      for (const match of paraXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
        text += decodeXmlEntities(match[1]);
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      if (!title && isTitleShape(block)) {
        title = text;
        continue;
      }
      paragraphs.push({ text, level, numbered: numbered || bulleted, isNumbered: numbered });
    }
  }

  // Extract tables from graphic frames so they are regenerated as proper tables.
  for (const block of graphicBlocks) {
    for (const tableText of parseTablesFromBlock(block)) {
      paragraphs.push({ text: tableText, isTable: true, numbered: false, isNumbered: false, level: 0 });
    }
  }

  if (!title && paragraphs.length) {
    const firstText = paragraphs.find((p) => !p.isTable);
    if (firstText) {
      const idx = paragraphs.indexOf(firstText);
      title = firstText.text;
      paragraphs.splice(idx, 1);
    }
  }
  return { title, paragraphs };
}

function splitLongSentence(sentence, maxWords) {
  const tokens = sentence.trim().split(/\s+/);
  const pieces = [];
  for (let i = 0; i < tokens.length; i += maxWords) {
    pieces.push(tokens.slice(i, i + maxWords).join(' '));
  }
  return pieces.filter(Boolean);
}

/** Slide paragraphs become small display units (whole bullets or sentence groups). */
function paragraphUnits(paragraphs) {
  const units = [];
  for (const paragraph of paragraphs) {
    if (paragraph.isTable) {
      units.push({ ...paragraph, words: Math.max(10, countWords(paragraph.text.replace(/[|\-]/g, ' '))) });
      continue;
    }
    if (paragraph.numbered) {
      units.push({ ...paragraph, words: Math.max(1, countWords(paragraph.text)) });
      continue;
    }
    const sentences = (paragraph.text.match(/[^.!?]+[.!?]*\s*|[^.!?]+$/g) || [paragraph.text])
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    let group = [];
    let groupWords = 0;
    const flushGroup = () => {
      if (!group.length) return;
      const text = group.join(' ');
      units.push({ ...paragraph, text, words: Math.max(1, countWords(text)) });
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
  return units;
}

function formatUnit(unit, number) {
  if (unit.isTable) return unit.text;
  if (unit.isNumbered) return `${number}. ${unit.text}`;
  const mark = BULLET_MARKS[Math.min(unit.level || 0, BULLET_MARKS.length - 1)];
  const indent = unit.level > 0 ? ' '.repeat(unit.level) : '';
  return `${indent}${mark} ${unit.text}`;
}

function groupWordsOf(group) {
  return group.reduce((sum, unit) => sum + unit.words, 0);
}

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
      acc += group[i].words;
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

function partitionSlideUnits(units, target = TARGET_CHUNK_WORDS) {
  if (!units.length) return [];
  const totalWords = units.reduce((sum, unit) => sum + unit.words, 0);
  if (totalWords <= MAX_CHUNK_WORDS) return [units];

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
      const wouldTake = acc + unit.words;
      const overshoot = wouldTake - ideal;
      if (group.length > 0 && (overshoot > unit.words * 0.6 || unitsLeft - 1 < mustReserve)) break;
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
  return splitOversizedGroups(groups.filter((group) => group.length > 0));
}

/**
 * Every slide heading starts its own reading chunk. A very dense slide is
 * split across chunks with a "(continued)" heading so no chunk becomes a wall
 * of text.
 */
export async function chunkPptx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideEntries = Object.keys(zip.files)
    .map((name) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
      if (!match || zip.files[name].dir) return null;
      return { name, number: parseInt(match[1], 10) };
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);

  const slides = [];
  for (const entry of slideEntries) {
    const file = zip.file(entry.name);
    if (!file) continue;
    const xml = await file.async('string');
    const { title, paragraphs } = parseSlideParagraphs(xml);
    const images = await slideImages(zip, entry.number);
    const words = countWords(title) + paragraphs.reduce((sum, p) => sum + countWords(p.text), 0);
    slides.push({ number: entry.number, title, paragraphs, images, words });
  }

  const chunks = [];

  const pushSlideChunk = (slide, units, groupIndex = 0) => {
    const continued = groupIndex > 0;
    const bodyParts = [];
    if (continued) bodyParts.push(`# ${slide.title || `Slide ${slide.number}`} (continued)`);
    let number = 0;
    for (const unit of units) {
      if (unit.isTable) number = 0;
      else if (unit.isNumbered) number += 1;
      else number = 0;
      bodyParts.push(formatUnit(unit, number));
    }
    const body = bodyParts.join('\n\n');
    chunks.push({
      title: slide.title || `Slide ${slide.number}`,
      body,
      wordCount: units.reduce((sum, unit) => sum + unit.words, 0) + (continued ? 0 : countWords(slide.title)),
      pageRef: slide.number,
      hasText: body.replace(/\s/g, '').length > 0,
      images: groupIndex === 0 ? slide.images : [],
      slides: [slide.number],
      source: 'pptx',
      chunkingMethod: 'slides',
    });
  };

  for (const slide of slides) {
    if (!slide.paragraphs.length && !slide.images.length && !slide.title.trim()) continue;
    const units = paragraphUnits(slide.paragraphs);
    if (slide.words > MAX_CHUNK_WORDS) {
      const groups = partitionSlideUnits(units);
      groups.forEach((group, groupIndex) => pushSlideChunk(slide, group, groupIndex));
      continue;
    }
    pushSlideChunk(slide, units);
  }

  return chunks.map((chunk, index) => ({
    ...chunk,
    images: Array.isArray(chunk.images) ? chunk.images : [],
    index,
  }));
}
