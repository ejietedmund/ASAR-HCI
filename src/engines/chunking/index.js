import { chunkPptx } from './pptxChunker.js';
import { chunkPdf } from './pdfChunker.js';

export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = ['pdf', 'pptx'];

export function getExtension(fileName) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName || '');
  return match ? match[1].toLowerCase() : '';
}

export function validateFile(file) {
  if (!file) throw new Error('No file selected.');
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File is larger than 25 MB. Please use a smaller file.');
  }
  const extension = getExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new Error('Only .pdf and .pptx files are supported.');
  }
  return extension;
}

export async function chunkFile(file, arrayBuffer) {
  const extension = validateFile(file);
  const buffer = arrayBuffer || (await file.arrayBuffer());

  let rawChunks = [];
  try {
    rawChunks = extension === 'pdf' ? await chunkPdf(buffer) : await chunkPptx(buffer);
  } catch (error) {
    if (error && error.isValidationError) throw error;
    throw new Error('This file could not be read. Please try a different file.');
  }

  const hasContent = (chunk) =>
    chunk.hasText || (Array.isArray(chunk.images) && chunk.images.length > 0);

  if (!rawChunks.length || !rawChunks.some(hasContent)) {
    throw new Error('No readable content found in this file.');
  }

  return rawChunks;
}

export function withDocumentMeta(chunks, documentId) {
  return chunks.map((chunk, index) => ({
    ...chunk,
    id: chunk.id || `${documentId}_chunk_${index}`,
    documentId,
    index,
    source: chunk.source || 'pdf',
  }));
}
