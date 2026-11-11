import { expect, test, type Page } from '@playwright/test';
import initSqlJs from 'sql.js';
import { gzipSync } from 'fflate';

// One user action is one undo step, however many scripts and database writes follow
// it. Writes keep joining the step until five seconds after its first write.

const FAKE_SCHEMA = `
CREATE TABLE fake_rows (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE fake_summary (id INTEGER PRIMARY KEY, row_count INTEGER NOT NULL);
INSERT INTO fake_summary (id, row_count) VALUES (1, 0);
`;

const FAKE_FRONT_MATTER = `---
hvy_version: 0.1
plugins:
  - id: hvy.form
  - id: fake.api
    permissions:
      - scripting
---

<!--hvy: {"id":"fake-undo-section"}-->
#! Fake undo

<!--hvy:text {"id":"fake-status"}-->
Fake status start
`;

const formsDocument = `${FAKE_FRONT_MATTER}
<!--hvy:plugin {"id":"fake-three-writes","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitScript":"run","submitLabel":"Fake three writes"}}-->
fields: []
scripts:
  run: |
    doc.db.execute("INSERT INTO fake_rows (label) VALUES ('three-a')")
    doc.db.execute("INSERT INTO fake_rows (label) VALUES ('three-b')")
    doc.db.execute("INSERT INTO fake_rows (label) VALUES ('three-c')")

<!--hvy:plugin {"id":"fake-one-write","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitScript":"run","submitLabel":"Fake one write"}}-->
fields: []
scripts:
  run: |
    doc.db.execute("INSERT INTO fake_rows (label) VALUES ('one')")

<!--hvy:plugin {"id":"fake-doc-and-db","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitScript":"run","submitLabel":"Fake document and database"}}-->
fields: []
scripts:
  run: |
    doc.component.set_text("fake-status", "Fake status changed")
    doc.db.execute("INSERT INTO fake_rows (label) VALUES ('doc-and-db')")

<!--hvy:plugin {"id":"fake-request","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitScript":"run","submitLabel":"Fake request"}}-->
fields: []
scripts:
  run: |
    def on_result(value):
        doc.db.execute("INSERT INTO fake_rows (label) VALUES (?)", [value])
    doc.db.execute("INSERT INTO fake_rows (label) VALUES ('request')")
    doc.plugins.call("fake.api", "request", {"on_result": on_result})
`;

const reactingScriptDocument = `${formsDocument}
<!--hvy:plugin {"id":"fake-summary-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.2"}}-->
if doc.db.get_updated_tables(table_name="fake_rows"):
    count = doc.db.query("SELECT COUNT(*) AS row_count FROM fake_rows")[0]["row_count"]
    doc.db.execute("UPDATE fake_summary SET row_count = ? WHERE id = 1", [count])
`;

const loadScriptDocument = `${formsDocument}
<!--hvy:plugin {"id":"fake-seed-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.2"}}-->
if not doc.db.query("SELECT id FROM fake_rows WHERE label = 'seeded'"):
    doc.db.execute("INSERT INTO fake_rows (label) VALUES ('seeded')")
`;

type FakeUndoWindow = Window & {
  fakeApiResult: ((value: string) => void) | null;
  fakeMount: {
    getDocument(): unknown;
    undo(): Promise<void>;
    redo(): Promise<void>;
  };
};

async function withFakeDatabase(text: string): Promise<number[]> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(FAKE_SCHEMA);
  const database = gzipSync(db.export());
  db.close();
  const tail = JSON.stringify({ id: 'db', plugin: 'hvy.db-table', mediaType: 'application/vnd.sqlite3', encoding: 'gzip', length: database.length });
  const head = new TextEncoder().encode(`${text}\n<!--hvy:tail ${tail}-->\n--HVY-TAIL--\n`);
  return [...head, ...database];
}

async function mountFakeDocument(page: Page, source: string): Promise<void> {
  const bytes = await withFakeDatabase(source);
  await page.goto('/');
  await page.evaluate(async (bytes) => {
    const embedPath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px"></div>';
    const testWindow = window as unknown as FakeUndoWindow;
    testWindow.fakeApiResult = null;
    testWindow.fakeMount = mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode: 'viewer',
      document: deserializeDocumentBytes(new Uint8Array(bytes), '.hvy'),
      plugins: [plugins.form, plugins.scripting, {
        id: 'fake.api',
        displayName: 'Fake API',
        create: () => ({ element: document.createElement('div') }),
        scripting: {
          methods: {
            // Holds the callback so the test decides when the fake API result arrives.
            request: (args: { on_result: (value: string) => void }) => {
              testWindow.fakeApiResult = args.on_result;
            },
          },
        },
      }],
    });
  }, bytes);
  await expect(page.locator('#fakeRoot').getByText('Fake status start')).toBeVisible();
}

function readFakeRows(page: Page): Promise<{ labels: string[]; summaryCount: number }> {
  return page.evaluate(async () => {
    const dbTablePath = '/src/plugins/db-table.ts';
    const { createScriptingDbRuntime } = await import(/* @vite-ignore */ dbTablePath);
    const runtime = await createScriptingDbRuntime((window as unknown as FakeUndoWindow).fakeMount.getDocument());
    try {
      return {
        labels: runtime.api.query('SELECT label FROM fake_rows ORDER BY id').map((row: { label: string }) => row.label),
        summaryCount: runtime.api.query('SELECT row_count FROM fake_summary WHERE id = 1')[0].row_count,
      };
    } finally {
      runtime.dispose();
    }
  });
}

function undo(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as FakeUndoWindow).fakeMount.undo());
}

function redo(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as FakeUndoWindow).fakeMount.redo());
}

test('expected result: one submit whose script makes three database writes is one undo step', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, formsDocument);
  await page.getByRole('button', { name: 'Fake three writes' }).click();
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['three-a', 'three-b', 'three-c'], summaryCount: 0 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: [], summaryCount: 0 });

  await redo(page);
  expect(await readFakeRows(page)).toEqual({ labels: ['three-a', 'three-b', 'three-c'], summaryCount: 0 });
});

test('expected result: one submit whose script edits the document and the database undoes both together', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, formsDocument);
  const root = page.locator('#fakeRoot');
  await page.getByRole('button', { name: 'Fake document and database' }).click();
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['doc-and-db'], summaryCount: 0 });
  await expect(root.getByText('Fake status changed')).toBeVisible();

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: [], summaryCount: 0 });
  await expect(root.getByText('Fake status start')).toBeVisible();

  await redo(page);
  expect(await readFakeRows(page)).toEqual({ labels: ['doc-and-db'], summaryCount: 0 });
  await expect(root.getByText('Fake status changed')).toBeVisible();
});

test('expected result: two submits are two undo steps', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, formsDocument);
  await page.getByRole('button', { name: 'Fake three writes' }).click();
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['three-a', 'three-b', 'three-c'], summaryCount: 0 });
  await page.getByRole('button', { name: 'Fake one write' }).click();
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['three-a', 'three-b', 'three-c', 'one'], summaryCount: 0 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: ['three-a', 'three-b', 'three-c'], summaryCount: 0 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: [], summaryCount: 0 });
});

test('expected result: a plugin callback writing after the submit joins the submit undo step', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, formsDocument);
  await page.getByRole('button', { name: 'Fake request' }).click();
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['request'], summaryCount: 0 });
  await page.evaluate(() => (window as unknown as FakeUndoWindow).fakeApiResult!('fake-result'));
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['request', 'fake-result'], summaryCount: 0 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: [], summaryCount: 0 });

  await redo(page);
  expect(await readFakeRows(page)).toEqual({ labels: ['request', 'fake-result'], summaryCount: 0 });
});

test('expected result: a plugin callback writing over five seconds after the first write is its own undo step', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, formsDocument);
  await page.getByRole('button', { name: 'Fake request' }).click();
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['request'], summaryCount: 0 });
  await page.evaluate(() => {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + 6_000;
    (window as unknown as FakeUndoWindow).fakeApiResult!('fake-late-result');
  });
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['request', 'fake-late-result'], summaryCount: 0 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: ['request'], summaryCount: 0 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: [], summaryCount: 0 });
});

test('expected result: a script reacting to the submit database write joins the submit undo step', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, reactingScriptDocument);
  await page.getByRole('button', { name: 'Fake one write' }).click();
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['one'], summaryCount: 1 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: [], summaryCount: 0 });

  await redo(page);
  expect(await readFakeRows(page)).toEqual({ labels: ['one'], summaryCount: 1 });
});

test('expected result: database writes from load-time scripts are not undoable', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, loadScriptDocument);
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['seeded'], summaryCount: 0 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: ['seeded'], summaryCount: 0 });

  await page.getByRole('button', { name: 'Fake one write' }).click();
  await expect.poll(() => readFakeRows(page)).toEqual({ labels: ['seeded', 'one'], summaryCount: 0 });

  await undo(page);
  expect(await readFakeRows(page)).toEqual({ labels: ['seeded'], summaryCount: 0 });
});
