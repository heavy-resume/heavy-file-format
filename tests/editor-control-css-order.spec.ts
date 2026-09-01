import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const editorCss = readFileSync(new URL('../src/editor/editor-form-controls.css', import.meta.url), 'utf8');
const formCss = readFileSync(new URL('../src/plugins/form.css', import.meta.url), 'utf8');

test('form plugin radio styling is independent of editor and plugin stylesheet order', async ({ page }) => {
  await page.goto('/');

  const measurements = await page.evaluate(({ editorCss, formCss }) => {
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => node.remove());
    document.body.innerHTML = `
      <div class="hvy-document">
        <div class="editor-block" style="width: 600px">
          <div class="hvy-form-plugin">
            <label class="hvy-form-radio-option">
              <input id="order-independent-radio" type="radio">Expected label
            </label>
          </div>
        </div>
      </div>`;

    const measure = (stylesheets: string[]) => {
      document.querySelectorAll('style').forEach((node) => node.remove());
      for (const css of stylesheets) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      }
      const input = document.querySelector<HTMLInputElement>('#order-independent-radio');
      const label = document.querySelector<HTMLElement>('.hvy-form-radio-option');
      if (!input || !label) throw new Error('Expected radio fixture was not rendered.');
      const computed = getComputedStyle(input);
      return {
        inputWidth: input.getBoundingClientRect().width,
        labelWidth: label.getBoundingClientRect().width,
        width: computed.width,
        padding: computed.padding,
        border: computed.border,
        background: computed.background,
      };
    };

    return {
      editorThenForm: measure([editorCss, formCss]),
      formThenEditor: measure([formCss, editorCss]),
    };
  }, { editorCss, formCss });

  expect(measurements.formThenEditor).toEqual(measurements.editorThenForm);
  expect(measurements.editorThenForm.inputWidth).toBeLessThan(40);
  expect(measurements.editorThenForm.labelWidth).toBeGreaterThan(measurements.editorThenForm.inputWidth + 20);
});

test('core editor controls receive ownership classes without marking plugin controls', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="controlOwnershipMount"></div>';
    const [{ mountHvy, plugins }, { createEmptyBlock, createEmptySection }] = await Promise.all([
      import('/src/embed-full.ts'),
      import('/src/document-factory.ts'),
    ]);
    const section = createEmptySection(1, 'Controls');
    const grid = createEmptyBlock('grid');
    grid.id = 'core-grid';
    const form = createEmptyBlock('plugin');
    form.id = 'plugin-form';
    form.schema.plugin = 'hvy.form';
    form.text = `fields:
  - label: Expected choice
    type: radio
    options:
      - label: First option
        value: first
      - label: Second option
        value: second`;
    section.blocks = [grid, form];
    const root = document.querySelector<HTMLElement>('#controlOwnershipMount');
    if (!root) throw new Error('Expected ownership test mount was not rendered.');
    mountHvy({
      root,
      document: {
        meta: { hvy_version: 0.1 },
        extension: '.hvy',
        attachments: [],
        sections: [section],
      },
      mode: 'editor',
      plugins: [plugins.form],
    });
  });

  await page.locator('.editor-block-passive[data-block-id="core-grid"]').click();
  const gridBlock = page.locator('.editor-block[data-block-id="core-grid"]');
  const gridColumns = gridBlock.locator('.editor-block-head .grid-columns-header-field');
  await expect(gridColumns.locator('.grid-columns-input')).toHaveClass(/hvy-editor-field-control/);
  await expect(gridBlock.locator('.component-editor-inline-content .grid-columns-input')).toHaveCount(0);
  expect(await gridColumns.evaluate((label) => getComputedStyle(label).display)).toBe('inline-flex');
  expect(await gridBlock.locator('.section-drag-title').evaluate((header) => (
    [...header.children].map((child) => child.className)
  ))).toEqual(['editor-order-controls', 'component-editor-header-controls', 'editor-block-title']);
  const gridColumnsInput = gridColumns.getByRole('spinbutton', { name: 'Grid Columns' });
  await expect(gridColumns.getByRole('button', { name: 'Increase grid columns' })).toBeVisible();
  await expect(gridColumns.getByRole('button', { name: 'Decrease grid columns' })).toBeVisible();
  expect(await gridColumnsInput.evaluate((input) => getComputedStyle(input).appearance)).toBe('textfield');
  const initialGridColumns = Number(await gridColumnsInput.inputValue());
  await gridColumns.getByRole('button', { name: 'Increase grid columns' }).click();
  await expect(gridColumnsInput).toHaveValue(String(initialGridColumns + 1));
  await gridColumns.getByRole('button', { name: 'Decrease grid columns' }).click();
  await expect(gridColumnsInput).toHaveValue(String(initialGridColumns));

  await page.locator('.editor-block-passive[data-block-id="plugin-form"]').click();
  const pluginBlock = page.locator('.editor-block[data-block-id="plugin-form"]');
  const pluginControls = pluginBlock.locator('.hvy-form-plugin :is(input, select, textarea)');
  await expect(pluginControls.first()).toBeVisible();
  expect(await pluginControls.evaluateAll((controls) => controls.every((control) =>
    !control.classList.contains('hvy-editor-field-control')
    && !control.classList.contains('hvy-editor-select-control')
  ))).toBe(true);
});
