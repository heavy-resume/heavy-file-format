import { describe, expect, test, vi } from 'vitest';

import {
  deleteUnusedEmbeddedSqliteDatabase,
  findUnusedEmbeddedFiles,
  isEmbeddedSqliteDatabaseUnused,
  purgeUnusedEmbeddedFiles,
} from '../src/attachment-cleanup';
import { setAttachment } from '../src/attachments';
import { deserializeDocument } from '../src/serialization';

function documentWithComponents() {
  return deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: hvy.model-3d
---

<!--hvy: {"id":"files"}-->
#! Files

<!--hvy:image {"id":"photo","imageFile":"used.png","imageAlt":"Used"}-->

<!--hvy:plugin {"id":"model","plugin":"hvy.model-3d","pluginConfig":{"modelFile":"used.stl"}}-->
Model

<!--hvy:text {"id":"link"}-->
[Guide](@attachment:Guide)
`, '.hvy');
}

describe('embedded file cleanup', () => {
  test('before, inspect attachments, expected result: only unreferenced recognized files are reported', () => {
    const document = documentWithComponents();
    setAttachment(document, 'image:used.png', { mediaType: 'image/png' }, new Uint8Array([1]));
    setAttachment(document, 'image:unused.png', { mediaType: 'image/png' }, new Uint8Array([2]));
    setAttachment(document, 'model-3d:used.stl', { plugin: 'hvy.model-3d' }, new Uint8Array([3]));
    setAttachment(document, 'model-3d:unused.stl', { plugin: 'hvy.model-3d' }, new Uint8Array([4]));
    setAttachment(document, 'file:guide', { role: 'user-file', name: 'Guide', filename: 'guide.pdf' }, new Uint8Array([5]));
    setAttachment(document, 'file:notes', { role: 'user-file', name: 'Notes', filename: 'notes.txt' }, new Uint8Array([6]));
    setAttachment(document, 'plugin:unknown', { plugin: 'example.unknown' }, new Uint8Array([7]));
    setAttachment(document, 'db', { plugin: 'hvy.db-table' }, new Uint8Array([8]));

    const expectedResult = findUnusedEmbeddedFiles(document);

    expect(expectedResult.map((entry) => [entry.id, entry.kind])).toEqual([
      ['image:unused.png', 'image'],
      ['model-3d:unused.stl', 'model-3d'],
      ['file:notes', 'document-file'],
    ]);
  });

  test('before, purge files, tool call, expected result: host and document remove the same current set', async () => {
    const document = documentWithComponents();
    setAttachment(document, 'image:unused.png', { mediaType: 'image/png' }, new Uint8Array([1]));
    setAttachment(document, 'image:used.png', { mediaType: 'image/png' }, new Uint8Array([2]));
    const remove = vi.fn();

    const expectedResult = await purgeUnusedEmbeddedFiles(document, { list: () => [], recall: () => null, store: () => {}, remove });

    expect(expectedResult.map((entry) => entry.id)).toEqual(['image:unused.png']);
    expect(remove).toHaveBeenCalledWith('image:unused.png');
    expect(document.attachments.map((entry) => entry.id)).toEqual(['image:used.png']);
  });
});

describe('embedded SQLite cleanup', () => {
  test('before, unattached consumer, expected result: database check and delete are separate from file purge', async () => {
    const document = documentWithComponents();
    setAttachment(document, 'db', { plugin: 'hvy.db-table' }, new Uint8Array([1]));

    expect(findUnusedEmbeddedFiles(document)).toEqual([]);
    expect(isEmbeddedSqliteDatabaseUnused(document)).toBe(true);
    await expect(deleteUnusedEmbeddedSqliteDatabase(document)).resolves.toBe(true);
    expect(document.attachments).toEqual([]);
  });

  test('before, attached db-table consumer, expected result: database is retained', async () => {
    const document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: hvy.db-table
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:plugin {"id":"table","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"items"}}-->
`, '.hvy');
    setAttachment(document, 'db', { plugin: 'hvy.db-table' }, new Uint8Array([1]));

    expect(isEmbeddedSqliteDatabaseUnused(document)).toBe(false);
    await expect(deleteUnusedEmbeddedSqliteDatabase(document)).resolves.toBe(false);
    expect(document.attachments.map((entry) => entry.id)).toEqual(['db']);
  });
});
