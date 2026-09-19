import { expect, test, type Page } from '@playwright/test';

async function loadGroupExample(page: Page, text = 'Fake Blue', withDefinitions = true) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: fake-record
    baseType: text
${withDefinitions ? `    sortValueDefs:
      Category: {type: text}
    groupValueDefs:
      Category: {type: text}
      Status:
        type: enum
        options:
          - {label: Fake Ready, value: ready}
          - {label: Fake Waiting, value: waiting}` : ''}
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

 <!--hvy:component-list {"id":"fake-list","componentListComponent":"fake-record","componentListDefaultGroupKey":"Category"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:fake-record {"id":"fake-item","groupKeys":{"Category":"Fake Manual"}}-->
    ${text}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
}

test('a manually grouped item offers inline key creation without predefined value definitions', async ({ page }) => {
  test.setTimeout(5000);
  await loadGroupExample(page, 'Fake Blue', false);
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).first().click({ position: { x: 4, y: 4 } });
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).last().dispatchEvent('click');
  const editor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(editor).toBeFocused();
  await selectContents(page, '.editor-block[data-active-editor-block="true"] .rich-editor p');
  await page.getByRole('button', { name: 'Use as...' }).click();
  await expect(page.getByRole('menuitem', { name: 'Create group key…', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Create group key…', exact: true }).click();
  const form = page.getByRole('form', { name: 'Create automatic value' });
  await form.getByRole('textbox', { name: 'Key name', exact: true }).pressSequentially('Category');
  await expect(form.getByRole('textbox', { name: 'Key name', exact: true })).toBeFocused();
  await form.getByRole('button', { name: 'Create and use', exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(editor.locator('[data-value-kind="group"]')).toHaveText('Fake Blue');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks[0].schema.componentListBlocks[0].schema.groupKeys;
  })).toEqual({ Category: 'Fake Blue' });
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toContainText('groupValueDefs:');
  await expect(page.locator('#rawEditor')).toContainText('<!--hvy:group-value {"key":"Category"}-->Fake Blue<!--/hvy:group-value-->');
});

for (const layout of ['phone preview', 'narrow viewport']) {
test(`inline key creation supports cancellation, duplicate names, and enum options in a ${layout}`, async ({ page }, testInfo) => {
  test.setTimeout(5000);
  if (layout === 'narrow viewport') await page.setViewportSize({ width: 390, height: 844 });
  await loadGroupExample(page);
  if (layout === 'phone preview') await page.getByRole('button', { name: 'Phone 390', exact: true }).click();
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).first().click({ position: { x: 4, y: 4 } });
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).last().dispatchEvent('click');
  const editor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(editor).toBeFocused();
  await selectContents(page, '.editor-block[data-active-editor-block="true"] .rich-editor p');
  await page.getByRole('button', { name: 'Use as...' }).click();
  await page.getByRole('menuitem', { name: 'Create group key…', exact: true }).click();
  const form = page.getByRole('form', { name: 'Create automatic value' });
  await form.getByRole('textbox', { name: 'Key name', exact: true }).fill('Category');
  await form.getByRole('button', { name: 'Create and use' }).click();
  await expect(form.getByRole('alert')).toContainText('already exists');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Group: Category', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Create group key…', exact: true }).click();
  await form.getByRole('textbox', { name: 'Key name', exact: true }).fill('Fake Choice');
  await form.getByLabel('Value type', { exact: true }).selectOption('enum');
  await form.getByRole('textbox', { name: 'Options (one per line)' }).fill('Fake Blue\nFake Green');
  await expect(form.getByRole('textbox', { name: 'Options (one per line)' })).toBeFocused();
  const bounds = await page.locator('.text-use-as-selection.is-use-as-open .text-use-as-menu').boundingBox();
  const frame = await page.locator('.editor-pane').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(frame!.x);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
  expect(bounds!.y).toBeGreaterThanOrEqual(frame!.y);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
  await page.locator('.text-use-as-selection.is-use-as-open .text-use-as-menu').screenshot({ path: testInfo.outputPath('inline-group-creation.png') });
  await form.getByRole('button', { name: 'Create and use' }).click();
  const picker = editor.locator('select[data-value-kind="group"]');
  await expect(picker).toHaveValue('Fake Blue');
  await picker.selectOption('Fake Green');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks[0].schema.componentListBlocks[0].schema.groupKeys['Fake Choice'];
  })).toBe('Fake Green');
});
}

test('inline sort key creation uses an explicit date format and is immediately reusable', async ({ page }) => {
  test.setTimeout(5000);
  await loadGroupExample(page, '27/09/2026', false);
  await page.locator('.editor-block-passive', { hasText: '27/09/2026' }).first().click({ position: { x: 4, y: 4 } });
  await page.locator('.editor-block-passive', { hasText: '27/09/2026' }).last().dispatchEvent('click');
  const editor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(editor).toBeFocused();
  await selectContents(page, '.editor-block[data-active-editor-block="true"] .rich-editor p');
  await page.getByRole('button', { name: 'Use as...' }).click();
  await page.getByRole('menuitem', { name: 'Create sort key…', exact: true }).click();
  const form = page.getByRole('form', { name: 'Create automatic value' });
  await form.getByRole('textbox', { name: 'Key name', exact: true }).fill('Fake Date');
  await form.getByLabel('Value type', { exact: true }).selectOption('date');
  await form.getByLabel('Date format', { exact: true }).selectOption('DD/MM/YYYY');
  await form.getByRole('button', { name: 'Create and use' }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks[0].schema.componentListBlocks[0].schema.sortKeys;
  })).toEqual({ 'Fake Date': '2026-09-27' });
  await selectContents(page, '.rich-editor [data-value-kind="sort"]');
  await page.getByRole('button', { name: 'Use as...' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sort: Fake Date', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Create sort key…', exact: true }).click();
  await form.getByRole('textbox', { name: 'Key name', exact: true }).press('Escape');
  await expect(form).toBeHidden();
  await expect(editor).toBeFocused();
  expect(await editor.evaluate(() => window.getSelection()?.toString())).toBe('27/09/2026');
});

async function selectContents(page: Page, selector: string) {
  await page.locator(selector).evaluate((node) => {
    (node.closest('.rich-editor') as HTMLElement)?.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

test('Use as offers explicit sort and group keys and group typing preserves focus and serialization', async ({ page }) => {
  test.setTimeout(5000);
  await loadGroupExample(page);
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).first().click({ position: { x: 4, y: 4 } });
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).last().dispatchEvent('click');
  await page.waitForFunction(async () => !(await import('/src/state.ts')).state.pendingEditorActivation, null, { timeout: 1000 });
  const editor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(editor).toBeFocused();
  await selectContents(page, '.editor-block[data-active-editor-block="true"] .rich-editor p');
  await page.getByRole('button', { name: 'Use as...' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sort: Category', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Group: Category', exact: true }).click();
  await expect(editor.locator('[data-value-kind="group"]')).toHaveText('Fake Blue');

  await selectContents(page, '.rich-editor [data-value-kind="group"]');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Fake Green');
  await expect(editor).toBeFocused();
  await expect(editor.locator('[data-value-kind="group"]')).toHaveText('Fake Green');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks[0].schema.componentListBlocks[0].schema.groupKeys;
  })).toEqual({ Category: 'Fake Green' });
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toContainText('<!--hvy:group-value {"key":"Category"}-->Fake Green<!--/hvy:group-value-->');
  await expect(page.locator('#rawEditor')).toContainText('"derivedGroupKeyNames":["Category"]');
});

test('group enum uses the existing picker and updates the group without losing focus', async ({ page }) => {
  await loadGroupExample(page, 'Status: <!--hvy:group-value {"key":"Status"}-->Fake Ready<!--/hvy:group-value-->');
  await page.locator('.editor-block-passive', { hasText: 'Status:' }).first().click({ position: { x: 4, y: 4 } });
  await page.locator('.editor-block-passive', { hasText: 'Status:' }).last().dispatchEvent('click');
  await page.waitForFunction(async () => !(await import('/src/state.ts')).state.pendingEditorActivation, null, { timeout: 1000 });
  const picker = page.locator('.editor-block[data-active-editor-block="true"] select[data-value-kind="group"]');
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .rich-editor')).toBeFocused();
  await picker.focus();
  await picker.selectOption('Fake Waiting');
  await expect(picker).toBeFocused();
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks[0].schema.componentListBlocks[0].schema.groupKeys.Status;
  })).toBe('waiting');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toContainText('<!--hvy:group-value {"key":"Status"}-->Fake Waiting<!--/hvy:group-value-->');
});

test('Use as inserts an enum group picker in the phone preview', async ({ page }) => {
  test.setTimeout(5000);
  await loadGroupExample(page);
  await page.getByRole('button', { name: 'Phone 390', exact: true }).click();
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).first().click({ position: { x: 4, y: 4 } });
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).last().dispatchEvent('click');
  await page.waitForFunction(async () => !(await import('/src/state.ts')).state.pendingEditorActivation, null, { timeout: 1000 });
  await selectContents(page, '.editor-block[data-active-editor-block="true"] .rich-editor p');
  await page.getByRole('button', { name: 'Use as...' }).click();
  await page.getByRole('menuitem', { name: 'Group: Status', exact: true }).click();
  const picker = page.locator('.editor-block[data-active-editor-block="true"] select[data-value-kind="group"]');
  await expect(picker).toHaveValue('Fake Ready');
  await picker.selectOption('Fake Waiting');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks[0].schema.componentListBlocks[0].schema.groupKeys.Status;
  })).toBe('waiting');
});

test('list settings define and rename group keys while retaining bindings and typing focus', async ({ page }) => {
  test.setTimeout(5000);
  await loadGroupExample(page, '<!--hvy:group-value {"key":"Category"}-->Fake Blue<!--/hvy:group-value-->');
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.locator('.editor-block-passive', { hasText: 'Fake Blue' }).first().click({ position: { x: 4, y: 4 } });
  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="open-component-meta"]').click();
  const settings = page.locator('.component-meta-modal');
  const groups = settings.getByRole('region', { name: 'Group Values', exact: true });
  await groups.locator('.component-sort-value-summary').first().click();
  const name = groups.getByLabel('Group key name').first();
  await name.fill('');
  await name.pressSequentially('Fake Category');
  await expect(name).toBeFocused();
  await expect(groups.locator('summary').first()).toContainText('Fake Category');
  await groups.getByRole('button', { name: 'Add Group Value', exact: true }).click();
  const added = groups.locator('.component-sort-value-card').last();
  await added.getByLabel('Group key name').fill('Fake Team');
  await added.locator('[data-field="def-sort-value-type"]').selectOption('enum');
  await added.getByRole('button', { name: 'Add Option', exact: true }).click();
  await added.getByLabel('Label', { exact: true }).fill('Fake One');
  await added.getByLabel('Value', { exact: true }).fill('123');
  await settings.locator('[data-modal-action="close"]').click();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toContainText('<!--hvy:group-value {"key":"Fake Category"}-->Fake Blue<!--/hvy:group-value-->');
  await expect(page.locator('#rawEditor')).toContainText('"componentListDefaultGroupKey":"Fake Category"');
  await expect(page.locator('#rawEditor')).toContainText('value: "123"');
});
