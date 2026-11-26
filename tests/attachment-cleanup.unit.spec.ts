import { describe, expect, test, vi } from 'vitest';

import {
  clearCachedEmbeddedFileUsage,
  deleteUnusedEmbeddedSqliteDatabase,
  findUnusedEmbeddedFiles,
  getCachedEmbeddedFileUsage,
  getEmbeddedFileUsage,
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

describe('embedded file usage', () => {
  test('before, template blocks without text, expected result: usage reads them as empty text and leaves them unchanged', () => {
    const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-grid
    baseType: grid
    template:
      id: fake-grid
      schema:
        component: grid
        gridColumns: 3
        gridItems:
          - id: fake-cell
            block:
              id: fake-image
              schema:
                component: image
                imageFile: fake-template.png
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section
`, '.hvy');
    setAttachment(document, 'image:fake-template.png', { mediaType: 'image/png' }, new Uint8Array([1]));
    const templateBefore = JSON.stringify(document.meta.component_defs);

    const expectedResult = getEmbeddedFileUsage(document);

    expect(expectedResult.unused).toEqual([]);
    expect(expectedResult.referenceCounts.get('image:fake-template.png')).toBe(1);
    expect(JSON.stringify(document.meta.component_defs)).toBe(templateBefore);
  });

  test('before, a file linked twice, expected result: one pass counts each link', () => {
    const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:text {}-->
[Fake guide](@attachment:Fake%20Guide) and [again](@attachment:Fake%20Guide)
`, '.hvy');
    setAttachment(document, 'file:fake-guide', { role: 'user-file', name: 'Fake Guide', filename: 'fake-guide.pdf' }, new Uint8Array([1]));
    setAttachment(document, 'file:fake-notes', { role: 'user-file', name: 'Fake Notes', filename: 'fake-notes.txt' }, new Uint8Array([2]));

    const expectedResult = getEmbeddedFileUsage(document);

    expect(expectedResult.referenceCounts.get('file:fake-guide')).toBe(2);
    expect(expectedResult.referenceCounts.has('file:fake-notes')).toBe(false);
    expect(expectedResult.unused.map((entry) => entry.id)).toEqual(['file:fake-notes']);
  });

  test('before, cached usage, expected result: reused until attachments, templates, or the document are replaced', () => {
    clearCachedEmbeddedFileUsage();
    const document = documentWithComponents();
    setAttachment(document, 'image:unused.png', { mediaType: 'image/png' }, new Uint8Array([1]));
    const firstUsage = getCachedEmbeddedFileUsage(document);

    expect(getCachedEmbeddedFileUsage(document)).toBe(firstUsage);

    setAttachment(document, 'image:another-unused.png', { mediaType: 'image/png' }, new Uint8Array([2]));
    const afterAttachmentChange = getCachedEmbeddedFileUsage(document);
    expect(afterAttachmentChange).not.toBe(firstUsage);
    expect(afterAttachmentChange.unused.map((entry) => entry.id)).toEqual(['image:unused.png', 'image:another-unused.png']);

    document.meta.component_defs = [];
    const afterTemplateChange = getCachedEmbeddedFileUsage(document);
    expect(afterTemplateChange).not.toBe(afterAttachmentChange);

    const replacedDocument = documentWithComponents();
    const afterDocumentReplaced = getCachedEmbeddedFileUsage(replacedDocument);
    expect(afterDocumentReplaced).not.toBe(afterTemplateChange);

    clearCachedEmbeddedFileUsage();
    expect(getCachedEmbeddedFileUsage(replacedDocument)).not.toBe(afterDocumentReplaced);
  });
});
