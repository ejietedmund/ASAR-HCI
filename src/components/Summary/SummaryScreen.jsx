import { useEffect, useState } from 'react';
import { createSession, getAnnotationsForDocument } from '../../storage/db.js';
import { SCREENS, useApp } from '../../state/appState.jsx';
import BreakOverlay from '../shared/BreakOverlay.jsx';
import { Icon, PrimaryButton, SecondaryButton } from '../shared/ui.jsx';

const BREAK_OPTIONS = [3, 5, 10, 15];

const EMPTY_REPORT = {
  empty: true,
  chunksCompleted: 0,
  totalChunks: 0,
  completionPercent: 0,
  avgTimePerChunk: 0,
  checkpointsAnswered: 0,
  checkpointsTotal: 0,
  chunksMarkedConfusing: 0,
  chunksMarkedImportant: 0,
  pacingChanges: 0,
  sessionDuration: 0,
};

export default function SummaryScreen() {
  const { payload, navigate, activeDocument } = useApp();
  const summary = payload.summary || {};
  const report = { ...EMPTY_REPORT, ...(summary.report || {}) };
  const fatigueDetected = Boolean(summary.fatigueDetected);
  const [breakOpen, setBreakOpen] = useState(false);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [annotations, setAnnotations] = useState([]);
  const document = summary.document || activeDocument;

  useEffect(() => {
    let cancelled = false;
    if (!document || !document.documentId) return undefined;
    getAnnotationsForDocument(document.documentId).then((rows) => {
      if (!cancelled) {
        setAnnotations(
          (rows || []).slice().sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0))
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [document]);

  const openChunk = async (annotation) => {
    if (!document || !document.chunks || !document.chunks.length) {
      navigate(SCREENS.IMPORT);
      return;
    }
    const sessionId = await createSession({
      documentId: document.documentId,
      startedAt: Date.now(),
    });
    const startChunkIndex = Math.min(
      Math.max(0, annotation.chunkIndex || 0),
      Math.max(document.chunks.length - 1, 0)
    );
    navigate(SCREENS.READING, {
      document: { ...document, startChunkIndex },
      session: { sessionId },
    });
  };

  const resumeReading = async () => {
    if (!document || !document.chunks || !document.chunks.length) {
      navigate(SCREENS.IMPORT);
      return;
    }
    const sessionId = await createSession({
      documentId: document.documentId,
      startedAt: Date.now(),
    });
    const lastChunkIndex =
      summary.lastChunkIndex === undefined || summary.lastChunkIndex === null
        ? document.startChunkIndex || 0
        : summary.lastChunkIndex;
    const startChunkIndex = Math.min(
      Math.max(0, lastChunkIndex),
      Math.max(document.chunks.length - 1, 0)
    );
    navigate(SCREENS.READING, {
      document: { ...document, startChunkIndex },
      session: { sessionId },
    });
  };

  const reasonCopy = {
    completed: 'You finished the document. Well done.',
    'time-up': 'You used the reading time you planned for.',
    fatigue: 'This session ended early because focus was fading.',
    break: 'You stopped during a break. Come back soon.',
    paused: '',
  };
  const reason = reasonCopy[summary.reason] !== undefined ? reasonCopy[summary.reason] : '';

  const rows = [
    { label: 'Chunks completed', value: `${report.chunksCompleted} of ${report.totalChunks}` },
    { label: 'Average time per chunk', value: `${report.avgTimePerChunk}s` },
    {
      label: 'Check-ins answered',
      value: `${report.checkpointsAnswered} of ${report.checkpointsTotal}`,
    },
    { label: 'Chunks marked confusing', value: report.chunksMarkedConfusing },
    { label: 'Chunks marked important', value: report.chunksMarkedImportant },
  ];

  return (
    <div className="max-w-[560px] mx-auto px-4 sm:px-6 py-8 sm:py-12 anim-slide">
      <div className="bg-card border border-sep rounded-[24px] shadow-card p-6 sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-green/15 text-green flex items-center justify-center">
            <Icon name="check" className="w-5 h-5" />
          </span>
          <h1 className="text-[26px] font-semibold text-ink tracking-tight">Session summary</h1>
        </div>
        <p className="mt-1.5 text-[15px] text-ink2 leading-relaxed">
          {report.empty ? 'No reading was recorded in this session.' : `You read for about ${report.sessionDuration} minute${report.sessionDuration === 1 ? '' : 's'}.`}
          {reason ? ` ${reason}` : ''}
        </p>

        <dl className="mt-5 divide-y divide-sep">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between py-3 gap-4">
              <dt className="text-[15px] text-ink2">{row.label}</dt>
              <dd className="text-[15px] font-semibold text-ink tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>

        {annotations.length > 0 && (
          <div className="mt-6">
            <h2 className="text-[13px] font-semibold uppercase tracking-widest text-ink3">
              Marks in this document
            </h2>
            <ul className="mt-3 space-y-2.5">
              {annotations.map((annotation) => (
                <li
                  key={annotation.id}
                  className="bg-bg border border-sep rounded-2xl px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-ink3 tabular-nums">
                      Chunk {(annotation.chunkIndex || 0) + 1}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        annotation.type === 'confusing'
                          ? 'bg-amber-soft text-amber'
                          : 'bg-brand-soft text-brand'
                      }`}
                    >
                      {annotation.type === 'confusing' ? 'Confusing' : 'Important'}
                    </span>
                  </div>
                  {annotation.note && (
                    <p className="mt-1.5 text-[14px] text-ink2 leading-relaxed">
                      {annotation.note}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => openChunk(annotation)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline"
                  >
                    Go to chunk {(annotation.chunkIndex || 0) + 1}
                    <Icon name="arrowRight" className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {!report.empty && !fatigueDetected && (
            <SecondaryButton className="w-full py-3.5" onClick={resumeReading}>
              Continue reading
            </SecondaryButton>
          )}
          <PrimaryButton className="w-full py-3.5" onClick={() => navigate(SCREENS.IMPORT)}>
            Back to library
          </PrimaryButton>
        </div>
      </div>

      {fatigueDetected && !breakOpen && (
        <div className="mt-6 bg-amber-soft border border-amber/25 rounded-[24px] p-6 sm:p-8 anim-fade">
          <span className="inline-flex items-center gap-1.5 bg-amber/15 text-amber text-[12px] font-semibold px-3 py-1 rounded-full">
            <Icon name="coffee" className="w-3.5 h-3.5" />
            Suggestion
          </span>
          <h2 className="mt-3 text-[20px] font-semibold text-ink">Time for a short break?</h2>
          <p className="mt-1.5 text-[15px] text-ink2 leading-relaxed">
            Your reading has been slowing down over the last few chunks, and check-ins are getting
            quicker. A short rest usually brings attention back.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {BREAK_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setBreakMinutes(m); setBreakOpen(true); }}
                className="px-4 py-2.5 rounded-full bg-amber text-white text-[14px] font-semibold shadow-[0_2px_8px_rgba(245,158,11,0.35)] transition-all active:scale-[0.97] hover:brightness-110"
              >
                {m}-minute break
              </button>
            ))}
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={resumeReading}
              className="w-full sm:w-auto px-5 py-3 rounded-full bg-card border border-sep text-ink text-[15px] font-medium transition-all active:scale-[0.97] hover:bg-fill"
            >
              Keep reading
            </button>
          </div>
          <p className="mt-4 text-[12px] text-ink3">This is only a suggestion. You decide.</p>
        </div>
      )}

      {breakOpen && (
        <BreakOverlay
          minutes={breakMinutes}
          reason="fatigue"
          onResume={() => {
            setBreakOpen(false);
            void resumeReading();
          }}
          onEnd={() => navigate(SCREENS.IMPORT)}
        />
      )}
    </div>
  );
}
