const DATABASE_NAME = 'hvy-reference-session-v1';
const DATABASE_VERSION = 2;
const TAIL_STORE_NAME = 'attachment-tails';
const LEASE_STORE_NAME = 'session-leases';
const SESSION_ID_KEY = 'hvy-recovery-session-id-v1';
const SESSION_KEY_KEY = 'hvy-recovery-encryption-key-v1';
const HEARTBEAT_INTERVAL_MS = 30_000;
export const RECOVERY_SESSION_STALE_MS = 48 * 60 * 60 * 1000;

interface EncryptedTailRecord {
  sessionId: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  updatedAt: number;
}

interface RecoveryLease {
  sessionId: string;
  lastHeartbeat: number;
}

interface RecoveryCredentials {
  sessionId: string;
  key: CryptoKey;
}

let heartbeatStarted = false;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(TAIL_STORE_NAME)) {
        // Version 1 records were plaintext. They cannot be retained after encryption is introduced.
        request.transaction?.objectStore(TAIL_STORE_NAME).clear();
      } else {
        database.createObjectStore(TAIL_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(LEASE_STORE_NAME)) {
        database.createObjectStore(LEASE_STORE_NAME, { keyPath: 'sessionId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open attachment recovery storage.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

async function getCredentials(): Promise<RecoveryCredentials> {
  if (typeof sessionStorage === 'undefined' || !globalThis.crypto?.subtle) {
    throw new Error('Encrypted attachment recovery is unavailable.');
  }
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  let encodedKey = sessionStorage.getItem(SESSION_KEY_KEY);
  if (!sessionId || !encodedKey) {
    sessionId = crypto.randomUUID();
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    encodedKey = bytesToBase64(rawKey);
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    sessionStorage.setItem(SESSION_KEY_KEY, encodedKey);
  }
  return {
    sessionId,
    key: await crypto.subtle.importKey('raw', toArrayBuffer(base64ToBytes(encodedKey)), 'AES-GCM', false, ['encrypt', 'decrypt']),
  };
}

function additionalData(storageKey: string, sessionId: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(`hvy-recovery-v1\n${sessionId}\n${storageKey}`));
}

export async function initializeSessionAttachmentRecovery(): Promise<void> {
  await refreshRecoveryLease();
  await deleteExpiredRecoverySessions();
  if (heartbeatStarted || typeof window === 'undefined') return;
  heartbeatStarted = true;
  window.setInterval(() => void refreshRecoveryLease().catch(() => {}), HEARTBEAT_INTERVAL_MS);
  window.addEventListener('focus', () => void refreshRecoveryLease().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshRecoveryLease().catch(() => {});
  });
}

export async function storeSessionAttachmentTail(storageKey: string, bytes: Uint8Array): Promise<void> {
  const credentials = await getCredentials();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: additionalData(storageKey, credentials.sessionId) },
    credentials.key,
    toArrayBuffer(bytes)
  );
  const database = await openDatabase();
  try {
    const transaction = database.transaction([TAIL_STORE_NAME, LEASE_STORE_NAME], 'readwrite');
    transaction.objectStore(TAIL_STORE_NAME).put({
      sessionId: credentials.sessionId,
      iv: toArrayBuffer(iv),
      ciphertext,
      updatedAt: Date.now(),
    } satisfies EncryptedTailRecord, storageKey);
    transaction.objectStore(LEASE_STORE_NAME).put({
      sessionId: credentials.sessionId,
      lastHeartbeat: Date.now(),
    } satisfies RecoveryLease);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadSessionAttachmentTail(storageKey: string): Promise<Uint8Array | null> {
  const credentials = await getCredentials();
  const database = await openDatabase();
  try {
    const transaction = database.transaction(TAIL_STORE_NAME, 'readonly');
    const record = await requestResult(transaction.objectStore(TAIL_STORE_NAME).get(storageKey)) as EncryptedTailRecord | undefined;
    if (!record || record.sessionId !== credentials.sessionId) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv, additionalData: additionalData(storageKey, credentials.sessionId) },
      credentials.key,
      record.ciphertext
    );
    return new Uint8Array(plaintext);
  } finally {
    database.close();
  }
}

export async function removeSessionAttachmentTail(storageKey: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(TAIL_STORE_NAME, 'readwrite');
    transaction.objectStore(TAIL_STORE_NAME).delete(storageKey);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

async function refreshRecoveryLease(): Promise<void> {
  const { sessionId } = await getCredentials();
  const database = await openDatabase();
  try {
    const transaction = database.transaction(LEASE_STORE_NAME, 'readwrite');
    transaction.objectStore(LEASE_STORE_NAME).put({ sessionId, lastHeartbeat: Date.now() } satisfies RecoveryLease);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

async function deleteExpiredRecoverySessions(now = Date.now()): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([TAIL_STORE_NAME, LEASE_STORE_NAME], 'readwrite');
    const leases = await requestResult(transaction.objectStore(LEASE_STORE_NAME).getAll()) as RecoveryLease[];
    const expiredSessionIds = new Set(
      leases.filter((lease) => now - lease.lastHeartbeat >= RECOVERY_SESSION_STALE_MS).map((lease) => lease.sessionId)
    );
    if (expiredSessionIds.size > 0) {
      const tailStore = transaction.objectStore(TAIL_STORE_NAME);
      await new Promise<void>((resolve, reject) => {
        const cursorRequest = tailStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve();
            return;
          }
          const record = cursor.value as Partial<EncryptedTailRecord>;
          if (typeof record.sessionId === 'string' && expiredSessionIds.has(record.sessionId)) cursor.delete();
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Recovery cleanup failed.'));
      });
      const leaseStore = transaction.objectStore(LEASE_STORE_NAME);
      expiredSessionIds.forEach((sessionId) => leaseStore.delete(sessionId));
    }
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
