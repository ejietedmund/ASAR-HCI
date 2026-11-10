import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePreferences } from '../hooks/usePreferences.js';
import { onStorageFailure } from '../storage/db.js';

export const SCREENS = {
  IMPORT: 'IMPORT',
  READING: 'READING',
  GOAL_PLANNER: 'GOAL_PLANNER',
  SETTINGS: 'SETTINGS',
  SUMMARY: 'SUMMARY',
};

const STORAGE_WARNING =
  'Storage is unavailable on this device, so your progress cannot be saved. The reading session will still work.';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [screen, setScreen] = useState(SCREENS.IMPORT);
  const [payload, setPayload] = useState({});
  const [activeDocument, setActiveDocument] = useState(null);
  const [storageWarning, setStorageWarning] = useState(null);
  const { preferences, updatePreferences } = usePreferences();

  useEffect(() => {
    const unsubscribe = onStorageFailure(() => setStorageWarning(STORAGE_WARNING));
    return unsubscribe;
  }, []);

  const navigate = useCallback((nextScreen, data = {}) => {
    setPayload(data);
    setScreen(nextScreen);
    if (data && data.document) {
      setActiveDocument(data.document);
    }
    if (typeof window !== 'undefined' && window.scrollTo) {
      window.scrollTo({ top: 0 });
    }
  }, []);

  const value = useMemo(
    () => ({ screen, payload, navigate, preferences, updatePreferences, activeDocument, storageWarning }),
    [screen, payload, navigate, preferences, updatePreferences, activeDocument, storageWarning]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used inside an AppProvider');
  }
  return context;
}
