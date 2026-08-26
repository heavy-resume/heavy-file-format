import { expect, test } from '@playwright/test';

test('before, full rerender, after: a large editor renders and restores only the active section window', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click({ timeout: 1000 });
  await page.locator('#rawEditor').evaluate((rawEditor, value) => {
    rawEditor.value = value;
    rawEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
  }, `---
hvy_version: 0.1
---

${Array.from({ length: 60 }, (_item, index) => `<!--hvy: {"id":"window-${index + 1}"}-->
#! Window ${index + 1}

 ${Array.from({ length: 8 }, (_line, lineIndex) => `Window ${index + 1}.${lineIndex + 1}`).join('\n ')}
`).join('\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 1000 });
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });

  const editorTree = page.locator('#editorTree');
  await expect.poll(() => editorTree.locator('[data-hvy-virtual-placeholder="true"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await editorTree.locator('.editor-section-card:not(.editor-subsection-card)').count()).toBeLessThan(60);
  await editorTree.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(editorTree.locator('.editor-section-card', { hasText: 'Window 60' })).toBeVisible({ timeout: 1000 });
  await editorTree.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const beforeRenderScrollTop = await editorTree.evaluate((element) => element.scrollTop);

  await page.getByRole('button', { name: 'App', exact: true }).click({ timeout: 1000 });
  await expect(editorTree.locator('.editor-section-card', { hasText: 'Window 60' })).toBeVisible({ timeout: 1000 });
  const afterRender = await editorTree.evaluate((element) => ({
    scrollTop: element.scrollTop,
    mountedSections: element.querySelectorAll('.editor-section-card:not(.editor-subsection-card)').length,
    placeholders: element.querySelectorAll('[data-hvy-virtual-placeholder="true"]').length,
  }));

  expect(Math.abs(afterRender.scrollTop - beforeRenderScrollTop)).toBeLessThanOrEqual(2);
  expect(afterRender.mountedSections).toBeLessThan(60);
  expect(afterRender.placeholders).toBeGreaterThan(0);

  await editorTree.evaluate((element) => { element.scrollTop = 0; });
  await expect(editorTree.locator('.editor-section-card', { hasText: 'Window 60' })).toHaveCount(0, { timeout: 1000 });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Window 60.8', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });
  await expect(editorTree.locator('.editor-section-card', { hasText: 'Window 60.8' })).toBeVisible({ timeout: 1000 });
});
