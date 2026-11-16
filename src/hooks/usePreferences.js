import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PREFERENCES, getPreferences, savePreferences } from '../storage/db.js';

function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyThemeToDocument(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const color = theme === 'dark' ? '#000000' : '#f2f2f7';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

export function usePreferences() {
  const [preferences, setPreferences] = useState({
    textSize: DEFAULT_PREFERENCES.textSize,
    theme: DEFAULT_PREFERENCES.theme,
    readingFont: DEFAULT_PREFERENCES.readingFont,
    checkpointFrequency: DEFAULT_PREFERENCES.checkpointFrequency,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await getPreferences();
      if (!alive || !stored) return;
      setPreferences({
        textSize: stored.textSize || DEFAULT_PREFERENCES.textSize,
        theme: stored.theme || DEFAULT_PREFERENCES.theme,
        readingFont: stored.readingFont || DEFAULT_PREFERENCES.readingFont,
        checkpointFrequency:
          Number(stored.checkpointFrequency) || DEFAULT_PREFERENCES.checkpointFrequency,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const apply = () => applyThemeToDocument(resolveTheme(preferences.theme));
    apply();
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (preferences.theme === 'system') apply();
    };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
    return () => {
      if (query.removeEventListener) query.removeEventListener('change', onChange);
      else if (query.removeListener) query.removeListener(onChange);
    };
  }, [preferences.theme]);

  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  const updatePreferences = useCallback(async (next) => {
    const merged = { ...DEFAULT_PREFERENCES, ...preferencesRef.current, ...next };
    setPreferences({
      textSize: merged.textSize,
      theme: merged.theme,
      readingFont: merged.readingFont,
      checkpointFrequency: Number(merged.checkpointFrequency),
    });
    await savePreferences(merged);
    return merged;
  }, []);

  return { preferences, updatePreferences };
}
