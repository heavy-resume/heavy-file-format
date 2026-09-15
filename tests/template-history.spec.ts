import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: fake-card
    baseType: text
    template:
      id: fake-template-root
      text: "Fake original {% fake-value | text %}"
      schema:
        component: text
section_defs:
  - name: fake-section
    template:
      key: fake-section-root
      title: Fake section title
      level: 1
      blocks: []
      children: []
---

#! Fake body

Fake body text.

<!--hvy:fake-card {"id":"fake-instance"}-->
Fake instance override.
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
});

for (const kind of ['component', 'section']) {
  test(`${kind} draft undo/redo stays isolated and restores focused names`, async ({ page }) => {
    test.setTimeout(5_000);
    const documentHistory = await page.evaluate(async () => {
      const { state } = await import('/src/state.ts');
      return { history: [...state.history], future: [...state.future] };
    });
    await page.locator(`[data-action="open-reusable-definition-editor"][data-template-kind="${kind}"]`).click();
    const modal = page.locator('.reusable-definition-modal');
    const name = modal.locator('[data-field="builder-definition-name"]');
    await name.fill('fake-renamed');
    await name.press('ControlOrMeta+z');
    await expect(name).toHaveValue(kind === 'component' ? 'fake-card' : 'fake-section');
    await expect(name).toBeFocused();
    await name.press('ControlOrMeta+Shift+z');
    await expect(name).toHaveValue('fake-renamed');
    await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
    await expect(name).toHaveValue(kind === 'component' ? 'fake-card' : 'fake-section');
    await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
    await expect(modal).toBeVisible();
    await expect(name).toBeFocused();
    await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
    await expect(name).toHaveValue('fake-renamed');
    expect(await page.evaluate(async () => {
      const { state } = await import('/src/state.ts');
      return { history: [...state.history], future: [...state.future] };
    })).toEqual(documentHistory);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator(`[data-action="open-reusable-definition-editor"][data-template-kind="${kind}"]`).click();
    await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
    await expect(name).toHaveValue(kind === 'component' ? 'fake-card' : 'fake-section');
  });
}

test('typing, structural edits, native history events and host controls share draft history', async ({ page }) => {
  test.setTimeout(5_000);
  await page.locator('[data-action="open-reusable-definition-editor"][data-template-kind="component"]').click();
  const modal = page.locator('.reusable-definition-modal');
  const type = modal.locator('[data-field="builder-template-variable-type"]');
  await type.selectOption('block');
  await modal.locator('.editor-block-passive').click();
  const editor = modal.locator('.rich-editor[data-field="block-rich"]');
  await expect.poll(() => page.evaluate(async () => (await import('/src/state.ts')).state.pendingEditorActivation)).toBeNull();
  await editor.evaluate(editable => {
    editable.focus();
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.pressSequentially(' fake typing');
  await expect(editor).toBeFocused();
  await expect(editor).toContainText('fake typing');
  await editor.press('ControlOrMeta+z');
  await expect(editor).not.toContainText('fake typing');
  await expect(type).toHaveValue('block');
  await expect(editor).toBeFocused();
  await editor.evaluate(element => element.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true, cancelable: true, inputType: 'historyRedo',
  })));
  await expect(editor).toContainText('fake typing');
  await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
  await expect(editor).not.toContainText('fake typing');
  await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
  await expect(type).toHaveValue('text');
  await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
  await expect(type).toHaveValue('block');
  await modal.locator('[data-field="builder-definition-name"]').fill('fake-new-branch');
  await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
  await expect(modal.locator('[data-field="builder-definition-name"]')).toHaveValue('fake-new-branch');
  await expect(modal).not.toContainText('fake typing');
});

test('saving a draft with multiple edits produces one document undo step', async ({ page }) => {
  test.setTimeout(5_000);
  await page.evaluate(async () => (await import('/src/reference-document-dirty.ts')).resetReferenceDocumentDirtyBaseline());
  const before = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return (await import('/src/serialization.ts')).serializeDocument(state.document);
  });
  await page.locator('[data-action="open-reusable-definition-editor"][data-template-kind="component"]').click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.locator('[data-field="builder-template-variable-type"]').selectOption('block');
  await modal.locator('[data-field="builder-definition-name"]').fill('fake-saved-name');
  await modal.getByRole('button', { name: 'Save Template', exact: true }).click();
  await expect(page.locator('[data-reference-save-state]')).toHaveText('Unsaved');
  await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
  expect(await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return (await import('/src/serialization.ts')).serializeDocument(state.document);
  })).toBe(before);
  await expect(page.locator('[data-reference-save-state]')).toHaveText('Saved');
  await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
  await expect(page.locator('.component-def[data-template-kind="component"]')).toContainText('fake-saved-name');
});

test('flavor creation, pending fields and flavor edits use the same draft history', async ({ page }) => {
  test.setTimeout(5_000);
  await page.locator('[data-action="open-reusable-definition-editor"][data-template-kind="component"]').click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.getByRole('button', { name: 'Add Flavor', exact: true }).click();
  const creatorName = page.locator('[data-field="builder-flavor-creator-name"]');
  const originalName = await creatorName.inputValue();
  await creatorName.fill('fake-flavor');
  await creatorName.press('ControlOrMeta+z');
  await expect(creatorName).toHaveValue(originalName);
  await creatorName.press('ControlOrMeta+Shift+z');
  await expect(creatorName).toHaveValue('fake-flavor');
  await page.getByRole('button', { name: 'Create Flavor', exact: true }).click();
  await expect(modal.locator('[data-field="builder-flavor-name"]')).toHaveValue('fake-flavor');
  await modal.locator('[data-field="builder-template-variable-type"]').selectOption('block');
  await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
  await expect(modal.locator('[data-field="builder-template-variable-type"]')).toHaveValue('text');
  await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
  await expect(creatorName).toHaveValue('fake-flavor');
  await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
  await expect(modal.locator('[data-field="builder-flavor-name"]')).toHaveValue('fake-flavor');
  await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
  await expect(modal.locator('[data-field="builder-template-variable-type"]')).toHaveValue('block');
});

test('draft undo preserves scrolling and typing can continue after restoring the caret', async ({ page }) => {
  test.setTimeout(5_000);
  await page.locator('[data-action="open-reusable-definition-editor"][data-template-kind="component"]').click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.locator('.editor-block-passive').click();
  const editor = modal.locator('.rich-editor[data-field="block-rich"]');
  await editor.fill('Fake paragraph.\n\n'.repeat(60));
  const name = modal.locator('[data-field="builder-definition-name"]');
  await name.focus();
  await name.evaluate(input => input.setSelectionRange(4, 4));
  await name.pressSequentially('Z');
  await expect(name).toHaveValue('fakeZ-card');
  const scrollTop = await modal.locator('.reusable-definition-scroll-body').evaluate(body => {
    body.scrollTop = 200;
    return body.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
  await expect(modal.locator('[data-field="builder-definition-name"]')).toHaveValue('fake-card');
  await expect.poll(() => modal.locator('.reusable-definition-scroll-body').evaluate(body => body.scrollTop)).toBe(scrollTop);
  expect(await name.evaluate(input => input.selectionStart)).toBe(4);
  await name.pressSequentially('Q');
  await expect(name).toHaveValue('fakeQ-card');
});

test('template drafts update document instances only on save and undo restores their overrides', async ({ page }) => {
  test.setTimeout(5_000);
  const instanceText = () => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks.find(block => block.schema.component === 'fake-card')?.text;
  });
  expect(await instanceText()).toBe('Fake instance override.');
  const edit = page.locator('[data-action="open-reusable-definition-editor"][data-template-kind="component"]');
  const modal = page.locator('.reusable-definition-modal');
  await edit.click();
  await modal.getByRole('button', { name: 'Save Template', exact: true }).click();
  expect(await instanceText()).toBe('Fake instance override.');

  await edit.click();
  await modal.locator('.editor-block-passive').click();
  await modal.locator('.rich-editor[data-field="block-rich"]').fill('Fake draft text');
  expect(await instanceText()).toBe('Fake instance override.');
  await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
  expect(await instanceText()).toBe('Fake instance override.');
  await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
  await expect(modal.locator('.rich-editor[data-field="block-rich"]')).toHaveText('Fake draft text');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await instanceText()).toBe('Fake instance override.');

  await edit.click();
  await modal.locator('.editor-block-passive').click();
  await modal.locator('.rich-editor[data-field="block-rich"]').fill('Fake saved text');
  await modal.getByRole('button', { name: 'Save Template', exact: true }).click();
  expect(await instanceText()).toBe('Fake saved text');
  await page.evaluate(async () => (await import('/src/history.ts')).undoStateAsync());
  expect(await instanceText()).toBe('Fake instance override.');
  await page.evaluate(async () => (await import('/src/history.ts')).redoStateAsync());
  expect(await instanceText()).toBe('Fake saved text');
});

test('undo commits a pending template-value rename before stepping back', async ({ page }) => {
  test.setTimeout(5_000);
  await page.locator('[data-action="open-reusable-definition-editor"][data-template-kind="component"]').click();
  const name = page.locator('[data-field="builder-template-variable-name"]');
  await name.fill('fake-renamed-value');
  await name.press('ControlOrMeta+z');
  await expect(name).toHaveValue('fake-value');
  await name.press('ControlOrMeta+Shift+z');
  await expect(name).toHaveValue('fake-renamed-value');
});
