import { expect, test } from 'vitest';

import { createReferenceEncryptionOptions, REFERENCE_ENCRYPTION_KEYRING_STORAGE_KEY } from '../src/reference-encryption-keyring';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('expected result: reference encryption callbacks persist, restore, and remove session keys', () => {
  const storage = new MemoryStorage();
  const before = createReferenceEncryptionOptions(storage);

  before.onKeyGenerated?.({ keyId: '11111111-1111-4111-8111-111111111111', key: 'generated-fernet-key' });
  const afterGeneration = createReferenceEncryptionOptions(storage);

  expect(afterGeneration.keyring).toEqual({
    '11111111-1111-4111-8111-111111111111': 'generated-fernet-key',
  });

  afterGeneration.onKeyRemoved?.('11111111-1111-4111-8111-111111111111');

  expect(createReferenceEncryptionOptions(storage).keyring).toEqual({});
  expect(storage.getItem(REFERENCE_ENCRYPTION_KEYRING_STORAGE_KEY)).toBeNull();
});
