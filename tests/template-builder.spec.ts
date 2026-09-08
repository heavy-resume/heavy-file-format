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
  await modal.getByRole('button', { name: 'Find 2' }).click();
  await expect(modal.locator('.template-value-token').nth(1)).toHaveClass(/is-found/);
  await modal.getByRole('button', { name: 'Convert occurrence 2 to text' }).click();
  await expect(modal.locator('.template-value-token')).toHaveCount(1);
  await expect(editor).toContainText('Expected title');
  await modal.locator('[data-field="builder-flavor-picker"]').selectOption('new');
  await expect(modal.locator('[data-field="builder-flavor-name"]')).toHaveValue('fake-card 2');
  await expect(modal.locator('[data-field="builder-flavor-picker"]')).toHaveValue('0');
  await modal.getByRole('button', { name: 'Save Template' }).click();

  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return Array.isArray(state.document.meta.component_defs) ? state.document.meta.component_defs.length : 0;
  })).toBe(originalCount + 1);
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
