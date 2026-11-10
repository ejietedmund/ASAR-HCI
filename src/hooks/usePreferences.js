import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, getPreferences, savePreferences } from '../storage/db.js';

export function usePreferences() {
  const [preferences, setPreferences] = useState({
    textSize: DEFAULT_PREFERENCES.textSize,
    contrast: DEFAULT_PREFERENCES.contrast,
    checkpointFrequency: DEFAULT_PREFERENCES.checkpointFrequency,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await getPreferences();
      if (!alive || !stored) return;
      setPreferences({
        textSize: stored.textSize || DEFAULT_PREFERENCES.textSize,
        contrast: stored.contrast || DEFAULT_PREFERENCES.contrast,
        checkpointFrequency: Number(stored.checkpointFrequency) || DEFAULT_PREFERENCES.checkpointFrequency,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const updatePreferences = useCallback(async (next) => {
    const merged = { ...DEFAULT_PREFERENCES, ...next };
    setPreferences({
      textSize: merged.textSize,
      contrast: merged.contrast,
      checkpointFrequency: Number(merged.checkpointFrequency),
    });
    await savePreferences(merged);
    return merged;
  }, []);

  return { preferences, updatePreferences };
}
