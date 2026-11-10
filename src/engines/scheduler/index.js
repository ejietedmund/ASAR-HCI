const RISING_TIME_WINDOW = 3;
const RISING_TIME_RATIO = 1.5;
const SKIPPED_WINDOW = 3;
const SKIPPED_REQUIRED = 2;
const FAST_ANSWER_MS = 5000;
const NAV_WINDOW = 6;
const BACKWARD_REQUIRED = 2;
export const SIGNALS_REQUIRED = 2;

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function risingTimeSignal(chunkTimes) {
  if (!Array.isArray(chunkTimes) || chunkTimes.length < RISING_TIME_WINDOW * 2) return false;
  const first = chunkTimes.slice(0, RISING_TIME_WINDOW);
  const last = chunkTimes.slice(-RISING_TIME_WINDOW);
  const baseline = average(first);
  if (baseline <= 0) return false;
  return average(last) > baseline * RISING_TIME_RATIO;
}

export function skippedCheckpointsSignal(checkpointEvents) {
  if (!Array.isArray(checkpointEvents) || checkpointEvents.length < SKIPPED_WINDOW) return false;
  const recent = checkpointEvents.slice(-SKIPPED_WINDOW);
  const skipped = recent.filter((event) => {
    const response = (event.response || '').trim();
    const fast = event.responseTime !== null && event.responseTime !== undefined && event.responseTime < FAST_ANSWER_MS;
    return event.skipped === true || response === '' || fast;
  });
  return skipped.length >= SKIPPED_REQUIRED;
}

export function backwardNavigationSignal(navigationEvents) {
  if (!Array.isArray(navigationEvents)) return false;
  const recent = navigationEvents.slice(-NAV_WINDOW);
  const backward = recent.filter((direction) => direction === 'backward');
  return backward.length >= BACKWARD_REQUIRED;
}

export function detectFatigue({ chunkTimes = [], checkpointEvents = [], navigationEvents = [] } = {}) {
  const signals = {
    risingTime: risingTimeSignal(chunkTimes),
    skippedCheckpoints: skippedCheckpointsSignal(checkpointEvents),
    backwardNavigation: backwardNavigationSignal(navigationEvents),
  };
  const count = Object.values(signals).filter(Boolean).length;
  return { signals, count, detected: count >= SIGNALS_REQUIRED };
}
