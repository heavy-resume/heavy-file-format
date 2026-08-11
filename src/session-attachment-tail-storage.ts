const DATABASE_NAME = 'hvy-reference-session-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'attachment-tails';

function openAttachmentTailDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open attachment session storage.'));
  });
}

export async function storeSessionAttachmentTail(key: string, bytes: Uint8Array): Promise<void> {
  const database = await openAttachmentTailDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(bytes, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not store attachment session bytes.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Attachment session storage was aborted.'));
    });
  } finally {
    database.close();
  }
}

export async function loadSessionAttachmentTail(key: string): Promise<Uint8Array | null> {
  const database = await openAttachmentTailDatabase();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        const value = request.result;
        if (value instanceof Uint8Array) {
          resolve(value);
          return;
        }
        if (value instanceof ArrayBuffer) {
          resolve(new Uint8Array(value));
          return;
        }
        resolve(null);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not load attachment session bytes.'));
    });
  } finally {
    database.close();
  }
}

export async function removeSessionAttachmentTail(key: string): Promise<void> {
  const database = await openAttachmentTailDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove attachment session bytes.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Attachment session removal was aborted.'));
    });
  } finally {
    database.close();
  }
}
