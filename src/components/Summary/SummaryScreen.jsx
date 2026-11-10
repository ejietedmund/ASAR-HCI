import { useEffect, useState } from 'react';
import { createSession } from '../../storage/db.js';
import { SCREENS, useApp } from '../../state/appState.jsx';

const BREAK_MINUTES = 5;

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

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export default function SummaryScreen() {
  const { payload, navigate, activeDocument } = useApp();
  const summary = payload.summary || {};
  const report = { ...EMPTY_REPORT, ...(summary.report || {}) };
  const fatigueDetected = Boolean(summary.fatigueDetected);

  const [breakEndsAt, setBreakEndsAt] = useState(null);
  const [remaining, setRemaining] = useState(BREAK_MINUTES * 60);

  useEffect(() => {
    if (!breakEndsAt) return undefined;
    const tick = () => setRemaining(Math.max(0, Math.round((breakEndsAt - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [breakEndsAt]);

  const resumeReading = async () => {
    const document = summary.document || activeDocument;
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

  const rows = [
    { label: 'Chunks completed', value: `${report.chunksCompleted} of ${report.totalChunks}` },
    { label: 'Average time per chunk', value: `${report.avgTimePerChunk}s` },
    {
      label: 'Checkpoints answered',
      value: `${report.checkpointsAnswered} of ${report.checkpointsTotal}`,
    },
    { label: 'Chunks marked confusing', value: report.chunksMarkedConfusing },
    { label: 'Chunks marked important', value: report.chunksMarkedImportant },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className={`grid gap-6 items-start ${fatigueDetected ? 'md:grid-cols-2' : ''}`}>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-[#1a2340]">Session summary</h1>
          <p className="mt-1 text-sm text-slate-500">
            {report.empty
              ? 'No reading was recorded in this session.'
              : `You read for about ${report.sessionDuration} minute${report.sessionDuration === 1 ? '' : 's'}.`}
          </p>

          <dl className="mt-5 divide-y divide-slate-100">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between py-3 gap-4">
                <dt className="text-sm text-slate-600">{row.label}</dt>
                <dd className="text-sm font-semibold text-[#1a2340]">{row.value}</dd>
              </div>
            ))}
          </dl>

          <button
            type="button"
            onClick={() => navigate(SCREENS.IMPORT)}
            className="mt-6 w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#1e3a8a] hover:bg-[#1e40af] text-white text-sm font-medium transition-colors"
          >
            Back to library
          </button>
        </div>

        {fatigueDetected && (
          <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-2xl p-6 sm:p-8">
            <span className="inline-block bg-amber-200 text-amber-800 text-xs font-semibold px-3 py-1 rounded-full">
              Suggestion
            </span>
            <h2 className="mt-4 text-xl font-semibold text-[#1a2340]">Time for a short break?</h2>
            <p className="mt-2 text-[#1a2340] leading-relaxed">
              Your reading has been slowing down over the last few chunks, and check-ins are getting
              quicker. A short rest usually brings attention back.
            </p>

            {!breakEndsAt && (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setBreakEndsAt(Date.now() + BREAK_MINUTES * 60 * 1000)}
                  className="px-5 py-2.5 rounded-xl bg-[#1e3a8a] hover:bg-[#1e40af] text-white text-sm font-medium transition-colors"
                >
                  Start {BREAK_MINUTES}-minute break
                </button>
                <button
                  type="button"
                  onClick={resumeReading}
                  className="px-5 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-medium text-[#1a2340] hover:bg-amber-50 transition-colors"
                >
                  Keep reading
                </button>
              </div>
            )}

            {breakEndsAt && (
              <div className="mt-5 bg-white rounded-xl border border-white shadow-sm px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {remaining > 0 ? 'Break in progress' : 'Break complete'}
                </p>
                <p className="mt-1 text-3xl font-semibold text-[#1a2340] tabular-nums">
                  {formatClock(remaining)}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={resumeReading}
                    className="px-5 py-2.5 rounded-xl bg-[#1e3a8a] hover:bg-[#1e40af] text-white text-sm font-medium transition-colors"
                  >
                    Resume reading
                  </button>
                  <button
                    type="button"
                    onClick={() => setBreakEndsAt(null)}
                    className="px-5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-[#1a2340] hover:bg-slate-50 transition-colors"
                  >
                    End break
                  </button>
                </div>
              </div>
            )}

            <p className="mt-5 text-xs text-amber-800">This is only a suggestion. You decide.</p>
          </div>
        )}
      </div>
    </div>
  );
}
