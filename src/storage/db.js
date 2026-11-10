import { openDB } from 'idb';

const DB_NAME = 'AcademicReader';
const DB_VERSION = 1;

export const DEFAULT_PREFERENCES = {
  id: 'singleton',
  textSize: 'medium',
  contrast: 'standard',
  checkpointFrequency: 5,
  savedAt: null,
};

let dbPromise = null;
let storageAvailable = true;
const failureListeners = [];

export function isStorageAvailable() {
  return storageAvailable;
}

export function onStorageFailure(listener) {
  failureListeners.push(listener);
  return () => {
    const i = failureListeners.indexOf(listener);
    if (i >= 0) failureListeners.splice(i, 1);
  };
}

function reportFailure(error) {
  if (storageAvailable) {
    storageAvailable = false;
    failureListeners.forEach((listener) => {
      try {
        listener(error);
      } catch (err) {
        /* listener errors are ignored */
      }
    });
  }
  return null;
}

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('chunks')) {
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
          chunks.createIndex('documentId', 'documentId');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          sessions.createIndex('documentId', 'documentId');
        }
        if (!db.objectStoreNames.contains('engagementLogs')) {
          const logs = db.createObjectStore('engagementLogs', { keyPath: 'id', autoIncrement: true });
          logs.createIndex('sessionId', 'sessionId');
        }
        if (!db.objectStoreNames.contains('annotations')) {
          const annotations = db.createObjectStore('annotations', { keyPath: 'id', autoIncrement: true });
          annotations.createIndex('documentId', 'documentId');
          annotations.createIndex('chunkId', 'chunkId');
        }
        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

async function safe(run, fallback) {
  try {
    const db = await getDB();
    return await run(db);
  } catch (error) {
    reportFailure(error);
    return fallback;
  }
}

export async function saveDocument(data) {
  return safe(async (db) => {
    const record = {
      fileName: data.fileName,
      fileType: data.fileType,
      uploadedAt: data.uploadedAt || Date.now(),
      lastChunkIndex: data.lastChunkIndex || 0,
    };
    return db.add('documents', record);
  }, null);
}

export async function getDocuments() {
  return safe(async (db) => {
    const rows = await db.getAll('documents');
    return rows.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  }, []);
}

export async function getDocument(docDbId) {
  return safe(async (db) => db.get('documents', docDbId), null);
}

export async function updateDocumentPosition(docDbId, chunkIndex) {
  return safe(async (db) => {
    if (docDbId === null || docDbId === undefined) return null;
    const record = await db.get('documents', docDbId);
    if (!record) return null;
    record.lastChunkIndex = chunkIndex;
    await db.put('documents', record);
    return record;
  }, null);
}

export async function saveChunks(chunks) {
  return safe(async (db) => {
    const tx = db.transaction('chunks', 'readwrite');
    for (const chunk of chunks) {
      tx.store.put(chunk);
    }
    await tx.done;
    return true;
  }, null);
}

export async function getChunksForDocument(documentId) {
  return safe(async (db) => {
    const rows = await db.getAllFromIndex('chunks', 'documentId', documentId);
    return rows.sort((a, b) => a.index - b.index);
  }, []);
}

export async function countChunksForDocument(documentId) {
  return safe(async (db) => db.countFromIndex('chunks', 'documentId', documentId), 0);
}

export async function createSession({ documentId, startedAt }) {
  return safe(async (db) => {
    const id = await db.add('sessions', {
      documentId,
      startedAt: startedAt || Date.now(),
      endedAt: null,
      completed: false,
      lastChunkIndex: 0,
    });
    return id;
  }, null);
}

export async function endSession(sessionId, patch) {
  return safe(async (db) => {
    if (sessionId === null || sessionId === undefined) return null;
    const record = await db.get('sessions', sessionId);
    if (!record) return null;
    Object.assign(record, patch);
    await db.put('sessions', record);
    return record;
  }, null);
}

export async function logEngagement(entry) {
  return safe(async (db) => db.add('engagementLogs', entry), null);
}

export async function getEngagementForSession(sessionId) {
  return safe(async (db) => db.getAllFromIndex('engagementLogs', 'sessionId', sessionId), []);
}

export async function saveAnnotation(annotation) {
  return safe(async (db) => {
    const record = { ...annotation, createdAt: annotation.createdAt || Date.now() };
    const id = await db.add('annotations', record);
    return id;
  }, null);
}

export async function getAnnotationsForDocument(documentId) {
  return safe(async (db) => db.getAllFromIndex('annotations', 'documentId', documentId), []);
}

export async function getPreferences() {
  return safe(async (db) => {
    const stored = await db.get('preferences', 'singleton');
    if (!stored) {
      await db.put('preferences', { ...DEFAULT_PREFERENCES });
      return { ...DEFAULT_PREFERENCES };
    }
    return { ...DEFAULT_PREFERENCES, ...stored };
  }, { ...DEFAULT_PREFERENCES });
}

export async function savePreferences(preferences) {
  return safe(async (db) => {
    const record = { ...DEFAULT_PREFERENCES, ...preferences, id: 'singleton', savedAt: Date.now() };
    await db.put('preferences', record);
    return record;
  }, null);
}
