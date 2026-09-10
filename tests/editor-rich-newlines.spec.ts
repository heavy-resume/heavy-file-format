import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test('expected result: new lines in an empty embedded text editor keep uniform paragraph spacing', async ({ page }) => {
  await page.goto('/examples/lightweight-viewer-text-editor.html');

  const editor = page.locator(
    '#lightweightViewerOnlyMount .hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]'
  ).first();
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('Candlewood Ridge remainder:');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Survey 1 - 50');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Survey 2 - 30');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Survey 3 - 30');

  const expectedResult = await editor.evaluate((node) => {
    const blocks = Array.from(node.children);
    const tops = blocks.map((block) => block.getBoundingClientRect().top);
    return {
      tags: blocks.map((block) => block.tagName),
      lineOffsets: tops.slice(1).map((top, index) => Number((top - tops[index]!).toFixed(2))),
    };
  });

  expect(expectedResult.tags).toEqual(['P', 'P', 'P', 'P']);
  expect(new Set(expectedResult.lineOffsets).size).toBe(1);
});

test('expected result: Done splits rich-text paragraphs and preserves configured blank-line spacing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
typography:
  paragraphSpacing: 0.6rem
---

<!--hvy: {"id":"paragraph-split"}-->
#! Paragraph split

<!--hvy:text {"id":"source-text"}-->
 First paragraph.
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'First paragraph.' }).click();

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  const editor = activeBlock.locator('.rich-editor[data-field="block-rich"]');
  await editor.fill('');
  await editor.type('Thing a mjib');
  await editor.press('Enter');
  await editor.press('Enter');
  await editor.type('Other hting');
  await editor.press('Enter');
  await editor.press('Enter');
  await editor.type('And another');
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0]!.blocks.length;
  })).toBe(1);
  await activeBlock.getByRole('button', { name: 'Done', exact: true }).click();

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0]!.blocks.map((block) => ({
      text: block.text,
      css: block.schema.css,
    }));
  });
  expect(expectedResult).toEqual([
    {
      text: 'Thing a mjib',
      css: 'margin: 0.5rem 0;',
    },
    {
      text: 'Other hting',
      css: 'margin-top: 0.7rem; margin-right: 0; margin-bottom: 0.5rem; margin-left: 0;',
    },
    {
      text: 'And another',
      css: 'margin-top: 0.7rem; margin-right: 0; margin-bottom: 0.5rem; margin-left: 0;',
    },
  ]);

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Other hting' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"]')
    .getByRole('button', { name: 'Meta' })
    .click();
  await expect(page.locator('.component-meta-modal [data-field="block-custom-css"]')).toHaveValue(
    'margin-top: 0.7rem; margin-right: 0; margin-bottom: 0.5rem; margin-left: 0;'
  );
  await page.locator('.component-meta-modal [data-modal-action="close"]').click();

  await page.getByRole('button', { name: 'Viewer' }).click();
  const renderedGaps = await page.locator('.reader-block').evaluateAll((blocks) => {
    return blocks.slice(1).map((block, index) => Number((
      block.getBoundingClientRect().top - blocks[index]!.getBoundingClientRect().bottom
    ).toFixed(1)));
  });
  expect(renderedGaps).toEqual([19.2, 19.2]);
});

test('expected result: paragraph spacing is editable as document configuration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  const paragraphSpacing = page.getByRole('textbox', { name: 'Paragraph Spacing' });
  await expect(paragraphSpacing).toHaveValue('0.45rem');
  await paragraphSpacing.fill('0.7rem');

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return {
      config: state.document.meta.typography,
      renderedValue: document.querySelector<HTMLElement>('.hvy-document')?.style
        .getPropertyValue('--hvy-document-paragraph-spacing'),
    };
  });
  expect(expectedResult).toEqual({
    config: { paragraphSpacing: '0.7rem' },
    renderedValue: '0.7rem',
  });
});

test('expected result: Done splits only at double newlines', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"newline-threshold"}-->
#! Newline threshold

<!--hvy:text {"id":"source-text"}-->
 Starting text
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Starting text' }).click();

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  const editor = activeBlock.locator('.rich-editor[data-field="block-rich"]');
  await editor.fill('');
  await editor.type('First line');
  await editor.press('Enter');
  await editor.type('Second line');
  await editor.press('Enter');
  await editor.press('Enter');
  await editor.type('Third line');
  await activeBlock.getByRole('button', { name: 'Done', exact: true }).click();

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0]!.blocks.map((block) => block.text);
  });
  expect(expectedResult).toEqual(['First line\n\nSecond line', 'Third line']);
});

test('expected result: Done splits text inside a subsection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"parent-section"}-->
#! Parent section

<!--hvy:subsection {"id":"nested-section"}-->
#! Nested section

<!--hvy:text {"id":"nested-text"}-->
 Starting text
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Starting text' }).click();

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  const editor = activeBlock.locator('.rich-editor[data-field="block-rich"]');
  await editor.fill('');
  await editor.type('First paragraph');
  await editor.press('Enter');
  await editor.press('Enter');
  await editor.type('Second paragraph');
  await activeBlock.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.locator('.editor-block-passive', { hasText: 'First paragraph' })).toBeVisible();
  await expect(page.locator('.editor-block-passive', { hasText: 'Second paragraph' })).toBeVisible();

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0]!.children[0]!.blocks.map((block) => block.text);
  });
  expect(expectedResult).toEqual(['First paragraph', 'Second paragraph']);
});

test('expected result: inserting text and pressing Done preserve editor scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"long-section"}-->
#! Long section

${Array.from({ length: 24 }, (_item, index) => `<!--hvy:text {"id":"spacer-${index + 1}"}-->\n Spacer ${index + 1}`).join('\n\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const editorTree = page.locator('#editorTree');
  const section = page.locator('.editor-section-card', { hasText: 'Long section' });
  const picker = section.locator('.compact-add-component-ghost .component-picker-trigger').last();
  await picker.scrollIntoViewIfNeeded();
  const beforeInsert = await editorTree.evaluate((node) => node.scrollTop);
  await picker.click();
  await section.locator('.component-picker[data-open="true"] .component-picker-row-direct[data-component="text"]').click();
  await expect.poll(() => editorTree.evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(beforeInsert - 2);

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  const editor = activeBlock.locator('.rich-editor[data-field="block-rich"]');
  await editor.type('First paragraph');
  await editor.press('Enter');
  await editor.press('Enter');
  await editor.type('Second paragraph');
  const beforeDone = await editorTree.evaluate((node) => node.scrollTop);
  await activeBlock.getByRole('button', { name: 'Done', exact: true }).click();

  const firstParagraph = section.locator('.editor-block-passive', { hasText: 'First paragraph' });
  await expect(firstParagraph).toBeVisible();
  await expect(section.locator('.editor-block-passive', { hasText: 'Second paragraph' })).toBeVisible();
  await expect.poll(() => editorTree.evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(beforeDone - 2);
});
