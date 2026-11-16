import { useMemo, useState } from 'react';
import { evaluateGoal } from '../../engines/planner/index.js';
import { createSession } from '../../storage/db.js';
import { SCREENS, useApp } from '../../state/appState.jsx';
import { Icon, PrimaryButton } from '../shared/ui.jsx';

const PRESETS = [10, 15, 20, 25, 30, 45];

export default function GoalPlannerScreen() {
  const { payload, preferences, activeDocument, navigate } = useApp();
  const doc = payload.document || activeDocument;
  const session = payload.session || {};
  const chunks = doc && doc.chunks ? doc.chunks : null;
  const total = chunks ? chunks.length : 0;
  const frequency = Number(preferences.checkpointFrequency) || 5;
  const startChunkIndex = doc ? doc.startChunkIndex || 0 : 0;
  const remaining = Math.max(0, total - startChunkIndex);
  const remainingChunks = useMemo(
    () => (chunks ? chunks.slice(startChunkIndex) : null),
    [chunks, startChunkIndex]
  );

  const [minutes, setMinutes] = useState(20);
  const [starting, setStarting] = useState(false);

  const estimate = useMemo(() => {
    if (!remaining) return null;
    return evaluateGoal({
      targetChunks: remaining,
      availableMinutes: minutes,
      chunks: remainingChunks,
      frequency,
    });
  }, [remaining, minutes, remainingChunks, frequency]);

  const startReading = async (chosenMinutes) => {
    if (!doc || !doc.chunks || !doc.chunks.length) return;
    setStarting(true);
    try {
      let sessionId = session.sessionId;
      if (sessionId === undefined || sessionId === null) {
        sessionId = await createSession({ documentId: doc.documentId, startedAt: Date.now() });
      }
      navigate(SCREENS.READING, {
        document: { ...doc },
        session: { sessionId },
        goal: { minutes: chosenMinutes },
      });
    } finally {
      setStarting(false);
    }
  };

  if (!doc || !total) {
    return (
      <div className="max-w-[560px] mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="bg-card border border-sep rounded-[24px] shadow-card p-8 text-center">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-fill text-ink2 flex items-center justify-center">
            <Icon name="target" className="w-6 h-6" />
          </span>
          <h1 className="mt-4 text-[22px] font-semibold text-ink">No document selected</h1>
          <p className="mt-1.5 text-ink2 text-[15px] leading-relaxed">
            Upload a lecture PDF or slide deck first, then choose how long you want to read.
          </p>
          <PrimaryButton className="mt-6" onClick={() => navigate(SCREENS.IMPORT)}>
            Go to library
          </PrimaryButton>
        </div>
      </div>
    );
  }

  const fullEstimateMinutes = estimate ? Math.max(1, Math.round(estimate.estimatedMinutes)) : 0;
  const suggestedChunks = estimate ? estimate.suggestedChunks : 0;
  const coverPercent = remaining ? Math.round((suggestedChunks / remaining) * 100) : 0;
  const shorterThanOneChunk = Boolean(estimate) && suggestedChunks === 0;
  const firstChunkWords = remainingChunks && remainingChunks[0] ? remainingChunks[0].wordCount || 0 : 0;
  const minimumMinutes = Math.max(1, Math.ceil(firstChunkWords / 120));

  return (
    <div className="max-w-[560px] mx-auto px-4 sm:px-6 py-8 sm:py-10 anim-slide">
      <div className="bg-card border border-sep rounded-[24px] shadow-card overflow-hidden">
        <div className="bg-brand px-6 py-5">
          <p className="text-[12px] font-semibold uppercase tracking-widest text-white/70">
            Reading goal
          </p>
          <h1 className="mt-1 text-[22px] font-semibold text-white leading-snug truncate">
            {doc.fileName}
          </h1>
          <p className="mt-1 text-[13px] text-white/80">
            {remaining} chunk{remaining === 1 ? '' : 's'} left · about {fullEstimateMinutes} min to
            read fully
            {startChunkIndex > 0 ? ` · continuing from chunk ${startChunkIndex + 1}` : ''}
          </p>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <Icon name="clock" className="w-4.5 h-4.5 text-brand" />
            <h2 className="text-[17px] font-semibold text-ink">How long do you want to read?</h2>
          </div>
          <p className="mt-1 text-[14px] text-ink2 leading-relaxed">
            Pick a time budget. You'll get a gentle reminder when it's used up.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const selected = minutes === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setMinutes(preset)}
                  className={`px-4 py-2.5 rounded-full text-[14px] font-semibold transition-all active:scale-[0.96] ${
                    selected
                      ? 'bg-brand text-white shadow-[0_2px_8px_rgba(0,122,255,0.35)]'
                      : 'bg-fill text-ink hover:bg-fill-strong'
                  }`}
                >
                  {preset} min
                </button>
              );
            })}
            <div
              className={`flex items-center gap-1.5 px-3 rounded-full ${
                PRESETS.includes(minutes) ? 'bg-fill' : 'bg-brand-soft border border-brand'
              }`}
            >
              <input
                id="goal-minutes"
                data-testid="goal-minutes-input"
                type="number"
                min={1}
                max={999}
                value={minutes}
                onChange={(event) => setMinutes(Math.max(1, parseInt(event.target.value, 10) || 1))}
                className="w-12 bg-transparent text-center text-[14px] font-semibold text-ink py-2.5 focus:outline-none"
                aria-label="Custom minutes"
              />
              <span className="text-[13px] font-medium text-ink2 pr-1.5">min</span>
            </div>
          </div>

          {estimate && (
            <div className="mt-6 rounded-[18px] bg-bg border border-sep px-5 py-4 anim-fade" key={minutes}>
              {estimate.feasible ? (
                <p className="text-[14px] text-ink leading-relaxed">
                  <span className="font-semibold text-green">Looks good.</span>{' '}
                  {remaining === 1
                    ? `This ${minutes}-minute goal covers the last chunk.`
                    : `This ${minutes}-minute goal covers all ${remaining} remaining chunks`}
                  {estimate.checkpoints > 0
                    ? `, including ${estimate.checkpoints} check-in${estimate.checkpoints === 1 ? '' : 's'}.`
                    : '.'}
                </p>
              ) : (
                <p className="text-[14px] text-ink leading-relaxed">
                  <span className="font-semibold">In {minutes} minute{minutes === 1 ? '' : 's'}</span> you'll read about{' '}
                  <span className="font-semibold">
                    {suggestedChunks} of {remaining} remaining chunk{remaining === 1 ? '' : 's'}
                  </span>{' '}
                  (~{coverPercent}% of what's left). The rest can wait for a second session.
                </p>
              )}
              {shorterThanOneChunk && (
                <p className="mt-2 text-[13px] font-medium text-red">
                  This goal is shorter than a single chunk. Pick at least {minimumMinutes} min for
                  one chunk, or read without a time limit.
                </p>
              )}
              <div className="mt-3 h-1.5 rounded-full bg-fill overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-500"
                  style={{ width: `${estimate.feasible ? 100 : coverPercent}%` }}
                />
              </div>
              <p className="mt-2 text-[12px] text-ink3">
                Based on a comfortable reading pace plus a moment for each check-in
              </p>
            </div>
          )}

          <div className="mt-7 flex flex-col gap-3">
            <PrimaryButton
              className="w-full py-4 text-[16px]"
              disabled={starting || shorterThanOneChunk}
              onClick={() => startReading(minutes)}
            >
              Start reading{starting ? '…' : ''}
            </PrimaryButton>
            <button
              type="button"
              disabled={starting}
              onClick={() => startReading(null)}
              className="w-full py-3 rounded-full text-[15px] font-medium text-ink2 hover:text-ink transition-colors disabled:opacity-40"
            >
              Read without a time limit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
