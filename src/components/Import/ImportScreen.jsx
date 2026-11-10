import { useCallback, useEffect, useRef, useState } from 'react';
import { chunkFile, validateFile, withDocumentMeta } from '../../engines/chunking/index.js';
import {
  countChunksForDocument,
  createSession,
  getChunksForDocument,
  getDocuments,
  saveChunks,
  saveDocument,
} from '../../storage/db.js';
import { SCREENS, useApp } from '../../state/appState.jsx';

export default function ImportScreen() {
  const { navigate } = useApp();
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [documents, setDocuments] = useState([]);
  const inputRef = useRef(null);
  const loading = processing;

  const refreshLibrary = useCallback(async () => {
    const stored = (await getDocuments()) || [];
    const rows = await Promise.all(
      stored.map(async (record) => {
        const documentId = `doc_${record.id}`;
        const total = await countChunksForDocument(documentId);
        return { ...record, documentId, total };
      })
    );
    rows.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    setDocuments(rows);
  }, []);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  const ingest = async (file) => {
    if (!file || processing) return;
    setError('');
    setProcessing(true);
    try {
      const extension = validateFile(file);
      const buffer = await file.arrayBuffer();
      const rawChunks = await chunkFile(file, buffer);

      const docDbId = await saveDocument({
        fileName: file.name,
        fileType: extension,
        uploadedAt: Date.now(),
        lastChunkIndex: 0,
      });
      const documentId = docDbId !== null && docDbId !== undefined ? `doc_${docDbId}` : `doc_local_${Date.now()}`;
      const chunks = withDocumentMeta(rawChunks, documentId);
      await saveChunks(chunks);
      const sessionId = await createSession({ documentId, startedAt: Date.now() });

      navigate(SCREENS.READING, {
        document: {
          documentId,
          docDbId,
          chunks,
          startChunkIndex: 0,
          fileName: file.name,
        },
        session: { sessionId },
      });
    } catch (err) {
      setError(err && err.message ? err.message : 'Something went wrong while processing this file.');
      setProcessing(false);
    }
  };

  const handleFile = (file) => {
    void ingest(file);
  };

  const loadDemo = async (kind) => {
    if (processing) return;
    setError('');
    setProcessing(true);
    try {
      const fileName =
        kind === 'slides' ? 'academic-reading-demo.pptx' : 'academic-reading-demo.pdf';
      const response = await fetch(`${import.meta.env.BASE_URL}demo/${fileName}`);
      if (!response.ok) throw new Error('The demo file could not be loaded.');
      const blob = await response.blob();
      const demoFile = new File([blob], fileName, { type: blob.type });
      await ingest(demoFile);
    } catch (err) {
      setError(err && err.message ? err.message : 'Could not load the demo.');
      setProcessing(false);
    }
  };

  const resume = async (record) => {
    if (processing) return;
    setError('');
    try {
      const chunks = await getChunksForDocument(record.documentId);
      if (!chunks.length) {
        setError('This document has no saved chunks.');
        return;
      }
      const sessionId = await createSession({ documentId: record.documentId, startedAt: Date.now() });
      const startChunkIndex = Math.min(record.lastChunkIndex || 0, chunks.length - 1);
      navigate(SCREENS.READING, {
        document: {
          documentId: record.documentId,
          docDbId: record.id,
          chunks,
          startChunkIndex,
          fileName: record.fileName,
        },
        session: { sessionId },
      });
    } catch (err) {
      setError(err && err.message ? err.message : 'Could not resume this document.');
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="max-w-[672px] mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-[#1a2340]">Upload your study material</h1>
        <p className="mt-2 text-slate-500 leading-relaxed">
          Add a lecture PDF or PowerPoint and it will be broken into short, paced chunks.
        </p>

        <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full mb-5 mt-5 bg-green-50 text-green-700">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-500" />
          Works offline — files never leave this device
        </div>

        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">No file handy?</span>
          <button
            type="button"
            disabled={processing}
            onClick={() => loadDemo('pdf')}
            className="px-3 py-1.5 rounded-lg border border-[#2563EB] text-[#2563EB] text-xs font-medium hover:bg-blue-50 transition-colors disabled:opacity-40"
          >
            Try a demo PDF
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => loadDemo('slides')}
            className="px-3 py-1.5 rounded-lg border border-[#2563EB] text-[#2563EB] text-xs font-medium hover:bg-blue-50 transition-colors disabled:opacity-40"
          >
            Try demo slides
          </button>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-6 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? 'border-[#2563EB] bg-blue-50' : 'border-slate-300 bg-slate-50/60'
          }`}
        >
          <p className="text-base font-medium text-[#1a2340]">Drop a file here</p>
          <p className="mt-1 text-sm text-slate-500">PDF or PowerPoint (.pdf, .pptx), up to 25 MB</p>
          <button
            type="button"
            disabled={processing}
            onClick={() => inputRef.current && inputRef.current.click()}
            className={`mt-4 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              processing
                ? 'bg-slate-300 text-slate-500 cursor-wait'
                : 'bg-[#1e3a8a] hover:bg-[#1e40af] text-white'
            }`}
          >
            {processing ? 'Processing…' : 'Choose file'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files && event.target.files[0];
              event.target.value = '';
              if (file) handleFile(file);
            }}
          />
        </div>

        {loading && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-[#1e3a8a] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">
              Chunking on this device — this takes a few seconds for large files…
            </p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Resume a previous document
        </h2>
        <div className="mt-3 space-y-2">
          {documents.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-4 text-sm text-slate-500">
              Nothing here yet. Upload a document to start a session.
            </div>
          )}
          {documents.map((record) => {
            const position = Math.min((record.lastChunkIndex || 0) + 1, Math.max(record.total, 1));
            return (
              <button
                key={record.id}
                type="button"
                onClick={() => resume(record)}
                className="w-full flex items-center justify-between gap-4 bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-4 text-left hover:border-[#2563EB] hover:bg-blue-50/40 transition-colors"
              >
                <span className="min-w-0 truncate text-sm font-medium text-[#1a2340]">
                  {record.fileName}
                </span>
                <span className="shrink-0 text-sm text-slate-500">
                  {record.total > 0 ? `Chunk ${position} of ${record.total}` : 'Not processed'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
