import { expect, test } from '@playwright/test';

const NESTED_BLOCK_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"nested-window-section"}-->
#! Nested Window Section

<!--hvy:container {"id":"nested-window-container","containerTitle":"Nested container"}-->
${Array.from({ length: 120 }, (_item, index) => ` <!--hvy:text {"id":"container-window-block-${index + 1}"}-->
  Container window block ${index + 1}: ${'content '.repeat(8)}
`).join('\n')}

<!--hvy:grid {"id":"nested-window-grid","gridColumns":3}-->
${Array.from({ length: 120 }, (_item, index) => ` <!--hvy:grid:${index} {"id":"nested-window-cell-${index + 1}"}-->
  <!--hvy:text {"id":"grid-window-block-${index + 1}"}-->
   Grid window block ${index + 1}: ${'content '.repeat(8)}
`).join('\n')}
`;

const NESTED_COLLECTION_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"nested-collection-section"}-->
#! Nested Collection Section

<!--hvy:component-list {"id":"nested-component-list","componentListComponent":"text"}-->
${Array.from({ length: 100 }, (_item, index) => ` <!--hvy:component-list:${index} {"id":"nested-list-item-${index + 1}"}-->
  <!--hvy:text {"id":"nested-list-block-${index + 1}"}-->
   Nested list block ${index + 1}
`).join('\n')}

<!--hvy:expandable {"id":"nested-expandable","expandableExpanded":true}-->
 <!--hvy:expandable:stub {}-->
  <!--hvy:text {"id":"nested-expandable-stub"}-->
   Expandable summary
 <!--hvy:expandable:content {}-->
${Array.from({ length: 100 }, (_item, index) => `  <!--hvy:text {"id":"nested-expandable-block-${index + 1}"}-->
   Nested expandable block ${index + 1}
`).join('\n')}
`;

async function loadNestedBlockDocument(
  page: import('@playwright/test').Page,
  source = NESTED_BLOCK_DOCUMENT
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click({ timeout: 1000 });
  await page.locator('#rawEditor').evaluate((rawEditor, value) => {
    rawEditor.value = value;
    rawEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
  }, source);
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 1000 });
}

test('before, scroll and search, after: nested reader collections keep only visible children mounted', async ({ page }) => {
  test.setTimeout(5000);
  await loadNestedBlockDocument(page);
  await page.getByRole('button', { name: 'Viewer' }).click({ timeout: 1000 });

  const reader = page.locator('#readerDocument');
  await expect.poll(() => reader.locator('[data-hvy-virtual-kind="reader-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  await expect.poll(() => reader.locator('[data-hvy-virtual-kind="reader-block"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await reader.locator('.reader-block').count()).toBeLessThan(240);

  await expect.poll(() => reader.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return Array.from(element.querySelectorAll('.reader-block')).some((block) => block.textContent?.includes('Grid window block 120:'));
  }), { timeout: 1000 }).toBe(true);
  await expect(reader.locator('#grid-window-block-120')).toBeVisible({ timeout: 1000 });

  await reader.evaluate((element) => { element.scrollTop = 0; });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Container window block 120:', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });
  await expect(reader.locator('#container-window-block-120')).toBeVisible({ timeout: 1000 });
  expect(await reader.locator('.reader-block').count()).toBeLessThan(240);
});

test('before, search and edit, after: nested editor collections materialize the target without mounting every child', async ({ page }) => {
  test.setTimeout(5000);
  await loadNestedBlockDocument(page);
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });

  const editor = page.locator('#editorTree');
  await expect.poll(() => editor.locator('[data-hvy-virtual-kind="editor-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  await expect.poll(() => editor.locator('[data-hvy-virtual-kind="editor-block"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await editor.locator('.editor-block-passive').count()).toBeLessThan(240);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Grid window block 120:', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });

  const target = editor.locator('.editor-block-passive.is-temp-highlighted');
  await expect(target).toBeVisible({ timeout: 1000 });
  await target.click({ timeout: 1000 });
  await expect(editor.locator('.editor-block[data-active-editor-block="true"]', { hasText: 'Grid window block 120:' }).last()).toBeVisible({ timeout: 1000 });
});

test('before, switch surfaces, after: component lists and expandable panes share nested block windows', async ({ page }) => {
  test.setTimeout(5000);
  await loadNestedBlockDocument(page, NESTED_COLLECTION_DOCUMENT);
  await page.getByRole('button', { name: 'Viewer' }).click({ timeout: 1000 });

  const reader = page.locator('#readerDocument');
  await expect.poll(() => reader.locator('.reader-component-list [data-hvy-virtual-kind="reader-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  await expect.poll(() => reader.locator('.expand-content [data-hvy-virtual-kind="reader-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Editor' }).click({ timeout: 1000 });
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });
  const editor = page.locator('#editorTree');
  await expect.poll(() => editor.locator('.reader-component-list [data-hvy-virtual-kind="editor-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  await expect.poll(() => editor.locator('.expand-content [data-hvy-virtual-kind="editor-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
});
