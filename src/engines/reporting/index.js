function countAnnotations(annotations, type) {
  return annotations.filter((annotation) => annotation && annotation.type === type).length;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function buildReport({ logs = [], annotations = [], chunks = [], pacingChanges = 0, startedAt = 0, endedAt = 0 } = {}) {
  const validLogs = logs.filter(Boolean);
  const totalChunks = chunks.length;
  const chunkIndexes = new Set(validLogs.map((log) => log.chunkIndex));
  const chunksCompleted = chunkIndexes.size;

  const totalMs = validLogs.reduce((sum, log) => sum + (Number(log.timeSpent) || 0), 0);
  const avgTimePerChunk = validLogs.length ? roundTo(totalMs / validLogs.length / 1000, 1) : 0;

  const checkpointLogs = validLogs.filter((log) => log.checkpointResponseTime !== null && log.checkpointResponseTime !== undefined);
  const checkpointsTotal = checkpointLogs.length;
  const checkpointsAnswered = checkpointLogs.filter((log) => (log.checkpointResponse || '').trim() !== '').length;

  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt > startedAt
      ? endedAt - startedAt
      : 0;

  const report = {
    empty: chunksCompleted === 0 && checkpointsAnswered === 0,
    chunksCompleted,
    totalChunks,
    completionPercent: totalChunks ? Math.round((chunksCompleted / totalChunks) * 100) : 0,
    avgTimePerChunk,
    checkpointsAnswered,
    checkpointsTotal,
    chunksMarkedConfusing: countAnnotations(annotations, 'confusing'),
    chunksMarkedImportant: countAnnotations(annotations, 'important'),
    pacingChanges: pacingChanges || 0,
    sessionDuration: roundTo(durationMs / 60000, 1),
  };

  return report;
}
