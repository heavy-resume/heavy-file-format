import { expect, test } from '@playwright/test';

test('before, a 20k-line script run, after: per-line tracing stays in the low microseconds', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();

  const expectedResult = await page.evaluate(async () => {
    const [{ runUserScript }, { deserializeDocument }] = await Promise.all([
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/serialization.ts'),
    ]);
    const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
    const source = 'total = 0\nfor i in range(10000):\n    total += i\ndoc.header.set("fake_total", str(total))';
    await runUserScript({ document, source: 'warm = 1' });

    const startedAt = performance.now();
    const result = await runUserScript({ document, source });
    const elapsedMs = performance.now() - startedAt;
    return { ok: result.ok, stepsExecuted: result.stepsExecuted, total: document.meta.fake_total, fastEnough: elapsedMs < 1_000 };
  });

  // Removing forbidden names with dict.pop() on every traced line made this run take ~2.6s.
  expect(expectedResult).toEqual({ ok: true, stepsExecuted: 20_004, total: '49995000', fastEnough: true });
});

test('before, a script edit that a document script depends on, after: one render shows both edits', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { state, getRenderApp } = await import('/src/state.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    const { runPluginDocumentHooks } = await import('/src/plugins/hooks.ts');
    state.document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: hvy.scripting
    source: builtin://scripting
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section
 <!--hvy:text {"id":"fake-input"}-->
  Alpha
 <!--hvy:text {"id":"fake-result"}-->
  Initial
 <!--hvy:plugin {"id":"fake-dependent","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
  doc.component.set_text("fake-result", doc.component.get_text("fake-input") + "!")
`, '.hvy');
    getRenderApp()();
    await runPluginDocumentHooks('unknown');
  });
  await expect(page.locator('#app')).toContainText('Alpha!');
  const rendersBefore = await page.evaluate(async () => (await import('/src/state.ts')).renderCount);

  await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
    await runUserScript({ document: state.document, source: 'doc.component.set_text("fake-input", "Gamma")' });
  });

  await expect.poll(() => page.evaluate(async () => {
    const { state, renderCount } = await import('/src/state.ts');
    const texts = state.document.sections[0].blocks.slice(0, 2).map((block) => block.text);
    return { texts, renders: renderCount };
  })).toEqual({ texts: ['Gamma', 'Gamma!'], renders: rendersBefore + 1 });
  await expect(page.locator('#app')).toContainText('Gamma!');
});
