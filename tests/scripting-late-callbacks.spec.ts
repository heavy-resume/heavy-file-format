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
