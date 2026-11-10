import { expectedReadingTime } from '../engagement/index.js';

export const SKIM_THRESHOLD = 0.3;
export const SKIM_STREAK_REQUIRED = 3;
export const MIN_CHECKPOINT_FREQUENCY = 3;

export function isSkimming(elapsedMs, wordCount) {
  const expected = expectedReadingTime(wordCount);
  return elapsedMs / 1000 < expected * SKIM_THRESHOLD;
}

export function applyPacing(state, elapsedMs, wordCount) {
  const current = {
    streak: state.streak || 0,
    frequency: state.frequency || 5,
    changes: state.changes || 0,
  };
  const skimming = isSkimming(elapsedMs, wordCount);
  const streak = skimming ? current.streak + 1 : 0;

  if (streak >= SKIM_STREAK_REQUIRED) {
    return {
      streak: 0,
      frequency: Math.max(MIN_CHECKPOINT_FREQUENCY, current.frequency - 2),
      changes: current.changes + 1,
      wasSkimming: skimming,
      tightened: true,
    };
  }

  return {
    streak,
    frequency: current.frequency,
    changes: current.changes,
    wasSkimming: skimming,
    tightened: false,
  };
}
