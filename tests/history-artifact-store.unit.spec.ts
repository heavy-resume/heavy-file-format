import { expect, test } from 'vitest';

import {
  InMemoryHvyHistoryArtifactStore,
  recallHvyHistoryArtifact,
  storeHvyHistoryArtifact,
  type HvyHistoryArtifactStore,
} from '../src/history-artifact-store';

test('history artifact store preserves exact bytes and removes released artifacts', async () => {
  const store = new InMemoryHvyHistoryArtifactStore();

  // BEFORE
  expect(store.size).toBe(0);

  // TOOL CALL
  const reference = await storeHvyHistoryArtifact(store, {
    kind: 'sqlite-checkpoint',
    bytes: new Uint8Array([0, 1, 127, 255]),
    reason: 'expected result',
    namespace: 'document-test',
  });

  // AFTER
  expect(await recallHvyHistoryArtifact(store, reference)).toEqual(new Uint8Array([0, 1, 127, 255]));
  expect(store.size).toBe(1);
  await store.remove(reference.id);
  expect(store.size).toBe(0);
});

test('history artifact recall rejects missing, truncated, and corrupted bytes', async () => {
  let storedBytes = new Uint8Array();
  const store: HvyHistoryArtifactStore = {
    put: async ({ bytes }) => {
      storedBytes = Uint8Array.from(bytes);
      return { id: 'artifact' };
    },
    get: async () => Uint8Array.from(storedBytes),
    remove: async () => {},
  };
  const reference = await storeHvyHistoryArtifact(store, {
    kind: 'sqlite-checkpoint',
    bytes: new Uint8Array([10, 20, 30]),
    reason: 'expected result',
    namespace: 'document-test',
  });

  storedBytes = new Uint8Array([10, 20]);
  await expect(recallHvyHistoryArtifact(store, reference)).rejects.toThrow(/unexpected length/u);
  storedBytes = new Uint8Array([10, 20, 31]);
  await expect(recallHvyHistoryArtifact(store, reference)).rejects.toThrow(/integrity check/u);
  store.get = async () => null;
  await expect(recallHvyHistoryArtifact(store, reference)).rejects.toThrow(/unavailable/u);
});

test('history artifact storage failure does not produce a reference', async () => {
  const store: HvyHistoryArtifactStore = {
    put: async () => { throw new Error('storage unavailable'); },
    get: async () => null,
    remove: async () => {},
  };

  await expect(storeHvyHistoryArtifact(store, {
    kind: 'sqlite-checkpoint',
    bytes: new Uint8Array([1]),
    reason: 'expected result',
    namespace: 'document-test',
  })).rejects.toThrow('storage unavailable');
});
