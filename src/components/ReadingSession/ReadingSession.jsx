import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SCREENS, useApp } from '../../state/appState.jsx';
import CheckpointModal from '../Checkpoint/CheckpointModal.jsx';
import AnnotatePanel from '../Annotate/AnnotatePanel.jsx';
import BreakOverlay from '../shared/BreakOverlay.jsx';
import { FormattedText, FigureGallery } from '../shared/FormattedText.jsx';
import { AlertActions, AlertBody, Icon, Modal } from '../shared/ui.jsx';
import { capTimeSpent, createChunkTimer, expectedReadingTime } from '../../engines/engagement/index.js';
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

const TEXT_SIZE_CLASS = { small: 'text-[16px]', medium: 'text-[18px]', large: 'text-[20px]' };
const BREAK_PRESETS = [3, 5, 10, 15];
const EXTEND_PRESETS = [5, 10, 15];

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export default function ReadingSession() {
  const { payload, navigate, preferences } = useApp();
  const doc = payload.document || {};
  const session = payload.session || {};
  const goal = payload.goal || null;
  const goalMinutes = goal && goal.minutes ? Number(goal.minutes) : null;
  const chunks = useMemo(() => doc.chunks || [], [doc.chunks]);
  const total = chunks.length;

  const [chunkIndex, setChunkIndex] = useState(() =>
    Math.max(0, Math.min(doc.startChunkIndex || 0, Math.max((doc.chunks || []).length - 1, 0)))
  );
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState(false);
  const [skimNoticeOpen, setSkimNoticeOpen] = useState(false);
  const [breakReason, setBreakReason] = useState(null); // 'skim' | 'time'
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [timeUpOpen, setTimeUpOpen] = useState(false);
  const [remainingMs, setRemainingMs] = useState(null);

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
  const skimNoticeRef = useRef({ lastChunk: -99, shown: 0 });
  const deadlineRef = useRef(null);
  const breakStartedAtRef = useRef(null);
  const timeUpShownRef = useRef(false);

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

  /* Reading-goal countdown: the planner passes the number of minutes the
     reader asked for; a reminder appears the moment the time is used up. */
  useEffect(() => {
    if (!goalMinutes) {
      setRemainingMs(null);
      return undefined;
    }
    deadlineRef.current = Date.now() + goalMinutes * 60 * 1000;
    timeUpShownRef.current = false;
    const tick = () => {
      const left = deadlineRef.current - Date.now();
      setRemainingMs(left > 0 ? left : 0);
      if (left <= 0 && !timeUpShownRef.current) {
        timeUpShownRef.current = true;
        setTimeUpOpen(true);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [goalMinutes, session.sessionId]);

  const extendReadingTime = useCallback((minutes = 5) => {
    if (deadlineRef.current) deadlineRef.current += minutes * 60 * 1000;
    timeUpShownRef.current = false;
    setTimeUpOpen(false);
  }, []);

  const pauseGoalDuringBreak = useCallback(() => {
    breakStartedAtRef.current = Date.now();
  }, []);

  const resumeGoalAfterBreak = useCallback(() => {
    if (deadlineRef.current && breakStartedAtRef.current) {
      deadlineRef.current += Date.now() - breakStartedAtRef.current;
    }
    breakStartedAtRef.current = null;
  }, []);

  const persistEntry = useCallback(async (entry) => {
    if (!entry) return;
    logsRef.current.push(entry);
    await logEngagement(entry);
  }, []);

  const finishSession = useCallback(
    async ({ completed, fatigueDetected, lastChunkIndex, reason }) => {
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
        summary: {
          report,
          fatigueDetected: Boolean(fatigueDetected),
          reason: reason || (completed ? 'completed' : 'paused'),
          chunks,
          document: doc,
          lastChunkIndex,
          goalMinutes,
        },
      });
    },
    [chunks, doc, goalMinutes, navigate, session.sessionId]
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
          reason: 'fatigue',
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
      if (pacingRef.current.tightened) {
        const notice = skimNoticeRef.current;
        if (notice.shown < 3 && chunkIndexRef.current - notice.lastChunk >= 3) {
          notice.lastChunk = chunkIndexRef.current;
          notice.shown += 1;
          setSkimNoticeOpen(true);
        }
      }
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
        await finishSession({
          completed: true,
          fatigueDetected: false,
          lastChunkIndex: total - 1,
          reason: 'completed',
        });
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
        <div className="bg-card border border-sep rounded-[24px] shadow-card p-8 text-center">
          <p className="text-ink2">This document has no readable chunks.</p>
          <button
            type="button"
            onClick={() => navigate(SCREENS.IMPORT)}
            className="mt-4 px-6 py-3 rounded-full bg-brand hover:brightness-110 text-white text-[15px] font-semibold transition-all active:scale-[0.97]"
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
  const bodySizeClass = TEXT_SIZE_CLASS[preferences.textSize] || 'text-[18px]';
  const fontClass = preferences.readingFont === 'sans' ? 'font-sans' : 'font-serif';
  const hasImages = Array.isArray(chunk.images) && chunk.images.length > 0;
  const hasReadableText = chunk.hasText !== false && Boolean(chunk.body && chunk.body.trim());
  const marked = Boolean(marks[chunkIndex]);
  const frequency = Math.max(1, Number(pacingRef.current.frequency) || Number(preferences.checkpointFrequency) || 5);
  const nextCheckpointChunk = Math.ceil((chunkIndex + 1) / frequency) * frequency;
  const hint =
    nextCheckpointChunk < total
      ? `A short check-in comes after chunk ${nextCheckpointChunk}`
      : 'No more check-ins in this session';
  const readMinutes = Math.max(1, Math.ceil(expectedReadingTime(chunk.wordCount) / 60));
  const timerUrgent = remainingMs !== null && remainingMs <= 60 * 1000;

  return (
    <div>
      <div className="sticky top-14 z-30 bg-card/85 backdrop-blur-xl border-b border-sep">
        <div className="max-w-[920px] mx-auto px-4 sm:px-6 py-2.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-ink truncate">{doc.fileName}</span>
            <span className="flex items-center gap-2 shrink-0">
              {remainingMs !== null && (
                <span
                  data-testid="goal-timer"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums ${
                    timerUrgent ? 'bg-amber-soft text-amber' : 'bg-fill text-ink2'
                  }`}
                >
                  <Icon name="clock" className="w-3.5 h-3.5" />
                  {formatClock(remainingMs)}
                </span>
              )}
              <span className="text-ink2 font-medium tabular-nums">
                Chunk {chunkIndex + 1} of {total}
              </span>
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-fill overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-ink3">{hint}</p>
        </div>
      </div>

      <div className="max-w-[920px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <article
          key={chunkIndex}
          className="bg-card border border-sep rounded-[24px] shadow-card anim-fade overflow-hidden md:aspect-[16/9] md:max-h-[74vh]"
        >
          <div className="h-full overflow-y-auto p-6 sm:p-10">
            <header>
              <h1 className="font-serif text-[24px] sm:text-[27px] leading-snug font-semibold text-ink tracking-tight">
                {chunk.title}
              </h1>
              <p className="mt-1.5 text-[12px] font-medium tracking-wide text-ink3">
                {chunk.wordCount} words · about {readMinutes} min read
              </p>
            </header>

            {hasImages && (
              <div className="mt-6">
                <FigureGallery images={chunk.images} title={chunk.title} />
              </div>
            )}

            {hasReadableText ? (
              <div className="mt-6">
                <FormattedText body={chunk.body} sizeClass={bodySizeClass} fontClass={fontClass} />
              </div>
            ) : (
              !hasImages && (
                <p className={`mt-6 italic ${bodySizeClass} ${fontClass} text-ink3`}>
                  This slide has no readable text.
                </p>
              )
            )}

            <div className="mt-9 flex items-stretch gap-3 border-t border-sep pt-6">
              <button
                type="button"
                onClick={handlePrevious}
                disabled={chunkIndex === 0 || busy}
                className={`flex items-center justify-center gap-1.5 flex-1 px-4 py-3.5 rounded-full bg-fill text-ink text-[15px] font-medium transition-all active:scale-[0.97] hover:bg-fill-strong ${
                  chunkIndex === 0 ? 'opacity-35 cursor-not-allowed hover:bg-fill' : ''
                }`}
              >
                <Icon name="chevronLeft" className="w-4 h-4" />
                Previous
              </button>
              <button
                type="button"
                onClick={() => setAnnotateOpen(true)}
                className={`flex items-center justify-center gap-1.5 flex-1 px-4 py-3.5 rounded-full border text-[15px] font-medium transition-all active:scale-[0.97] ${
                  marked
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-sep bg-card text-ink hover:bg-fill'
                }`}
              >
                <Icon name="flag" className="w-4 h-4" />
                {marked ? 'Marked' : 'Mark chunk'}
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 flex-1 px-4 py-3.5 rounded-full bg-brand text-white text-[15px] font-semibold shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-[0.97] hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
              >
                {isLast ? 'Finish' : 'Next'}
                {!isLast && <Icon name="chevronRight" className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </article>
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

      {timeUpOpen && (
        <Modal onClose={() => extendReadingTime(EXTEND_PRESETS[0])} labelled>
          <AlertBody
            badge="Reading goal"
            badgeClass="bg-green/15 text-green"
            title="Time is up"
          >
            <p>
              You planned {goalMinutes} minute{goalMinutes === 1 ? '' : 's'} of reading and used it
              all. Nice work. Finish here, take a break, or keep reading.
            </p>
            <p className="mt-2 text-[13px] text-ink3">Choose how long to continue reading:</p>
          </AlertBody>
          <AlertActions
            actions={[
              ...EXTEND_PRESETS.map((m) => ({
                label: `Keep reading (+${m} min)`,
                onClick: () => extendReadingTime(m),
              })),
              {
                label: 'Finish session',
                primary: true,
                onClick: () =>
                  finishSession({
                    completed: chunkIndexRef.current >= total - 1,
                    fatigueDetected: false,
                    lastChunkIndex: chunkIndexRef.current,
                    reason: 'time-up',
                  }),
              },
            ]}
          />
        </Modal>
      )}

      {skimNoticeOpen && (
        <Modal onClose={() => setSkimNoticeOpen(false)} labelled>
          <AlertBody
            badge="Reading pace"
            badgeClass="bg-amber-soft text-amber"
            title="You're moving through this quickly"
          >
            <p>
              The last few chunks were read much faster than a comfortable pace. A short break now
              beats re-reading later.
            </p>
            <p className="mt-2 text-[13px] text-ink3">Choose a break length:</p>
          </AlertBody>
          <AlertActions
            actions={[
              ...BREAK_PRESETS.map((m) => ({
                label: `Take a ${m}-minute break`,
                onClick: () => {
                  setSkimNoticeOpen(false);
                  setBreakMinutes(m);
                  pauseGoalDuringBreak();
                  setBreakReason('skim');
                },
              })),
              {
                label: 'Keep reading',
                primary: true,
                onClick: () => setSkimNoticeOpen(false),
              },
            ]}
          />
        </Modal>
      )}

      {breakReason && (
        <BreakOverlay
          minutes={breakMinutes}
          reason={breakReason}
          onResume={() => {
            resumeGoalAfterBreak();
            setBreakReason(null);
          }}
          onEnd={() =>
            finishSession({
              completed: false,
              fatigueDetected: false,
              lastChunkIndex: chunkIndexRef.current,
              reason: 'break',
            })
          }
        />
      )}
    </div>
  );
}
