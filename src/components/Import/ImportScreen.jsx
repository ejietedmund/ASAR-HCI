import { useCallback, useEffect, useRef, useState } from 'react';
import { chunkFile, validateFile, withDocumentMeta } from '../../engines/chunking/index.js';
import {
  countChunksForDocument,
  createSession,
  deleteDocument,
  getChunksForDocument,
  getDocuments,
  saveChunks,
  saveDocument,
} from '../../storage/db.js';
import { SCREENS, useApp } from '../../state/appState.jsx';
import { AlertActions, AlertBody, Icon, Modal } from '../shared/ui.jsx';

export default function ImportScreen() {
  const { navigate } = useApp();
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const inputRef = useRef(null);

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

      navigate(SCREENS.GOAL_PLANNER, {
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
      navigate(SCREENS.GOAL_PLANNER, {
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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const record = pendingDelete;
    setPendingDelete(null);
    setError('');
    await deleteDocument(record.id);
    await refreshLibrary();
  };

  return (
    <div className="max-w-[672px] mx-auto px-4 sm:px-6 py-8 sm:py-12 anim-slide">
      <div className="bg-card border border-sep rounded-[24px] shadow-card p-6 sm:p-8">
        <h1 className="text-[26px] font-semibold text-ink tracking-tight">Upload your study material</h1>
        <p className="mt-2 text-ink2 leading-relaxed text-[15px]">
          Add a lecture PDF or PowerPoint and it will be broken into short, paced chunks.
        </p>

        <div className="inline-flex items-center gap-2 text-[12px] font-medium px-3 py-1.5 rounded-full mb-4 mt-5 bg-green/10 text-green">
          <span className="w-1.5 h-1.5 rounded-full bg-green" />
          Works offline. Files never leave this device.
        </div>

        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[14px] text-ink2">No file handy?</span>
          <button
            type="button"
            disabled={processing}
            onClick={() => loadDemo('pdf')}
            className="px-3.5 py-1.5 rounded-full bg-brand-soft text-brand text-[12px] font-semibold hover:brightness-95 transition-all active:scale-[0.97] disabled:opacity-40"
          >
            Try a demo PDF
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => loadDemo('slides')}
            className="px-3.5 py-1.5 rounded-full bg-brand-soft text-brand text-[12px] font-semibold hover:brightness-95 transition-all active:scale-[0.97] disabled:opacity-40"
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
          className={`mt-6 rounded-[22px] border-2 border-dashed px-6 py-10 text-center transition-all ${
            dragging ? 'border-brand bg-brand-soft scale-[1.01]' : 'border-sep bg-bg'
          }`}
        >
          <span
            className={`mx-auto w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
              dragging ? 'bg-brand text-white' : 'bg-fill text-brand'
            }`}
          >
            <Icon name="upload" className="w-6 h-6" />
          </span>
          <p className="mt-3 text-[16px] font-semibold text-ink">Drop a file here</p>
          <p className="mt-1 text-[13px] text-ink3">PDF or PowerPoint (.pdf, .pptx), up to 25 MB</p>
          <button
            type="button"
            disabled={processing}
            onClick={() => inputRef.current && inputRef.current.click()}
            className={`mt-4 px-5 py-3 rounded-full text-[15px] font-semibold transition-all active:scale-[0.97] ${
              processing
                ? 'bg-fill text-ink3 cursor-wait'
                : 'bg-brand text-white shadow-[0_2px_8px_rgba(0,122,255,0.35)] hover:brightness-110'
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

        {processing && (
          <div className="mt-5 flex flex-col items-center gap-2 anim-fade">
            <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            <p className="text-[13px] text-ink2">
              Chunking on this device. This takes a few seconds for large files.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-3 text-[14px] text-red bg-red/10 rounded-xl px-4 py-2.5 anim-fade">{error}</p>
        )}
      </div>

      <div className="mt-6">
        <h2 className="text-[13px] font-semibold uppercase tracking-widest text-ink3">
          Your library
        </h2>
        <div className="mt-3 space-y-2.5">
          {documents.length === 0 && (
            <div className="bg-card border border-sep rounded-[18px] px-5 py-4 text-[14px] text-ink3">
              Nothing here yet. Upload a document to start a session.
            </div>
          )}
          {documents.map((record) => {
            const position = Math.min((record.lastChunkIndex || 0) + 1, Math.max(record.total, 1));
            return (
              <div
                key={record.id}
                className="flex items-stretch gap-2 bg-card border border-sep rounded-[18px] shadow-card overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => resume(record)}
                  className="flex-1 min-w-0 flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-fill/50 transition-all active:scale-[0.99]"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-fill text-brand flex items-center justify-center shrink-0">
                      <Icon name="book" className="w-4.5 h-4.5" />
                    </span>
                    <span className="min-w-0 truncate text-[15px] font-medium text-ink">
                      {record.fileName}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-medium text-ink3 tabular-nums">
                    {record.total > 0 ? `Chunk ${position} of ${record.total}` : 'Not processed'}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${record.fileName}`}
                  onClick={() => setPendingDelete(record)}
                  className="shrink-0 px-4 flex items-center justify-center text-ink3 hover:text-red hover:bg-red/10 transition-colors border-l border-sep"
                >
                  <Icon name="trash" className="w-4.5 h-4.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {pendingDelete && (
        <Modal onClose={() => setPendingDelete(null)} labelled>
          <AlertBody badge="Delete document" title={`Remove ${pendingDelete.fileName}?`}>
            The saved chunks, check-in history and marks for this document will be deleted from this
            device. The original file is not affected.
          </AlertBody>
          <AlertActions
            actions={[
              { label: 'Delete', onClick: confirmDelete, tone: 'danger' },
              { label: 'Cancel', onClick: () => setPendingDelete(null) },
            ]}
          />
        </Modal>
      )}
    </div>
  );
}
