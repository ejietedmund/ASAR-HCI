import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SCREENS, useApp } from '../../state/appState.jsx';
import CheckpointModal from '../Checkpoint/CheckpointModal.jsx';
import AnnotatePanel from '../Annotate/AnnotatePanel.jsx';
import { capTimeSpent, createChunkTimer } from '../../engines/engagement/index.js';
import { applyPacing } from '../../engines/pacing/index.js';
import { detectFatigue } from '../../engines/scheduler/index.js';
import { buildReport } from '../../engines/reporting/index.js';
import {
  createSession,
  endSession,
  getAnnotationsForDocument,
  logEngagement,
  saveAnnotation,
  updateDocumentPosition,
} from '../../storage/db.js';

const TEXT_SIZE_CLASS = { small: 'text-base', medium: 'text-lg', large: 'text-xl' };

export default function ReadingSession() {
  const { payload, navigate, preferences } = useApp();
  const doc = payload.document || {};
  const session = payload.session || {};
  const chunks = useMemo(() => doc.chunks || [], [doc.chunks]);
  const total = chunks.length;

  const [chunkIndex, setChunkIndex] = useState(() =>
    Math.max(0, Math.min(doc.startChunkIndex || 0, Math.max((doc.chunks || []).length - 1, 0)))
  );
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState(false);

  const timerRef = useRef(null);
  const chunkIndexRef = useRef(chunkIndex);
  const logsRef = useRef([]);
  const navRef = useRef([]);
  const checkpointEventsRef = useRef([]);
  const pacingRef = useRef({ streak: 0, frequency: preferences.checkpointFrequency || 5, changes: 0 });
  const pendingRef = useRef(null);
  const checkpointOpenedAtRef = useRef(0);
  const startedAtRef = useRef(Date.now());
  const endedRef = useRef(false);

  useEffect(() => {
    chunkIndexRef.current = chunkIndex;
  }, [chunkIndex]);

  useEffect(() => {
    pacingRef.current.frequency = Number(preferences.checkpointFrequency) || 5;
  }, [preferences.checkpointFrequency]);

  useEffect(() => {
    const timer = createChunkTimer();
    timer.start();
    timerRef.current = timer;
    return () => {
      timer.stop();
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [chunkIndex]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await getAnnotationsForDocument(doc.documentId);
      if (!alive || !rows || !rows.length) return;
      const byChunk = {};
      rows.forEach((row) => {
        byChunk[row.chunkIndex] = row;
      });
      setMarks(byChunk);
    })();
    return () => {
      alive = false;
    };
  }, [doc.documentId]);

  const persistEntry = useCallback(async (entry) => {
    if (!entry) return;
    logsRef.current.push(entry);
    await logEngagement(entry);
  }, []);

  const finishSession = useCallback(
    async ({ completed, fatigueDetected, lastChunkIndex }) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const endedAt = Date.now();
      await endSession(session.sessionId, { endedAt, completed, lastChunkIndex });
      const annotations = await getAnnotationsForDocument(doc.documentId);
      const report = buildReport({
        logs: logsRef.current,
        annotations,
        chunks,
        pacingChanges: pacingRef.current.changes,
        startedAt: startedAtRef.current,
        endedAt,
      });
      navigate(SCREENS.SUMMARY, {
        summary: { report, fatigueDetected: Boolean(fatigueDetected), chunks, document: doc, lastChunkIndex },
      });
    },
    [chunks, doc, navigate, session.sessionId]
  );

  const evaluateFatigue = useCallback(
    () =>
      detectFatigue({
        chunkTimes: logsRef.current.map((log) => log.timeSpent),
        checkpointEvents: checkpointEventsRef.current,
        navigationEvents: navRef.current,
      }),
    []
  );

  const moveTo = useCallback(
    async (entry, direction, targetIndex) => {
      await persistEntry(entry);
      navRef.current.push(direction);
      await updateDocumentPosition(doc.docDbId, targetIndex);
      if (evaluateFatigue().detected) {
        await finishSession({
          completed: false,
          fatigueDetected: true,
          lastChunkIndex: chunkIndexRef.current,
        });
        return;
      }
      setChunkIndex(targetIndex);
    },
    [doc.docDbId, evaluateFatigue, finishSession, persistEntry]
  );

  const recordCurrentChunk = useCallback(
    (direction) => {
      const chunk = chunks[chunkIndexRef.current];
      const timer = timerRef.current;
      if (!chunk || !timer) return null;
      timer.pause();
      const capped = capTimeSpent(timer.elapsed(), chunk.wordCount);
      const entry = {
        sessionId: session.sessionId === undefined ? null : session.sessionId,
        chunkId: chunk.id,
        chunkIndex: chunkIndexRef.current,
        timeSpent: Math.round(capped),
        navigationDirection: direction,
        checkpointResponse: null,
        checkpointResponseTime: null,
        timestamp: Date.now(),
      };
      pacingRef.current = applyPacing(pacingRef.current, capped, chunk.wordCount);
      return entry;
    },
    [chunks, session.sessionId]
  );

  const handleNext = async () => {
    if (busy || endedRef.current || !total) return;
    setBusy(true);
    try {
      const isLast = chunkIndexRef.current >= total - 1;
      const entry = recordCurrentChunk('forward');
      const chunkNumber = chunkIndexRef.current + 1;
      const frequency = Math.max(1, pacingRef.current.frequency);

      if (!isLast && chunkNumber % frequency === 0) {
        pendingRef.current = entry;
        checkpointOpenedAtRef.current = Date.now();
        setCheckpointOpen(true);
        return;
      }

      if (isLast) {
        await persistEntry(entry);
        await updateDocumentPosition(doc.docDbId, total - 1);
        await finishSession({ completed: true, fatigueDetected: false, lastChunkIndex: total - 1 });
        return;
      }

      await moveTo(entry, 'forward', chunkIndexRef.current + 1);
    } finally {
      setBusy(false);
    }
  };

  const handlePrevious = async () => {
    if (busy || endedRef.current || chunkIndexRef.current === 0) return;
    setBusy(true);
    try {
      const entry = recordCurrentChunk('backward');
      await moveTo(entry, 'backward', chunkIndexRef.current - 1);
    } finally {
      setBusy(false);
    }
  };

  const handleCheckpointDone = async (answer) => {
    if (endedRef.current) {
      setCheckpointOpen(false);
      return;
    }
    const entry = pendingRef.current;
    const response = (answer || '').trim();
    const responseTime = Date.now() - checkpointOpenedAtRef.current;
    pendingRef.current = null;
    setCheckpointOpen(false);
    setBusy(true);
    try {
      if (entry) {
        entry.checkpointResponse = response;
        entry.checkpointResponseTime = responseTime;
        await persistEntry(entry);
      }
      checkpointEventsRef.current.push({ response, responseTime, skipped: response === '' });
      await moveTo(null, 'forward', Math.min(chunkIndexRef.current + 1, total - 1));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveMark = async ({ type, note }) => {
    const chunk = chunks[chunkIndexRef.current];
    if (!chunk) return;
    const record = {
      documentId: doc.documentId,
      chunkId: chunk.id,
      chunkIndex: chunkIndexRef.current,
      type,
      note: note || '',
      createdAt: Date.now(),
    };
    const id = await saveAnnotation(record);
    setMarks((previous) => ({ ...previous, [chunkIndexRef.current]: { ...record, id } }));
    setAnnotateOpen(false);
  };

  if (!total || !chunks[chunkIndex]) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
          <p className="text-slate-600">This document has no readable chunks.</p>
          <button
            type="button"
            onClick={() => navigate(SCREENS.IMPORT)}
            className="mt-4 px-5 py-2.5 rounded-xl bg-[#1e3a8a] hover:bg-[#1e40af] text-white text-sm font-medium"
          >
            Back to library
          </button>
        </div>
      </div>
    );
  }

  const chunk = chunks[chunkIndex];
  const isLast = chunkIndex >= total - 1;
  const progress = ((chunkIndex + 1) / total) * 100;
  const bodySizeClass = TEXT_SIZE_CLASS[preferences.textSize] || 'text-lg';
  const highContrast = preferences.contrast === 'high';
  const hasReadableText = chunk.hasText !== false && Boolean(chunk.body && chunk.body.trim());
  const marked = Boolean(marks[chunkIndex]);
  const frequency = Math.max(1, Number(pacingRef.current.frequency) || Number(preferences.checkpointFrequency) || 5);
  const nextCheckpointChunk = (Math.floor((chunkIndex + 1) / frequency) + 1) * frequency;
  const hint =
    nextCheckpointChunk <= total
      ? `A short check-in comes after chunk ${nextCheckpointChunk}`
      : 'No more check-ins in this session';

  return (
    <div>
      <div className="sticky top-14 z-30 bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-[#1a2340] truncate">{doc.fileName}</span>
            <span className="shrink-0 text-slate-500">
              Chunk {chunkIndex + 1} of {total}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#2563EB] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
          <h1 className="font-serif text-2xl sm:text-[28px] leading-snug text-[#1a2340]">
            {chunk.title}
          </h1>
          {chunk.hasImage && chunk.imageDataUrl ? (
            <div className="w-full flex justify-center mt-5">
              <img
                src={chunk.imageDataUrl}
                alt={chunk.title}
                className="w-full rounded-lg"
                style={{ maxHeight: '72vh', objectFit: 'contain' }}
              />
            </div>
          ) : Array.isArray(chunk.images) && chunk.images.length > 0 ? (
            <div className="mt-5 space-y-4">
              {chunk.images.map((image, imageIndex) => (
                <img
                  key={`${imageIndex}-${(image.src || '').slice(-24)}`}
                  src={image.src}
                  alt={image.alt || `${chunk.title || 'Document'} figure ${imageIndex + 1}`}
                  width={image.width}
                  height={image.height}
                  className="block max-w-full h-auto rounded-lg border border-slate-200"
                  loading="lazy"
                />
              ))}
            </div>
          ) : null}
          {hasReadableText ? (
            <p
              className={`mt-5 leading-relaxed whitespace-pre-line ${bodySizeClass} ${
                highContrast ? 'text-black' : 'text-slate-700'
              }`}
            >
              {chunk.body}
            </p>
          ) : !(Array.isArray(chunk.images) && chunk.images.length) && !chunk.imageDataUrl && (
            <p className={`mt-5 italic ${bodySizeClass} ${highContrast ? 'text-black' : 'text-slate-500'}`}>
              This slide has no readable text.
            </p>
          )}

          <div className="mt-8 flex items-stretch gap-3">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={chunkIndex === 0 || busy}
              className={`flex-1 px-4 py-3 rounded-xl border border-slate-300 text-sm font-medium text-[#1a2340] hover:bg-slate-50 transition-colors ${
                chunkIndex === 0 ? 'opacity-30 cursor-not-allowed' : ''
              }`}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setAnnotateOpen(true)}
              className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                marked
                  ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                  : 'border-slate-300 text-[#1a2340] hover:bg-slate-50'
              }`}
            >
              {marked ? 'Marked ✓' : 'Mark chunk'}
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={busy}
              className="flex-1 px-4 py-3 rounded-xl bg-[#1e3a8a] hover:bg-[#1e40af] text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>

          <p className="mt-3 text-center text-xs text-slate-500">{hint}</p>
        </div>
      </div>

      {checkpointOpen && (
        <CheckpointModal
          chunkNumber={chunkIndex + 1}
          chunkIndex={chunkIndex}
          onSubmit={handleCheckpointDone}
          onSkip={() => handleCheckpointDone('')}
        />
      )}

      {annotateOpen && (
        <AnnotatePanel
          initial={marks[chunkIndex]}
          onCancel={() => setAnnotateOpen(false)}
          onSave={handleSaveMark}
        />
      )}
    </div>
  );
}
