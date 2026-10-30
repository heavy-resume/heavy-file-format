import { expect, test } from '@playwright/test';

const fakeTimerDocument = `---
hvy_version: 0.1
plugins:
  - id: com.example.fake-timer
    versionRange: ^1.0.0
    permissions: [scripting]
---
`;

test('sandboxed script transactions left open are committed on success and rolled back on failure', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const expectedResult = await page.evaluate(async (documentText) => {
    const [{ runUserScript }, { deserializeDocument }, registry, { getActiveStateRuntime }, { getAttachment, setAttachment }] = await Promise.all([
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/serialization.ts'),
      import('/src/plugins/registry.ts'),
      import('/src/state.ts'),
      import('/src/attachments.ts'),
    ]);
    let pendingCallback: (() => unknown) | null = null;
    registry.registerHostPlugin({
      id: 'com.example.fake-timer',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake Timer',
      scripting: {
        methods: {
          later: (args: Record<string, unknown>) => {
            pendingCallback = args.on_fire as () => unknown;
            return null;
          },
        },
      },
    });
    const document = deserializeDocument(documentText, '.hvy');
    // Callbacks outlive their run only for the live document.
    getActiveStateRuntime().state.document = document;
    // Reads the saved attachment, not rows that exist only on the live connection.
    const readTitles = async () => {
      const saved = getAttachment(document, 'db')!;
      setAttachment(document, 'db', saved.meta, Uint8Array.from(saved.bytes));
      await runUserScript({
        document,
        source: 'doc.header.set("titles", ",".join([row["title"] for row in doc.db.query("SELECT title FROM tasks ORDER BY id")]))',
      });
      return document.meta.titles;
    };

    // BEFORE
    await runUserScript({ document, source: 'doc.db.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)")' });

    // ACTION
    const committedRun = await runUserScript({
      document,
      source: `
doc.db.execute("BEGIN")
doc.db.execute("INSERT INTO tasks (title) VALUES ('Alpha')")
doc.db.execute("INSERT INTO tasks (title) VALUES ('Bravo')")
doc.db.execute("COMMIT")
`,
    });
    const afterCommit = await readTitles();
    const failedRun = await runUserScript({
      document,
      source: `
doc.db.execute("BEGIN")
doc.db.execute("INSERT INTO tasks (title) VALUES ('Failed run')")
raise ValueError("fake failure")
`,
    });
    const afterFailedRun = await readTitles();
    const callbackErrors: string[] = [];
    const uncommittedRun = await runUserScript({
      document,
      onCallbackError: (callbackResult) => callbackErrors.push(callbackResult.error ?? ''),
      source: `
def on_fire():
    doc.header.set("fired", "yes")
    doc.db.execute("BEGIN")
    doc.db.execute("INSERT INTO tasks (title) VALUES ('Uncommitted callback')")
doc.plugins.call("com.example.fake-timer", "later", {"on_fire": on_fire})
doc.db.execute("BEGIN")
doc.db.execute("INSERT INTO tasks (title) VALUES ('Uncommitted run')")
`,
    });
    const afterUncommittedRun = await readTitles();
    pendingCallback?.();
    const afterUncommittedCallback = await readTitles();
    await runUserScript({
      document,
      onCallbackError: (callbackResult) => callbackErrors.push(callbackResult.error ?? ''),
      source: `
def on_fire():
    doc.db.execute("BEGIN")
    doc.db.execute("INSERT INTO tasks (title) VALUES ('Failed callback')")
    raise ValueError("fake callback failure")
doc.plugins.call("com.example.fake-timer", "later", {"on_fire": on_fire})
`,
    });
    pendingCallback?.();
    const afterFailedCallback = await readTitles();

    // AFTER
    return {
      committedRun: committedRun.ok,
      afterCommit,
      failedRunError: failedRun.error,
      afterFailedRun,
      uncommittedRun: uncommittedRun.ok,
      afterUncommittedRun,
      callbackFired: document.meta.fired,
      callbackErrors,
      afterUncommittedCallback,
      afterFailedCallback,
    };
  }, fakeTimerDocument);

  expect(expectedResult).toEqual({
    committedRun: true,
    afterCommit: 'Alpha,Bravo',
    failedRunError: expect.stringContaining('fake failure'),
    afterFailedRun: 'Alpha,Bravo',
    uncommittedRun: true,
    afterUncommittedRun: 'Alpha,Bravo,Uncommitted run',
    callbackFired: 'yes',
    callbackErrors: [expect.stringContaining('fake callback failure')],
    afterUncommittedCallback: 'Alpha,Bravo,Uncommitted run,Uncommitted callback',
    afterFailedCallback: 'Alpha,Bravo,Uncommitted run,Uncommitted callback',
  });
});
