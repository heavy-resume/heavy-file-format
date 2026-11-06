import { expect, test, type Page } from '@playwright/test';

// A document script that asks a fake plugin for details and shows the answer when
// on_result fires. The plugin holds results until the test releases them.
async function openFakeLoaderDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { state, getRenderApp } = await import('/src/state.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    const { runPluginDocumentHooks } = await import('/src/plugins/hooks.ts');
    const registry = await import('/src/plugins/registry.ts');
    const fakeWindow = window as Window & { releaseFakeResults?: () => void };
    const pendingResults: Array<() => void> = [];
    fakeWindow.releaseFakeResults = () => pendingResults.splice(0).forEach((release) => release());
    registry.registerHostPlugin({
      id: 'com.example.fake-details',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake Details',
      scripting: {
        methods: {
          fetch: (args: Record<string, unknown>) => {
            pendingResults.push(() => (args.on_result as (value: unknown) => unknown)(`details for ${String(args.query)}`));
            return null;
          },
        },
      },
    });
    state.document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: hvy.scripting
    source: builtin://scripting
  - id: com.example.fake-details
    versionRange: ^1.0.0
    permissions: [scripting]
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section
 <!--hvy:text {"id":"fake-input"}-->
  Alpha
 <!--hvy:text {"id":"fake-status"}-->
  Initial
 <!--hvy:plugin {"id":"fake-loader","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
  query = doc.component.get_text("fake-input")
  if doc.component.get_text("fake-status") in ["Getting " + query, "Done " + query]:
      return
  doc.component.set_text("fake-status", "Getting " + query)
  def on_result(result):
      doc.component.set_text("fake-status", "Done " + query)
  doc.plugins.call("com.example.fake-details", "fetch", {"query": query, "on_result": on_result})
`, '.hvy');
    getRenderApp()();
    await runPluginDocumentHooks('unknown');
    fakeWindow.releaseFakeResults();
  });
  await expect(page.locator('#app')).toContainText('Done Alpha');
}

async function releaseFakeResults(page: Page): Promise<void> {
  await page.evaluate(() => (window as Window & { releaseFakeResults?: () => void }).releaseFakeResults?.());
}

test('before, a script edit reruns the loader, after: its late on_result is drawn', async ({ page }) => {
  test.setTimeout(5_000);
  await openFakeLoaderDocument(page);
  await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
    await runUserScript({ document: state.document, source: 'doc.component.set_text("fake-input", "Beta")' });
  });
  await expect(page.locator('#app')).toContainText('Getting Beta');

  await releaseFakeResults(page);

  await expect(page.locator('#app')).toContainText('Done Beta');
  await expect(page.locator('#app')).not.toContainText('Getting Beta');
});

test('before, a user edit reruns the loader, after: its late on_result is drawn', async ({ page }) => {
  test.setTimeout(5_000);
  await openFakeLoaderDocument(page);
  await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { runDocumentEditHooksAfterCommit } = await import('/src/document-edit-hooks.ts');
    state.document.sections[0].blocks.find((block) => block.schema.id === 'fake-input')!.text = 'Beta';
    runDocumentEditHooksAfterCommit(null);
  });
  await expect(page.locator('#app')).toContainText('Getting Beta');

  await releaseFakeResults(page);

  await expect(page.locator('#app')).toContainText('Done Beta');
  await expect(page.locator('#app')).not.toContainText('Getting Beta');
});

// Registers on_records with a small step budget and exposes it as fakeCallHandler.
async function registerFakeHandler(page: Page, handlerBody: string): Promise<void> {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const registration = await page.evaluate(async (body) => {
    const [{ runUserScript }, { deserializeDocument }, registry, { state }] = await Promise.all([
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/serialization.ts'),
      import('/src/plugins/registry.ts'),
      import('/src/state.ts'),
    ]);
    registry.registerHostPlugin({
      id: 'com.example.fake-feed',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake Feed',
      scripting: {
        methods: {
          subscribe: (args: Record<string, unknown>) => {
            (window as Window & { fakeCallHandler?: unknown }).fakeCallHandler = args.on_records;
            return null;
          },
        },
      },
    });
    state.document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: com.example.fake-feed
    versionRange: ^1.0.0
    permissions: [scripting]
---
`, '.hvy');
    const result = await runUserScript({
      document: state.document,
      maxLines: 300,
      source: `def on_records(value):
${body}
doc.plugins.call("com.example.fake-feed", "subscribe", {"on_records": on_records})`,
    });
    return { ok: result.ok, error: result.error };
  }, handlerBody);
  expect(registration).toEqual({ ok: true, error: undefined });
}

function callFakeHandler(page: Page, times: number): Promise<unknown[]> {
  return page.evaluate((count) => {
    const handler = (window as Window & { fakeCallHandler?: (value: unknown) => unknown }).fakeCallHandler!;
    return Array.from({ length: count }, (_, index) => handler({ index }) ?? null);
  }, times);
}

test('before, a handler used up its step budget, a quiet gap, after: it runs again', async ({ page }) => {
  test.setTimeout(5_000);
  await registerFakeHandler(page, `    total = 0
    for i in range(20):
        total += i
    return total`);
  const callsWithoutGap = await callFakeHandler(page, 10);
  expect(callsWithoutGap[0]).toBe(190);
  expect(callsWithoutGap.at(-1)).toBeNull();

  await page.clock.fastForward(3_100);

  expect(await callFakeHandler(page, 1)).toEqual([190]);
});

test('before, a gap shorter than the quiet period, after: the used up handler stays stopped', async ({ page }) => {
  test.setTimeout(5_000);
  await registerFakeHandler(page, `    total = 0
    for i in range(20):
        total += i
    return total`);
  const callsWithoutGap = await callFakeHandler(page, 10);
  expect(callsWithoutGap[0]).toBe(190);
  expect(callsWithoutGap.at(-1)).toBeNull();

  await page.clock.fastForward(2_000);

  expect(await callFakeHandler(page, 1)).toEqual([null]);
});

test('before, a quiet gap, after: a handler that never finishes is still stopped by its budget', async ({ page }) => {
  test.setTimeout(5_000);
  await registerFakeHandler(page, `    if value["index"] == 0:
        return "reached"
    while True:
        pass`);
  expect(await callFakeHandler(page, 1)).toEqual(['reached']);
  await page.clock.fastForward(3_100);

  expect(await page.evaluate(() => {
    const handler = (window as Window & { fakeCallHandler?: (value: unknown) => unknown }).fakeCallHandler!;
    return handler({ index: 1 }) ?? null;
  })).toBeNull();
});
