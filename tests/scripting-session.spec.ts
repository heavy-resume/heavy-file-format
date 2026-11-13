import { expect, test, type Page } from '@playwright/test';

const SCRIPTING_IDLE_TIMEOUT_MS = 1_000;

test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-GB' });

function sessionDocument(libraries: string[], source: string): string {
  return `---
hvy_version: 0.1
---

<!--hvy: {"id":"session-section"}-->
#! Session

<!--hvy:plugin {"id":"session-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1","libraries":${JSON.stringify(libraries)}}}-->
${source.trim()}
`;
}

async function openRawEditor(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-16T22:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
}

async function applyRawDocument(page: Page, source: string): Promise<void> {
  await page.locator('#rawEditor').fill(source);
  await page.getByRole('button', { name: 'Apply' }).click();
}

async function readDocumentMeta(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (metaKey) => {
    const { state } = await import(/* @vite-ignore */ '/src/state.ts');
    return state.document.meta[metaKey];
  }, key);
}

const COUNTER_DOCUMENT = sessionDocument([], `
count = session.state.get("example_counter", 0) + 1
session.state["example_counter"] = count
doc.header.set("example_count", count)
`);

test('session.state keeps its values across runs until a different document is loaded', async ({ page }) => {
  await openRawEditor(page);
  await applyRawDocument(page, COUNTER_DOCUMENT);
  await expect.poll(() => readDocumentMeta(page, 'example_count'), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toBe(1);

  // Applying raw text replaces the document object, as undo does, but keeps the open document's session.
  await applyRawDocument(page, COUNTER_DOCUMENT);
  await expect.poll(() => readDocumentMeta(page, 'example_count'), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toBe(2);

  await page.evaluate(async () => {
    const { resetToBlankDocument } = await import(/* @vite-ignore */ '/src/navigation.ts');
    resetToBlankDocument();
  });
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await applyRawDocument(page, COUNTER_DOCUMENT);
  await expect.poll(() => readDocumentMeta(page, 'example_count'), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toBe(1);
});

test('session.state stays out of the saved document and undo history', async ({ page }) => {
  await openRawEditor(page);
  await applyRawDocument(page, sessionDocument([], `
session.state["example_note"] = "fake-session-" + "value"
`));
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import(/* @vite-ignore */ '/src/state.ts');
    return state.history.length;
  }), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toBeGreaterThan(0);

  const savedAndHistory = await page.evaluate(async () => {
    const { state } = await import(/* @vite-ignore */ '/src/state.ts');
    const { serializeDocument } = await import(/* @vite-ignore */ '/src/serialization.ts');
    return `${serializeDocument(state.document)}\n${state.history.join('\n')}`;
  });
  expect(savedAndHistory).not.toContain('fake-session-value');
});

test('session exposes its id, start time, timezone and locale', async ({ page }) => {
  await openRawEditor(page);
  await applyRawDocument(page, sessionDocument(['datetime'], `
if session.state.get("example_first_id") is None:
    session.state["example_first_id"] = session.id
lines = [
    str(len(session.id) > 0),
    str(session.state["example_first_id"] == session.id),
    session.start_time.isoformat(),
    session.timezone,
    session.locale,
]
doc.header.set("session_result", "\\n".join(lines))
`));
  const expectedLines = [
    'True',
    'True',
    '2026-10-16T15:00:00-07:00',
    'America/Los_Angeles',
    'en-GB',
  ];
  await expect.poll(async () => String(await readDocumentMeta(page, 'session_result') ?? '').split('\n'), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toEqual(expectedLines);
});

test('session.start_time asks for the datetime library when it is not enabled', async ({ page }) => {
  await openRawEditor(page);
  await applyRawDocument(page, sessionDocument([], `
try:
    session.start_time
except RuntimeError as error:
    doc.header.set("session_error", str(error))
`));
  await expect.poll(() => readDocumentMeta(page, 'session_error'), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toBe("session.start_time requires the 'datetime' library.");
});

test('a value read from session.state is a copy until it is assigned back', async ({ page }) => {
  await openRawEditor(page);
  await applyRawDocument(page, sessionDocument([], `
session.state["example_items"] = ["fake-a"]
session.state["example_items"].append("fake-lost")
items = list(session.state["example_items"])
items.append("fake-b")
session.state["example_items"] = items
doc.header.set("session_items", ",".join(session.state["example_items"]))
`));
  await expect.poll(() => readDocumentMeta(page, 'session_items'), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toBe('fake-a,fake-b');
});

test('session.state rejects values that are not JSON', async ({ page }) => {
  await openRawEditor(page);
  await applyRawDocument(page, sessionDocument([], `
def example_callback():
    return None

try:
    session.state["example_callback"] = {"nested": example_callback}
except TypeError as error:
    doc.header.set("session_error", str(error))
doc.header.set("session_has_callback", "example_callback" in session.state)
`));
  await expect.poll(() => readDocumentMeta(page, 'session_error'), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toBe('session.state["example_callback"]/nested must be a JSON value, got function');
  expect(await readDocumentMeta(page, 'session_has_callback')).toBe(false);
});

test('a JavaScript plugin reads and writes the same session.state as scripts', async ({ page }) => {
  await page.goto('/');
  const metaAfterScript = await page.evaluate(async () => {
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ '/src/embed.ts');
    const source = `---
hvy_version: 0.1
plugins:
  - id: fake.session
    permissions:
      - scripting
---

<!--hvy: {"id":"session-section"}-->
#! Session

<!--hvy:plugin {"id":"session-check","plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
session.state["example_from_script"] = "fake-script-value"
seen_by_plugin = doc.plugins.call("fake.session", "exchange", {"value": 41})
doc.header.set("seen_by_plugin", seen_by_plugin)
doc.header.set("seen_by_script", session.state["example_from_plugin"])
`;
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px"></div>';
    const mount = mountHvy({
      root: document.querySelector('#fakeRoot') as HTMLElement,
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      plugins: [plugins.scripting, {
        id: 'fake.session',
        displayName: 'Fake session',
        create: () => ({ element: document.createElement('div') }),
        scripting: {
          methods: {
            exchange: (args: { value: number }, context: { session: { state: { get(key: string): unknown; set(key: string, value: unknown): void } } }) => {
              context.session.state.set('example_from_plugin', args.value + 1);
              return context.session.state.get('example_from_script');
            },
          },
        },
      }],
    });
    const deadline = Date.now() + 1_000;
    while (mount.getDocument().meta.seen_by_script === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const meta = mount.getDocument().meta;
    return { seen_by_plugin: meta.seen_by_plugin, seen_by_script: meta.seen_by_script };
  });
  expect(metaAfterScript).toEqual({ seen_by_plugin: 'fake-script-value', seen_by_script: 42 });
});
