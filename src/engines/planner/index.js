export const READING_SPEED_WPM = 200;
export const CHECKPOINT_OVERHEAD_SECONDS = 90;
export const DEFAULT_WORDS_PER_CHUNK = 250;

function readingSecondsForWords(words) {
  return (words / READING_SPEED_WPM) * 60;
}

function wordsInChunks(chunks, count) {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  let total = 0;
  const limit = Math.min(count, chunks.length);
  for (let i = 0; i < limit; i += 1) {
    total += Number(chunks[i].wordCount) || 0;
  }
  return total;
}

export function evaluateGoal({ targetChunks, availableMinutes, chunks = null, frequency = 5 }) {
  const target = Math.max(0, Math.floor(Number(targetChunks) || 0));
  const minutes = Math.max(0, Number(availableMinutes) || 0);
  const checkpointFrequency = Math.max(1, Math.floor(Number(frequency) || 5));
  const budgetSeconds = minutes * 60;

  const totalWords =
    wordsInChunks(chunks, target) !== null
      ? wordsInChunks(chunks, target)
      : target * DEFAULT_WORDS_PER_CHUNK;

  const readingSeconds = readingSecondsForWords(totalWords);
  const checkpoints = Math.floor(target / checkpointFrequency);
  const estimatedSeconds = readingSeconds + checkpoints * CHECKPOINT_OVERHEAD_SECONDS;
  const feasible = estimatedSeconds <= budgetSeconds;

  let suggestedChunks = 0;
  let spent = 0;
  for (let i = 0; i < target; i += 1) {
    const wordCount =
      Array.isArray(chunks) && chunks[i]
        ? Number(chunks[i].wordCount) || 0
        : DEFAULT_WORDS_PER_CHUNK;
    const checkpointCost = (i + 1) % checkpointFrequency === 0 ? CHECKPOINT_OVERHEAD_SECONDS : 0;
    const cost = readingSecondsForWords(wordCount) + checkpointCost;
    if (spent + cost <= budgetSeconds) {
      spent += cost;
      suggestedChunks += 1;
    } else {
      break;
    }
  }

  const planText =
    suggestedChunks > 0
      ? `Read ${suggestedChunks} chunks now, then finish the rest in a second session.`
      : `Your ${minutes}-minute window is shorter than a single chunk. Try a longer window, then finish the rest in a second session.`;

  return {
    targetChunks: target,
    availableMinutes: minutes,
    estimatedSeconds,
    estimatedMinutes: Math.round((estimatedSeconds / 60) * 10) / 10,
    readingSeconds,
    checkpoints,
    budgetSeconds,
    feasible,
    suggestedChunks,
    planText,
  };
}
