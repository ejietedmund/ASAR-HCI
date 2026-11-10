import { useState } from 'react';
import { evaluateGoal } from '../../engines/planner/index.js';
import { useApp } from '../../state/appState.jsx';

export default function GoalPlannerScreen() {
  const { preferences, activeDocument } = useApp();
  const [targetChunks, setTargetChunks] = useState(10);
  const [availableMinutes, setAvailableMinutes] = useState(30);
  const [result, setResult] = useState(null);

  const frequency = Number(preferences.checkpointFrequency) || 5;
  const chunks = activeDocument?.chunks || null;

  const buildResult = (target, minutes) =>
    evaluateGoal({ targetChunks: target, availableMinutes: minutes, chunks, frequency });

  const checkGoal = () => {
    const target = Math.max(1, parseInt(targetChunks, 10) || 0);
    const minutes = Math.max(1, parseInt(availableMinutes, 10) || 0);
    setTargetChunks(target);
    setAvailableMinutes(minutes);
    setResult(buildResult(target, minutes));
  };

  const acceptPlan = () => {
    if (!result || !result.suggestedChunks) return;
    const nextTarget = Math.max(1, result.suggestedChunks);
    setTargetChunks(nextTarget);
    setResult(buildResult(nextTarget, availableMinutes));
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="grid md:grid-cols-2 gap-6 items-start">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-[#1a2340]">Set a reading goal</h1>
          <p className="mt-2 text-slate-500">
            Pick how many chunks you want to read and how much time you have. We will check whether
            the plan is realistic.
          </p>

          <label className="block mt-6 text-sm font-medium text-slate-600" htmlFor="goal-chunks">
            Chunks to read
          </label>
          <input
            id="goal-chunks"
            type="number"
            min={1}
            max={999}
            value={targetChunks}
            onChange={(event) => setTargetChunks(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-[#1a2340] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100"
          />

          <label className="block mt-4 text-sm font-medium text-slate-600" htmlFor="goal-minutes">
            Minutes available
          </label>
          <input
            id="goal-minutes"
            type="number"
            min={1}
            max={999}
            value={availableMinutes}
            onChange={(event) => setAvailableMinutes(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-[#1a2340] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100"
          />

          <button
            type="button"
            onClick={checkGoal}
            className="mt-6 w-full sm:w-auto px-6 py-3 rounded-xl bg-[#1e3a8a] hover:bg-[#1e40af] text-white text-sm font-medium transition-colors"
          >
            Check my goal
          </button>
        </div>

        {result && result.feasible && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
            <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-3 py-1 rounded-full">
              Looks good
            </span>
            <p className="mt-4 text-[#1a2340] leading-relaxed">
              Your goal of <span className="font-semibold">{result.targetChunks} chunks</span> in{' '}
              <span className="font-semibold">{result.availableMinutes} minutes</span> is doable.
            </p>
            <p className="mt-2 text-slate-500 leading-relaxed">
              At 200 words per minute plus {result.checkpoints} check-in
              {result.checkpoints === 1 ? '' : 's'}, it should take about{' '}
              <span className="font-medium text-[#1a2340]">{result.estimatedMinutes} minutes</span> —
              comfortably inside your {result.availableMinutes}-minute window.
            </p>
            <div className="mt-5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">
              Reading time {Math.round(result.readingSeconds / 60)} min · checkpoint time{' '}
              {Math.round((result.checkpoints * 90) / 60)} min
            </div>
          </div>
        )}

        {result && !result.feasible && (
          <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-2xl p-6 sm:p-8">
            <span className="inline-block bg-amber-200 text-amber-800 text-xs font-semibold px-3 py-1 rounded-full">
              Needs adjusting
            </span>
            <p className="mt-4 text-[#1a2340] leading-relaxed">
              Reading {result.targetChunks} chunks would take about{' '}
              <span className="font-semibold">{result.estimatedMinutes} minutes</span>, which is more
              than the {result.availableMinutes} minutes you have.
            </p>

            <div className="mt-4 bg-white rounded-xl border border-white shadow-sm px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Suggested plan
              </p>
              <p className="mt-2 text-[#1a2340] leading-relaxed">{result.planText}</p>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={acceptPlan}
                disabled={!result.suggestedChunks}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  result.suggestedChunks
                    ? 'bg-[#1e3a8a] hover:bg-[#1e40af] text-white'
                    : 'bg-white/60 text-amber-800 cursor-not-allowed'
                }`}
              >
                Accept plan
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="px-5 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-medium text-[#1a2340] hover:bg-amber-50 transition-colors"
              >
                Keep my goal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
