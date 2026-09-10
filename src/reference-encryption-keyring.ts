import type { HvyEncryptionOptions } from './encryption';

export const REFERENCE_ENCRYPTION_KEYRING_STORAGE_KEY = 'hvy-reference-encryption-keyring-v1';

interface StoredReferenceEncryptionKeyring {
  version: 1;
  keys: Record<string, string>;
}

export function createReferenceEncryptionOptions(storage: Storage = window.sessionStorage): HvyEncryptionOptions {
  const keyring = loadReferenceEncryptionKeyring(storage);
  return {
    keyring,
    onKeyGenerated({ keyId, key }) {
      keyring[keyId] = key;
      saveReferenceEncryptionKeyring(storage, keyring);
    },
    onKeyRemoved(keyId) {
      delete keyring[keyId];
      saveReferenceEncryptionKeyring(storage, keyring);
    },
  };
}

function loadReferenceEncryptionKeyring(storage: Storage): Record<string, string> {
  try {
    const raw = storage.getItem(REFERENCE_ENCRYPTION_KEYRING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<StoredReferenceEncryptionKeyring> | null;
    if (!parsed || parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== 'object' || Array.isArray(parsed.keys)) {
      return {};
    }
    return Object.fromEntries(Object.entries(parsed.keys).filter(([keyId, key]) => keyId.trim().length > 0 && typeof key === 'string' && key.trim().length > 0));
  } catch {
    return {};
  }
}

function saveReferenceEncryptionKeyring(storage: Storage, keyring: Record<string, string>): void {
  const keys = Object.fromEntries(Object.entries(keyring).filter(([keyId, key]) => keyId.trim().length > 0 && key.trim().length > 0));
  if (Object.keys(keys).length === 0) {
    storage.removeItem(REFERENCE_ENCRYPTION_KEYRING_STORAGE_KEY);
    return;
  }
  storage.setItem(REFERENCE_ENCRYPTION_KEYRING_STORAGE_KEY, JSON.stringify({ version: 1, keys } satisfies StoredReferenceEncryptionKeyring));
}
