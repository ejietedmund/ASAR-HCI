export const READING_SPEED_WPM = 200;

export function expectedReadingTime(wordCount) {
  const words = Number.isFinite(wordCount) ? Math.max(0, wordCount) : 0;
  return Math.max(10, (words / READING_SPEED_WPM) * 60);
}

export function capTimeSpent(elapsedMs, wordCount) {
  const expected = expectedReadingTime(wordCount) * 1000;
  return Math.min(Math.max(0, elapsedMs), expected * 3);
}

export function createChunkTimer() {
  let accumulated = 0;
  let startedAt = Date.now();
  let running = false;
  let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const now = () => Date.now();

  const current = () => (running && !hidden ? accumulated + (now() - startedAt) : accumulated);

  const onVisibilityChange = () => {
    const isHidden = document.visibilityState === 'hidden';
    if (isHidden) {
      if (running && !hidden) accumulated += now() - startedAt;
      hidden = true;
    } else {
      hidden = false;
      if (running) startedAt = now();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    start() {
      if (running) return;
      running = true;
      hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      startedAt = now();
    },
    pause() {
      if (running && !hidden) accumulated += now() - startedAt;
      running = false;
    },
    elapsed() {
      return current();
    },
    stop() {
      const total = current();
      running = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      return total;
    },
  };
}
