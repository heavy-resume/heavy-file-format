import { expect, test } from '@playwright/test';

test('hosted database descriptor recalls SQLite bytes before doc.db initialization', async ({ page }) => {
  await page.goto('/');

  const expectedResult = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const [{ deserializeDocumentBytes, mountHvy }, { getAttachment }, { createScriptingDbRuntime }] = await Promise.all([
      import('/src/embed-full.ts'),
      import('/src/attachments.ts'),
      import('/src/plugins/db-table.ts'),
    ]);
    const encoder = new TextEncoder();
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"records"}-->
#! Records
`;
    const databaseDocument = deserializeDocumentBytes(encoder.encode(source), '.hvy');
    const writer = await createScriptingDbRuntime(databaseDocument);
    writer.api.execute('CREATE TABLE records (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
    writer.api.execute('INSERT INTO records (title) VALUES (?)', ['Persisted row']);
    writer.dispose();
    const databaseAttachment = getAttachment(databaseDocument, 'db');
    if (!databaseAttachment) throw new Error('Database fixture attachment was not created.');

    let recallCount = 0;
    const recalledIds: string[] = [];
    const attachmentStore = {
      list: () => [
        { id: 'db', meta: databaseAttachment.meta, length: databaseAttachment.bytes.length },
        { id: 'file:unrelated', meta: { mediaType: 'application/octet-stream' }, length: 3 },
      ],
      recall: (id: string) => {
        recalledIds.push(id);
        if (id !== 'db') return null;
        recallCount += 1;
        return databaseAttachment.bytes;
      },
      store: () => {},
      remove: () => {},
    };
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) throw new Error('Mount root missing.');
    const mount = mountHvy({
      root,
      document: deserializeDocumentBytes(encoder.encode(source), '.hvy'),
      mode: 'editor',
      attachmentStore,
    });
    const descriptorBytesBeforeInitialization = getAttachment(mount.getDocument(), 'db')?.bytes.length ?? -1;
    const reader = await createScriptingDbRuntime(mount.getDocument());
    let rows: Record<string, unknown>[] = [];
    let queryError: string | null = null;
    try {
      rows = reader.api.query('SELECT id, title FROM records ORDER BY id');
    } catch (error) {
      queryError = error instanceof Error ? error.message : String(error);
    } finally {
      reader.dispose();
      mount.destroy();
    }
    return {
      descriptorBytesBeforeInitialization,
      recallCount,
      recalledIds,
      rows,
      queryError,
    };
  });

  expect(expectedResult).toEqual({
    descriptorBytesBeforeInitialization: 0,
    recallCount: 1,
    recalledIds: ['db'],
    rows: [{ id: 1, 0: 1, title: 'Persisted row', 1: 'Persisted row' }],
    queryError: null,
  });
});

test('doc.db mutation survives hosted serialize, store, and fresh remount', async ({ page }) => {
  await page.goto('/');

  const expectedResult = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="firstMount"></div><div id="secondMount"></div>';
    const [{ deserializeDocumentBytes, mountHvy }, { createScriptingDbRuntime }] = await Promise.all([
      import('/src/embed-full.ts'),
      import('/src/plugins/db-table.ts'),
    ]);
    const encoder = new TextEncoder();
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"work-log"}-->
#! Work Log
`;
    const hosted = new Map<string, { bytes: Uint8Array; meta: Record<string, unknown> }>();
    let recallCount = 0;
    let storeCount = 0;
    const attachmentStore = {
      list: () => [...hosted].map(([id, attachment]) => ({
        id,
        meta: attachment.meta,
        length: attachment.bytes.length,
      })),
      recall: (id: string) => {
        if (id === 'db') recallCount += 1;
        return hosted.get(id)?.bytes ?? null;
      },
      store: (id: string, bytes: Uint8Array, meta: Record<string, unknown>) => {
        storeCount += 1;
        hosted.set(id, { bytes: Uint8Array.from(bytes), meta });
        return { id, meta, length: bytes.length };
      },
      remove: (id: string) => hosted.delete(id),
    };
    const serializer = {
      async serializeDocumentBytes(request: {
        textBody: string;
        tail: Array<{ id: string; meta: Record<string, unknown> }>;
        recallAttachment(id: string): Promise<Uint8Array | null>;
      }) {
        for (const attachment of request.tail) {
          const bytes = await request.recallAttachment(attachment.id);
          if (bytes) {
            attachmentStore.store(attachment.id, bytes, attachment.meta);
          }
        }
        return encoder.encode(request.textBody);
      },
    };
    const firstRoot = document.querySelector<HTMLElement>('#firstMount');
    const secondRoot = document.querySelector<HTMLElement>('#secondMount');
    if (!firstRoot || !secondRoot) throw new Error('Mount roots missing.');
    const firstMount = mountHvy({
      root: firstRoot,
      document: deserializeDocumentBytes(encoder.encode(source), '.hvy'),
      mode: 'editor',
      attachmentStore,
      serializer,
    });
    const writer = await createScriptingDbRuntime(firstMount.getDocument());
    writer.api.execute('CREATE TABLE entries (id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
    writer.api.execute('INSERT INTO entries (note) VALUES (?)', ['Saved through host']);
    writer.dispose();

    const savedDocumentBytes = await firstMount.serializeDocumentBytesAsync();
    firstMount.destroy();
    const secondMount = mountHvy({
      root: secondRoot,
      document: deserializeDocumentBytes(savedDocumentBytes, '.hvy'),
      mode: 'editor',
      attachmentStore,
    });
    const reader = await createScriptingDbRuntime(secondMount.getDocument());
    let rows: Record<string, unknown>[] = [];
    let queryError: string | null = null;
    try {
      rows = reader.api.query('SELECT id, note FROM entries ORDER BY id');
    } catch (error) {
      queryError = error instanceof Error ? error.message : String(error);
    } finally {
      reader.dispose();
      secondMount.destroy();
    }
    return { storeCount, recallCount, rows, queryError };
  });

  expect(expectedResult).toEqual({
    storeCount: 1,
    recallCount: 1,
    rows: [{ id: 1, 0: 1, note: 'Saved through host', 1: 'Saved through host' }],
    queryError: null,
  });
});
