import JSZip from 'jszip';
import { bytesToDataUrl } from './imageUtils.js';

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

async function slideImageUrls(zip, slideNumber) {
  const urls = [];
  try {
    const relsFile = zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`);
    const relMap = new Map();
    if (relsFile) {
      const relsXml = await relsFile.async('string');
      for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
        const tag = match[0];
        const id = /\bId="([^"]+)"/.exec(tag);
        const type = /\bType="([^"]+)"/.exec(tag);
        const target = /\bTarget="([^"]+)"/.exec(tag);
        if (id && type && target && type[1].endsWith('/image')) {
          relMap.set(id[1], target[1]);
        }
      }
    }
    const slideFile = zip.file(`ppt/slides/slide${slideNumber}.xml`);
    if (!slideFile) return urls;
    const xml = await slideFile.async('string');
    for (const match of xml.matchAll(/<a:blip\b[^>]*>/g)) {
      const rid = /\br:(?:embed|link)="([^"]+)"/.exec(match[0]);
      if (!rid) continue;
      const target = relMap.get(rid[1]);
      if (!target) continue;
      const extension = (target.split('.').pop() || '').toLowerCase();
      const mime = IMAGE_MIME[extension];
      if (!mime) continue;
      const media = zip.file(resolveZipPath('ppt/slides', target));
      if (!media) continue;
      const bytes = await media.async('uint8array');
      urls.push(bytesToDataUrl(bytes, mime));
    }
  } catch {
    return urls;
  }
  return urls;
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

function extractTextRuns(xml) {
  const runs = [];
  const pattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match = pattern.exec(xml);
  while (match) {
    const text = decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim();
    if (text) runs.push(text);
    match = pattern.exec(xml);
  }
  return runs;
}

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

  const chunks = [];
  for (const entry of slideEntries) {
    const file = zip.file(entry.name);
    if (!file) continue;
    const xml = await file.async('string');
    const blocks = extractTextRuns(xml);
    const pageRef = entry.number;
    const imageUrls = await slideImageUrls(zip, entry.number);
    const images = imageUrls.map((src) => ({ src }));

    if (!blocks.length) {
      chunks.push({
        title: `Slide ${entry.number}`,
        body: '',
        wordCount: 0,
        pageRef,
        hasText: false,
        images,
      });
      continue;
    }

    const title = blocks[0];
    const body = blocks.slice(1).join('\n\n').trim();
    chunks.push({
      title,
      body,
      wordCount: countWords(body),
      pageRef,
      hasText: true,
      images,
    });
  }

  return chunks.map((chunk, index) => ({
    ...chunk,
    images: Array.isArray(chunk.images) ? chunk.images : [],
    source: 'pptx',
    chunkingMethod: 'slide',
    index,
  }));
}
