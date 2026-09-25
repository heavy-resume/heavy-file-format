import { expect, test, type Page } from '@playwright/test';
import type { HvyMount, HvyTemplateFormResult } from '../src/embed';

type FormWindow = Window & {
  fakeFormMount: HvyMount;
  fakeFormResult?: HvyTemplateFormResult;
  fakeFormError?: string;
};

async function mountFormDocument(page: Page, mode: 'viewer' | 'editor' | 'ai', leadingBlocks = 0) {
  await page.goto('/');
  await expect(page.locator('.layout')).toBeVisible();
  await page.evaluate(async ({ mode, leadingBlocks }) => {
    const { mountHvy, deserializeDocumentBytes } = await import('/src/embed.ts');
    document.body.innerHTML = '<div id="fake-form-root" style="height:600px;width:390px"></div>';
    const mount = mountHvy({
      root: document.getElementById('fake-form-root')!, mode,
      document: deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
component_defs:
  - name: fake-entry
    baseType: text
    text: "{% title %}"
---

#! Fake main

Fake main content

<!--hvy: {"id":"fake-sidebar","location":"sidebar","expanded":false}-->
#! Fake sidebar

<!--hvy:container {"containerExpanded":false}-->
${Array.from({ length: leadingBlocks }, (_, index) => `  <!--hvy:text {}-->\n    Fake preceding block ${index}\n`).join('\n')}
  <!--hvy:component-list {"id":"fake-list","componentListComponent":"fake-entry"}-->

`), '.hvy'),
    });
    (window as unknown as FormWindow).fakeFormMount = mount;
    await mount.setMode(mode);
    const { state } = await import('/src/state.ts');
    const { setSidebarOpen, setEditorSidebarOpen } = await import('/src/navigation.ts');
    document.getElementById('fake-form-root')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    if (mode === 'editor') setEditorSidebarOpen(document.getElementById('fake-form-root')!, false);
    else setSidebarOpen(document.getElementById('fake-form-root')!, false);
    state.paneScroll.viewerSidebarTop = 0;
  }, { mode, leadingBlocks });
}

for (const mode of ['viewer', 'editor', 'ai'] as const) {
  test(`${mode}: host reveals sidebar list, inserts template values, and supports undo`, async ({ page }) => {
    test.setTimeout(5_000);
    await mountFormDocument(page, mode);
    expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.isDirty())).toBe(false);
    await page.evaluate(() => {
      const w = window as unknown as FormWindow;
      void w.fakeFormMount.openTemplateForm({ targetType: 'fake-entry' }).then(result => { w.fakeFormResult = result; }).catch(error => { w.fakeFormError = error.message; });
    });
    const form = page.locator('.reusable-template-modal');
    await expect(form).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.isDirty())).toBe(false);
    await expect(page.locator(mode === 'editor' ? '.editor-shell' : '.viewer-shell')).toHaveClass(/is-sidebar-open/);
    expect(await page.evaluate(async () => {
      const { state } = await import('/src/state.ts');
      return state.currentView;
    })).toBe(mode);
    await form.locator('[data-template-variable="title"]').pressSequentially('Fake new item');
    await expect(form.locator('[data-template-variable="title"]')).toBeFocused();
    await form.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormResult)).toEqual({ status: 'inserted', itemId: null });
    expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.exportDocumentSourceMarkdown())).toContain('Fake new item');
    expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.isDirty())).toBe(true);
    if (mode === 'editor') await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.undo());
    expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.exportDocumentSourceMarkdown())).not.toContain('Fake new item');
  });
}

for (const action of ['cancel', 'escape', 'destroy'] as const) {
  test(`host form ${action} settles without adding an item`, async ({ page }) => {
    test.setTimeout(5_000);
    await mountFormDocument(page, 'viewer');
    await page.evaluate(() => {
      const w = window as unknown as FormWindow;
      void w.fakeFormMount.openTemplateForm({ targetId: 'fake-list' }).then(result => { w.fakeFormResult = result; });
    });
    await expect(page.locator('.reusable-template-modal')).toBeVisible();
    if (action === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    else if (action === 'escape') await page.locator('[data-template-variable="title"]').press('Escape');
    else await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.destroy());
    await expect(page.locator('.reusable-template-modal')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormResult)).toEqual({ status: 'cancelled' });
    if (action !== 'destroy') {
      expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.isDirty())).toBe(false);
      await expect(page.locator('.viewer-shell')).toHaveClass(/is-sidebar-open/);
    }
  });
}

for (const mode of ['viewer', 'editor', 'ai'] as const) {
  test(`${mode}: navigation retains the list's scroll position after cancellation`, async ({ page }) => {
    test.setTimeout(5_000);
    await mountFormDocument(page, mode, 30);
    await page.evaluate(() => {
      const w = window as unknown as FormWindow;
      void w.fakeFormMount.openTemplateForm({ targetId: 'fake-list', targetType: 'fake-entry' }).then(result => { w.fakeFormResult = result; });
    });
    await expect(page.locator('.reusable-template-modal')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => page.evaluate(async (mode) => {
      const { resolveTemplateFormTarget } = await import('/src/template-form-target.ts');
      const target = resolveTemplateFormTarget((window as unknown as FormWindow).fakeFormMount.getDocument(), { targetId: 'fake-list' });
      const root = document.getElementById('fake-form-root')!;
      const list = root.querySelector(`[data-section-key="${target.sectionKey}"][data-block-id="${target.block.id}"]`)!;
      const pane = root.querySelector(mode === 'editor' ? '.editor-sidebar-panel' : '.viewer-sidebar-panel')!;
      const rect = list.getBoundingClientRect();
      const viewport = pane.getBoundingClientRect();
      return { scrolled: pane.scrollTop > 0, visible: rect.bottom > viewport.top && rect.top < viewport.bottom };
    }, mode)).toEqual({ scrolled: true, visible: true });
  });
}

test('invalid calls reject before navigation and simultaneous calls do not replace the form', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFormDocument(page, 'viewer');
  expect(await page.evaluate(async () => {
    try { await (window as unknown as FormWindow).fakeFormMount.openTemplateForm({ targetId: 'fake-list', targetType: 'fake-wrong' }); }
    catch (error) { return (error as Error).message; }
  })).toContain('does not match');
  await expect(page.locator('.reusable-template-modal')).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as unknown as FormWindow;
    void w.fakeFormMount.openTemplateForm({ targetId: 'fake-list' }).then(result => { w.fakeFormResult = result; });
  });
  expect(await page.evaluate(async () => {
    try { await (window as unknown as FormWindow).fakeFormMount.openTemplateForm({ targetId: 'fake-list' }); }
    catch (error) { return (error as Error).message; }
  })).toContain('already open or opening');
  await expect(page.locator('.reusable-template-modal')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormResult)).toEqual({ status: 'cancelled' });
});

test('simultaneous forms stay bound to their own mounted documents', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFormDocument(page, 'viewer');
  await page.evaluate(async () => {
    const { mountHvy, deserializeDocumentBytes } = await import('/src/embed.ts');
    const w = window as unknown as FormWindow & { fakeSecondMount: HvyMount };
    document.body.style.display = 'flex';
    const root = document.createElement('div');
    root.id = 'fake-second-root';
    root.style.cssText = 'height:600px;width:390px';
    document.body.append(root);
    w.fakeSecondMount = mountHvy({ root, mode: 'viewer', document: deserializeDocumentBytes(w.fakeFormMount.serializeDocumentBytes(), '.hvy') });
    void w.fakeFormMount.openTemplateForm({ targetId: 'fake-list' }).then(result => { w.fakeFormResult = result; });
    void w.fakeSecondMount.openTemplateForm({ targetType: 'fake-entry' });
  });
  await expect(page.locator('.reusable-template-modal')).toHaveCount(2);
  await page.locator('#fake-form-root [data-template-variable="title"]').fill('Fake first item');
  await page.locator('#fake-form-root .reusable-template-modal').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('#fake-second-root .reusable-template-modal')).toBeVisible();
  await page.locator('#fake-second-root [data-template-variable="title"]').fill('Fake second item');
  await page.locator('#fake-second-root .reusable-template-modal').getByRole('button', { name: 'Add', exact: true }).click();
  expect(await page.evaluate(() => {
    const w = window as unknown as FormWindow & { fakeSecondMount: HvyMount };
    return [w.fakeFormMount.exportDocumentSourceMarkdown(), w.fakeSecondMount.exportDocumentSourceMarkdown()];
  })).toEqual([expect.stringContaining('Fake first item'), expect.stringContaining('Fake second item')]);
  expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.exportDocumentSourceMarkdown())).not.toContain('Fake second item');
});

test('destroy during reveal cancels the pending form without reopening it', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFormDocument(page, 'editor');
  expect(await page.evaluate(async () => {
    const mount = (window as unknown as FormWindow).fakeFormMount;
    const result = mount.openTemplateForm({ targetId: 'fake-list' });
    // Let the call begin its asynchronous reveal, then destroy the mount.
    await Promise.resolve();
    await Promise.resolve();
    mount.destroy();
    return result;
  })).toEqual({ status: 'cancelled' });
  await expect(page.locator('#fake-form-root')).toBeEmpty();
});

test('the existing list add button still opens the shared form after host cancellation', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFormDocument(page, 'ai');
  await page.evaluate(() => { void (window as unknown as FormWindow).fakeFormMount.openTemplateForm({ targetId: 'fake-list' }); });
  await expect(page.locator('.reusable-template-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('[data-action="add-component-list-item"]').first().click();
  await expect(page.locator('.reusable-template-modal')).toBeVisible();
  await page.locator('[data-template-variable="title"]').fill('Fake button item');
  await page.locator('.reusable-template-modal').getByRole('button', { name: 'Add', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as FormWindow).fakeFormMount.exportDocumentSourceMarkdown())).toContain('Fake button item');
});
