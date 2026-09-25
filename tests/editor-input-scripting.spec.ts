import { expect, test, type Page } from '@playwright/test';

async function openScriptedEditor(page: Page, field: 'caption' | 'fill-in'): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#downloadName')).toHaveValue(/\.(hvy|thvy)$/);
  await page.evaluate(async (field) => {
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
 <!--hvy:image {"id":"fake-image"}-->
 <!--hvy:text {"id":"fake-fill","fillIn":true}-->
  Before <!-- value {"placeholder":"Fake value"} --> after
 <!--hvy:text {"id":"fake-dependent","visibleScript":"return 'ready' in doc.component.get_text('fake-fill')"}-->
  Fake dependent
 <!--hvy:text {"id":"fake-result"}-->
  Initial
 <!--hvy:plugin {"id":"fake-maintenance","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
  doc.component.set_text("fake-result", doc.tool.view_component(component_ref="fake-image"))
`, '.hvy');
    const section = state.document.sections[0];
    const block = section.blocks.find((block) => block.schema.id === (field === 'caption' ? 'fake-image' : 'fake-fill'))!;
    if (field === 'caption') {
      state.captionTextModal = { target: { kind: 'image', sectionKey: section.key, blockId: block.id }, title: 'Fake Caption' };
    } else {
      state.activeEditorBlock = { sectionKey: section.key, blockId: block.id };
      state.activeTextEditorMode = { ...state.activeEditorBlock, mode: 'fill-in' };
    }
    getRenderApp()();
    await runPluginDocumentHooks('unknown');
  }, field);
}

test('before, caption typing and close, after: preview stays local and maintenance sees the committed caption', async ({ page }) => {
  test.setTimeout(5000);
  await openScriptedEditor(page, 'caption');
  const caption = page.locator('[data-field="caption-rich"]');
  await caption.click();
  const before = await page.evaluate(async () => {
    const { state, renderCount, refreshReaderCount } = await import('/src/state.ts');
    return { renderCount, refreshReaderCount, result: state.document.sections[0].blocks.find((block) => block.schema.id === 'fake-result')!.text };
  });
  let scriptRuns = 0;
  page.on('console', (message) => { if (message.text().startsWith('[hvy:scripting] script run')) scriptRuns += 1; });

  await caption.pressSequentially('Fake caption', { delay: 10 });
  await page.locator('.caption-text-modal [data-align-value="right"]').click();

  await expect(page.locator('.caption-text-modal-preview .image-caption')).toHaveText('Fake caption');
  await expect(page.locator('.caption-text-modal-preview .image-caption')).toHaveCSS('text-align', 'right');
  await expect(caption).toBeFocused();
  expect(await page.evaluate(async () => {
    const { state, renderCount, refreshReaderCount } = await import('/src/state.ts');
    return { renderCount, refreshReaderCount, result: state.document.sections[0].blocks.find((block) => block.schema.id === 'fake-result')!.text };
  })).toEqual(before);
  expect(scriptRuns).toBe(0);

  await page.getByRole('button', { name: 'Close Fake Caption' }).click();

  await expect(page.locator('[data-field="caption-rich"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks.find((block) => block.schema.id === 'fake-result')!.text;
  })).toContain('Fake caption');
  expect(scriptRuns).toBeGreaterThan(0);
});

test('before, continuous fill-in typing, after: visibility updates before typing stops', async ({ page }) => {
  test.setTimeout(5000);
  await openScriptedEditor(page, 'fill-in');
  const fill = page.locator('[data-field="text-fill-in-value"]').first();
  await fill.click();
  const dependent = page.locator('[data-hvy-dynamic-visibility="true"]').filter({ hasText: 'Fake dependent' }).first();
  await expect(dependent).toHaveAttribute('data-visible-state', 'hidden');

  const typing = fill.pressSequentially('readyxxxxxxxxxxxxxxxxxxx', { delay: 35 });
  await expect(dependent).toHaveAttribute('data-visible-state', 'visible');
  expect((await fill.textContent())!.length).toBeLessThan(24);
  await typing;

  await expect(fill).toHaveText('readyxxxxxxxxxxxxxxxxxxx');
  await expect(fill).toBeFocused();
});

test('before, scheduled visibility then document replacement or detach, after: stale work leaves the old surface alone', async ({ page }) => {
  test.setTimeout(5000);
  await openScriptedEditor(page, 'fill-in');
  expect(await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { scheduleButtonVisibilityScripts } = await import('/src/editor/components/button/button-visibility-scheduler.ts');
    const root = document.querySelector('.hvy-document')!;
    const probe = document.createElement('div');
    probe.innerHTML = '<span data-hvy-button="true" data-section-key="missing" data-block-id="missing" data-visible-state="visible"></span>';
    root.append(probe);
    scheduleButtonVisibilityScripts(probe);
    state.document = { ...state.document };
    await new Promise((resolve) => setTimeout(resolve, 200));
    const afterReplacement = probe.firstElementChild!.getAttribute('data-visible-state');

    scheduleButtonVisibilityScripts(probe);
    probe.remove();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { afterReplacement, afterDetach: probe.firstElementChild!.getAttribute('data-visible-state') };
  })).toEqual({ afterReplacement: 'visible', afterDetach: 'visible' });
});

test('before, fill-in typing, after: visibility follows the latest value without a pass per character or losing the caret', async ({ page }) => {
  test.setTimeout(5000);
  await openScriptedEditor(page, 'fill-in');
  const fill = page.locator('[data-field="text-fill-in-value"]').first();
  await fill.click();
  const dependent = page.locator('[data-hvy-dynamic-visibility="true"]').filter({ hasText: 'Fake dependent' }).first();
  await expect(dependent).toHaveAttribute('data-visible-state', 'hidden');
  const visibilityPasses: Promise<unknown>[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[hvy:perf] ')) visibilityPasses.push(message.args()[1].jsonValue());
  });

  await fill.pressSequentially('ready', { delay: 20 });

  await expect(dependent).toHaveAttribute('data-visible-state', 'visible');
  await expect(fill).toBeFocused();
  expect(await fill.evaluate((element) => {
    const selection = window.getSelection();
    return { text: element.textContent, offset: selection?.focusOffset, inside: element.contains(selection?.focusNode ?? null) };
  })).toEqual({ text: 'ready', offset: 5, inside: true });
  expect((await Promise.all(visibilityPasses)).filter((event) => (event as { event?: string }).event === 'button-visibility-scripts:start')).toHaveLength(1);
});
