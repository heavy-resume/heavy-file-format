import { expect, test } from '@playwright/test';

const NESTED_BLOCK_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"nested-window-section"}-->
#! Nested Window Section

<!--hvy:container {"id":"nested-window-container","containerTitle":"Nested container"}-->
${Array.from({ length: 400 }, (_item, index) => ` <!--hvy:text {"id":"container-window-block-${index + 1}"}-->
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
${Array.from({ length: 400 }, (_item, index) => ` <!--hvy:component-list:${index} {"id":"nested-list-item-${index + 1}"}-->
  <!--hvy:text {"id":"nested-list-block-${index + 1}"}-->
   Nested list block ${index + 1}
`).join('\n')}

<!--hvy:expandable {"id":"nested-expandable","expandableExpanded":true}-->
 <!--hvy:expandable:stub {}-->
  <!--hvy:text {"id":"nested-expandable-stub"}-->
   Expandable summary
 <!--hvy:expandable:content {}-->
${Array.from({ length: 400 }, (_item, index) => `  <!--hvy:text {"id":"nested-expandable-block-${index + 1}"}-->
   Nested expandable block ${index + 1}
`).join('\n')}
`;

const COLLAPSED_CARD_LIST_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"collapsed-card-section"}-->
#! Collapsed Card Section

<!--hvy:component-list {"id":"collapsed-card-list","componentListComponent":"expandable"}-->
${Array.from({ length: 100 }, (_item, index) => ` <!--hvy:component-list:${index} {"id":"collapsed-card-item-${index + 1}"}-->
  <!--hvy:expandable {"id":"collapsed-card-${index + 1}"}-->
   <!--hvy:expandable:stub {}-->
    <!--hvy:text {"id":"collapsed-card-stub-${index + 1}"}-->
     Collapsed card ${index + 1}
   <!--hvy:expandable:content {}-->
    <!--hvy:text {"id":"collapsed-card-report-${index + 1}"}-->
     ${'Long hidden report text. '.repeat(160)}
`).join('\n')}
`;

const TALL_CARD_LIST_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"tall-card-section"}-->
#! Tall Card Section

<!--hvy:component-list {"id":"tall-card-list","componentListComponent":"text"}-->
${Array.from({ length: 100 }, (_item, index) => ` <!--hvy:component-list:${index} {"id":"tall-card-item-${index + 1}"}-->
  <!--hvy:text {"id":"tall-card-${index + 1}","css":"min-height: 320px; margin: 0;"}-->
   Tall card ${index + 1}
`).join('\n')}
`;

const MIXED_CARD_CONTAINER_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"mixed-card-section"}-->
#! Mixed Card Section

<!--hvy:container {"id":"mixed-card-container"}-->
${Array.from({ length: 100 }, (_item, index) => (index < 10 || index >= 90
  ? ` <!--hvy:text {"id":"mixed-card-${index + 1}","css":"min-height: 320px; margin: 0;"}-->
  Mixed tall card ${index + 1}
`
  : ` <!--hvy:expandable {"id":"mixed-card-${index + 1}"}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"mixed-stub-${index + 1}"}-->
    Mixed short card ${index + 1}
  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"mixed-report-${index + 1}"}-->
    Hidden report
`)).join('\n')}
`;

async function loadNestedBlockDocument(
  page: import('@playwright/test').Page,
  source = NESTED_BLOCK_DOCUMENT
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click({ timeout: 1000 });
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
  expect(await reader.locator('.reader-block').count()).toBeLessThan(260);

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
  expect(await reader.locator('.reader-block').count()).toBeLessThan(260);
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
  expect(await editor.locator('.editor-block-passive').count()).toBeLessThan(260);

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

test('before, scroll, after: a component list of collapsed expandable cards renders visible cards and hydrates the rest', async ({ page }) => {
  test.setTimeout(5000);
  await loadNestedBlockDocument(page, COLLAPSED_CARD_LIST_DOCUMENT);
  await page.getByRole('button', { name: 'Viewer' }).click({ timeout: 1000 });

  const reader = page.locator('#readerDocument');
  await expect(reader.locator('#collapsed-card-stub-1')).toBeVisible({ timeout: 1000 });
  const placeholderHeights = await reader.locator('.reader-component-list > [data-hvy-virtual-kind="reader-block-range"]')
    .evaluateAll((placeholders) => placeholders.map((placeholder) => placeholder.getBoundingClientRect().height));
  expect(Math.max(0, ...placeholderHeights)).toBeLessThan(5000);

  await expect.poll(() => reader.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.querySelector('#collapsed-card-stub-100') !== null;
  }), { timeout: 1000 }).toBe(true);
  await expect(reader.locator('#collapsed-card-stub-100')).toBeVisible({ timeout: 1000 });

  await page.getByRole('button', { name: 'Editor' }).click({ timeout: 1000 });
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });
  const editor = page.locator('#editorTree');
  await expect.poll(() => editor.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.querySelector('#collapsed-card-stub-100') !== null;
  }), { timeout: 1000 }).toBe(true);
});

test('before, render, after: unrendered list items are sized like their rendered neighbors before any scrolling', async ({ page }) => {
  test.setTimeout(5000);
  await loadNestedBlockDocument(page, TALL_CARD_LIST_DOCUMENT);
  await page.getByRole('button', { name: 'Viewer' }).click({ timeout: 1000 });

  const reader = page.locator('#readerDocument');
  await expect(reader.locator('#tall-card-1')).toBeVisible({ timeout: 1000 });
  const list = reader.locator('.reader-component-list');
  await expect.poll(() => list.evaluate((element) => {
    const card = element.querySelector('[data-hvy-virtual-item="reader-block"]');
    const expectedListHeight = 100 * (card?.getBoundingClientRect().height ?? 0);
    return Math.abs(element.getBoundingClientRect().height - expectedListHeight) / expectedListHeight;
  }), { timeout: 1000 }).toBeLessThan(0.05);
});

test('before, search jump, after: placeholders filled in during the jump keep the document height and land on the target', async ({ page }) => {
  test.setTimeout(5000);
  await loadNestedBlockDocument(page, MIXED_CARD_CONTAINER_DOCUMENT);
  await page.getByRole('button', { name: 'Viewer' }).click({ timeout: 1000 });

  const reader = page.locator('#readerDocument');
  await expect(reader.locator('#mixed-card-1')).toBeVisible({ timeout: 1000 });
  await expect.poll(() => reader.locator('[data-hvy-virtual-kind="reader-block-range"]').count(), { timeout: 1000 }).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  const scrollHeightBeforeJump = await reader.evaluate((element) => element.scrollHeight);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Mixed tall card 95', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });

  await expect.poll(() => reader.evaluate((element) => {
    const target = element.querySelector('#mixed-card-95')?.getBoundingClientRect();
    const view = element.getBoundingClientRect();
    return Boolean(target && target.top >= view.top && target.top < view.bottom);
  }), { timeout: 2000 }).toBe(true);
  const scrollHeightAfterJump = await reader.evaluate((element) => element.scrollHeight);
  expect(Math.abs(scrollHeightAfterJump - scrollHeightBeforeJump)).toBeLessThan(40);
});
