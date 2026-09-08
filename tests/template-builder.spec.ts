import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Document Meta' }).waitFor();
});

test('component template builder creates tokens and flavors as one undoable edit', async ({ page }) => {
  test.setTimeout(5_000);
  const originalCount = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return Array.isArray(state.document.meta.component_defs) ? state.document.meta.component_defs.length : 0;
  });

  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'New Component Template' }).click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.locator('[data-field="builder-definition-name"]').fill('fake-card');
  await expect(modal.locator('[data-field="builder-definition-base-type"]')).toHaveCount(0);
  const modalBounds = await modal.boundingBox();
  const modalRootBounds = await page.locator('.modal-root').boundingBox();
  expect(modalBounds).not.toBeNull();
  expect(modalRootBounds).not.toBeNull();
  expect(modalBounds!.height / modalRootBounds!.height).toBeGreaterThan(0.9);
  const nameControlBounds = await modal.locator('[data-field="builder-definition-name"]').boundingBox();
  const addFlavorBounds = await modal.getByRole('button', { name: 'Add Flavor' }).boundingBox();
  expect(nameControlBounds).not.toBeNull();
  expect(addFlavorBounds).not.toBeNull();
  expect(Math.abs(
    (nameControlBounds!.y + nameControlBounds!.height / 2)
    - (addFlavorBounds!.y + addFlavorBounds!.height / 2)
  )).toBeLessThan(1);
  const componentSurfaceBounds = await modal.locator('.reusable-definition-hvy-surface').boundingBox();
  const templateValuesBounds = await modal.locator('.reusable-template-variable-panel').boundingBox();
  expect(componentSurfaceBounds).not.toBeNull();
  expect(templateValuesBounds).not.toBeNull();
  expect(templateValuesBounds!.y - (componentSurfaceBounds!.y + componentSurfaceBounds!.height)).toBeGreaterThan(100);
  expect(templateValuesBounds!.height).toBeLessThan(150);
  await modal.getByRole('button', { name: 'Section component type' }).click();
  await expect(modal.locator('.component-picker')).toHaveAttribute('data-open', 'true');
  await modal.locator('.component-picker-row-direct[data-component="text"]').click();
  await modal.getByRole('button', { name: 'Meta', exact: true }).click();
  await expect(page.locator('.component-meta-modal')).toContainText('Component Meta: fake-card');
  await page.locator('.component-meta-modal [data-modal-action="close"]').click();
  await expect(modal).toBeVisible();
  const editor = modal.locator('.rich-editor[data-field="block-rich"]');
  await editor.evaluate((editable) => {
    editable.innerHTML = '<p>Expected title</p>';
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT).nextNode();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editable.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  });
  await modal.getByRole('button', { name: 'Use as...' }).click();
  await modal.locator('[data-rich-action="template-value"]').evaluate((node) => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(modal.locator('.template-value-token')).toHaveText('{% expected-title | text %}');
  await expect(modal.locator('.template-value-token')).toHaveAttribute('data-template-value-display', 'Expected title · text');
  await modal.locator('[data-field="builder-template-variable-type"]').selectOption('block');
  await expect(modal.locator('.template-value-token')).toHaveText('{% expected-title | block %}');
  await expect(modal.locator('.template-value-token')).toHaveAttribute('data-template-value-display', 'Expected title · multi-line');
  await editor.evaluate((editable) => {
    editable.insertAdjacentHTML('beforeend', '<p>Repeated phrase</p>');
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent === 'Repeated phrase') textNode = walker.currentNode;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editable.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  });
  await modal.getByRole('button', { name: 'Use as...' }).click();
  await modal.locator('[data-rich-action="template-value"][data-template-variable-name="expected-title"]').evaluate((node) => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(modal.locator('.template-value-token')).toHaveCount(2);
  const variableName = modal.locator('[data-field="builder-template-variable-name"]');
  await variableName.fill('renamed-title');
  await variableName.press('Tab');
  await expect(modal.locator('.template-value-token')).toHaveText([
    '{% renamed-title | block %}',
    '{% renamed-title | block %}',
  ]);
  await expect(modal.getByText('Occurrences', { exact: true })).toHaveCount(0);
  await expect(modal.getByText('Optional AI value generator', { exact: true })).toBeVisible();
  await expect(modal.getByText('Button Label', { exact: true })).toHaveCount(0);
  await modal.locator('[data-field="builder-template-variable-generator"]').selectOption({ index: 1 });
  await expect(modal.getByText('Button Label', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { clearActiveEditorBlock } = await import('/src/block-ops.ts');
    const { getRenderApp } = await import('/src/state.ts');
    clearActiveEditorBlock();
    getRenderApp()();
  });
  await expect(modal.locator('.template-value-token').first()).toBeVisible();
  await expect(modal.locator('.template-value-token-source').first()).toBeHidden();
  expect(await modal.locator('.template-value-token').first().evaluate((marker) => getComputedStyle(marker).fontSize)).not.toBe('0px');
  const identityRow = modal.locator('.reusable-definition-identity');
  await expect(identityRow.locator('[data-field="builder-definition-name"]')).toBeVisible();
  await identityRow.getByRole('button', { name: 'Add Flavor' }).click();
  await expect(page.locator('.reusable-flavor-manager-modal')).toContainText('New fake-card Flavor');
  await expect(page.locator('[data-field="builder-flavor-creator-name"]')).toHaveValue('fake-card 2');
  await page.locator('[data-field="builder-flavor-creator-description"]').fill('A second fake card.');
  await page.getByRole('button', { name: 'Create Flavor' }).click();
  await expect(modal.locator('[data-field="builder-flavor-name"]')).toHaveValue('fake-card 2');
  await modal.getByRole('button', { name: 'Flavors…' }).click();
  const flavorManager = page.locator('.reusable-flavor-manager-modal');
  await expect(flavorManager.locator('[data-field="builder-flavor-manager-picker"]')).toHaveValue('0');
  await expect(flavorManager.locator('.reusable-flavor-preview')).toBeVisible();
  await expect(flavorManager.locator('[data-field="builder-flavor-manager-picker"] option[value="new"]')).toHaveText('Add Flavor…');
  await flavorManager.locator('[data-field="builder-flavor-manager-picker"]').selectOption('new');
  await expect(page.locator('[data-field="builder-flavor-creator-name"]')).toHaveValue('fake-card 3');
  await page.locator('.reusable-flavor-manager-modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await modal.getByRole('button', { name: 'Flavors…' }).click();
  await flavorManager.getByRole('button', { name: 'Edit Flavor' }).click();
  await modal.getByRole('button', { name: 'Save Template' }).click();

  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return Array.isArray(state.document.meta.component_defs) ? state.document.meta.component_defs.length : 0;
  })).toBe(originalCount + 1);
  const savedTemplateRow = page.locator('.component-def.template-def-row', { hasText: 'fake-card' });
  await expect(savedTemplateRow).toBeVisible();
  await expect(savedTemplateRow.getByRole('button', { name: 'Remove fake-card' })).toBeVisible();
  await expect(savedTemplateRow.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await expect(page.locator('details[data-template-kind="component"]')).toHaveCount(0);
  await page.evaluate(async () => {
    const { undoState } = await import('/src/history.ts');
    undoState();
  });
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return Array.isArray(state.document.meta.component_defs) ? state.document.meta.component_defs.length : 0;
  })).toBe(originalCount);
});

test('section template drafts cancel and component definitions stay in the visual builder', async ({ page }) => {
  test.setTimeout(5_000);
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'New Section Template' }).click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.locator('[data-field="builder-definition-name"]').fill('fake-section');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return (state.document.meta.section_defs ?? []).some((definition) => definition.name === 'fake-section');
  })).toBe(false);

  await page.getByRole('button', { name: 'New Component Template' }).click();
  await expect(modal.getByRole('button', { name: 'HVY', exact: true })).toHaveCount(0);
  await expect(modal.locator('#reusableDefinitionRawInput')).toHaveCount(0);
  await modal.getByRole('button', { name: 'Section component type' }).click();
  await modal.locator('.component-picker-row-direct[data-component="text"]').click();
  await expect(modal.locator('[data-field="builder-definition-base-type"]')).toHaveCount(0);
  await expect(modal.locator('.rich-editor')).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('component template root deletes back to the picker without section insertion controls', async ({ page }) => {
  test.setTimeout(5_000);

  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'New Component Template' }).click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.locator('[data-field="builder-definition-name"]').fill('fake-single-component');
  await modal.getByRole('button', { name: 'Section component type' }).click();
  await modal.locator('.component-picker-row-direct[data-component="text"]').click();

  await expect(modal.getByText('Insert Above', { exact: true })).toHaveCount(0);
  await expect(modal.getByText('Insert Below', { exact: true })).toHaveCount(0);
  await expect(modal).toHaveCSS('scrollbar-gutter', 'stable');

  await modal.locator('.editor-block-remove-button').click();
  await page.getByRole('dialog', { name: 'Confirm deletion?' }).getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(modal.getByRole('button', { name: 'Section component type' })).toBeVisible();
  await expect(modal.locator('.editor-block, .editor-block-passive')).toHaveCount(0);
});

test('advanced grid component picker stays inside the template modal', async ({ page }) => {
  test.setTimeout(5_000);
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'New Component Template' }).click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.getByRole('button', { name: 'Section component type' }).click();
  const templatePicker = modal.locator('.reusable-definition-empty-component .component-picker');
  await templatePicker.locator('.component-picker-row-category', { hasText: 'Containers' }).click();
  await templatePicker.locator('[data-picker-pane="containers"] .component-picker-row-leaf', { hasText: 'Grid' }).click();

  const gridPicker = modal.locator('.grid-add-ghost .component-picker').first();
  await gridPicker.locator('.component-picker-trigger').click();
  await gridPicker.locator('.component-picker-row-category', { hasText: 'Advanced' }).click();

  const modalBounds = await modal.boundingBox();
  const popoverBounds = await gridPicker.locator('.component-picker-popover').boundingBox();
  expect(modalBounds).not.toBeNull();
  expect(popoverBounds).not.toBeNull();
  expect(popoverBounds!.x).toBeGreaterThanOrEqual(modalBounds!.x + 7);
  expect(popoverBounds!.x + popoverBounds!.width).toBeLessThanOrEqual(modalBounds!.x + modalBounds!.width - 7);
});

test('template value markers support caret traversal and atomic deletion', async ({ page }) => {
  test.setTimeout(5_000);
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: fake-caret-template
    baseType: text
    templateVariables:
      first:
        label: First
      second:
        label: Second
    template:
      id: fake-caret-template
      text: "Before {% first | text %} middle {% second | text %}"
      schema:
        component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Template', exact: true }).click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.locator('.editor-block-passive').click();
  const editor = modal.locator('.rich-editor[data-field="block-rich"]');
  await expect(modal.getByRole('button', { name: 'Meta', exact: true })).toHaveCount(1);
  await expect(modal.locator('.template-value-token')).toHaveCount(2);

  await editor.evaluate((editable) => {
    const marker = editable.querySelector('.template-value-token');
    const precedingText = marker?.previousSibling;
    if (!(precedingText instanceof Text)) throw new Error('Expected text before the template value');
    (editable as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(precedingText, precedingText.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press('Delete');
  await expect(modal.locator('.template-value-token')).toHaveCount(1);

  await editor.evaluate((editable) => {
    const marker = editable.querySelector('.template-value-token');
    const precedingText = marker?.previousSibling;
    if (!(precedingText instanceof Text)) throw new Error('Expected text before the template value');
    (editable as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(precedingText, precedingText.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('r');
  await expect.poll(() => editor.evaluate((editable) => {
    const marker = editable.querySelector('.template-value-token');
    return marker?.nextSibling?.textContent?.replaceAll('\u200b', '') ?? '';
  })).toBe('r');
  await page.keyboard.press('Backspace');

  const editorBounds = await editor.boundingBox();
  expect(editorBounds).not.toBeNull();
  await page.mouse.click(editorBounds!.x + editorBounds!.width - 8, editorBounds!.y + 24);
  await page.keyboard.type('x');
  await expect(editor).toContainText('x');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(modal.locator('.template-value-token')).toHaveCount(0);
});

test('plugin template value forms update locally and preserve the active field', async ({ page }) => {
  const expectedResult = await page.evaluate(async () => {
    const { createBlankDocument, createEmptySectionWithMeta, defaultBlockSchema } = await import('/src/document-factory.ts');
    const { createPluginComponentTemplatesApi } = await import('/src/plugins/component-templates.ts');
    const { registerHostPlugin } = await import('/src/plugins/registry.ts');
    const documentValue = createBlankDocument();
    documentValue.meta.component_defs = [{
      name: 'fake-card',
      baseType: 'text',
      templateVariables: {
        title: { label: 'Title', generator: 'fake.generate-title' },
      },
      template: {
        id: 'fake-template',
        text: '{% title | text %}',
        schemaMode: false,
        schema: defaultBlockSchema('text'),
      },
    }];
    documentValue.sections = [createEmptySectionWithMeta(1, 'text', false, documentValue.meta)];
    registerHostPlugin({
      id: 'fake.generator',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      outputGenerators: [{
        key: 'fake.generate-title',
        generate: () => ({ answer: 'Generated title' }),
      }],
    });
    let changed = '';
    let observedLinks = 0;
    const api = createPluginComponentTemplatesApi({
      document: documentValue,
      section: documentValue.sections[0]!,
      sectionKey: documentValue.sections[0]!.key,
      blockId: 'plugin-block',
      helpers: {
        renderReaderBlock: (_section: unknown, block: { text: string }) => `<a href="https://example.invalid">${block.text}</a>`,
      } as never,
      observeLinks: () => { observedLinks += 1; },
      resolveGenerator: async (response) => response.answer ?? '',
    });
    const form = api.mountValues({
      template: 'fake-card',
      values: { title: '' },
      onChange: (values) => { changed = values.title; },
    });
    document.body.append(form.element);
    const input = form.element.querySelector<HTMLInputElement>('[data-template-variable="title"]')!;
    input.focus();
    input.value = 'Typed title';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const focusedAfterInput = document.activeElement === input;
    form.setValues({ title: 'Refreshed title' });
    const focusedAfterRefresh = document.activeElement === input;
    form.element.querySelector<HTMLButtonElement>('.template-generator-button')!.click();
    await new Promise((resolve) => window.setTimeout(resolve));
    const preview = api.render({ template: 'fake-card', values: { title: 'First title' } });
    const firstId = preview.getBlock().id;
    preview.update({ template: 'fake-card', values: { title: 'Second title' } });
    const result = {
      changed,
      focusedAfterInput,
      focusedAfterRefresh,
      value: form.getValues().title,
      renderedText: preview.element.textContent,
      freshRuntimeId: preview.getBlock().id !== firstId,
      observedLinks,
    };
    preview.unmount();
    form.unmount();
    return result;
  });

  expect(expectedResult).toEqual({
    changed: 'Generated title',
    focusedAfterInput: true,
    focusedAfterRefresh: true,
    value: 'Generated title',
    renderedText: 'Second title',
    freshRuntimeId: true,
    observedLinks: 2,
  });
});
