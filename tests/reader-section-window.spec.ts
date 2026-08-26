import { expect, test } from '@playwright/test';

test('before, full rerender, after: a large reader renders and restores only the visible section window', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click({ timeout: 1000 });
  await page.locator('#rawEditor').evaluate((rawEditor, value) => {
    rawEditor.value = value;
    rawEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
  }, `---
hvy_version: 0.1
---

${Array.from({ length: 60 }, (_item, index) => `<!--hvy: {"id":"reader-window-${index + 1}"}-->
#! Reader Window ${index + 1}

 ${Array.from({ length: 8 }, (_line, lineIndex) => `Reader window ${index + 1}.${lineIndex + 1}`).join('\n ')}
`).join('\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 1000 });
  await page.getByRole('button', { name: 'Viewer' }).click({ timeout: 1000 });

  const reader = page.locator('#readerDocument');
  await expect.poll(() => reader.locator('[data-hvy-virtual-placeholder="true"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await reader.locator('.reader-section').count()).toBeLessThan(60);
  await reader.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(reader.locator('.reader-section', { hasText: 'Reader window 60.8' })).toBeVisible({ timeout: 1000 });
  await reader.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const beforeRenderScrollTop = await reader.evaluate((element) => element.scrollTop);

  await page.getByRole('button', { name: 'App', exact: true }).click({ timeout: 1000 });
  await expect(reader.locator('.reader-section', { hasText: 'Reader window 60.8' })).toBeVisible({ timeout: 1000 });
  const afterRender = await reader.evaluate((element) => ({
    scrollTop: element.scrollTop,
    mountedSections: element.querySelectorAll('.reader-section').length,
    placeholders: element.querySelectorAll('[data-hvy-virtual-placeholder="true"]').length,
  }));

  expect(Math.abs(afterRender.scrollTop - beforeRenderScrollTop)).toBeLessThanOrEqual(2);
  expect(afterRender.mountedSections).toBeLessThan(60);
  expect(afterRender.placeholders).toBeGreaterThan(0);

  await reader.evaluate((element) => { element.scrollTop = 0; });
  await expect(reader.locator('.reader-section', { hasText: 'Reader window 60.8' })).toHaveCount(0, { timeout: 1000 });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Reader window 60.8', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });
  await expect(reader.locator('.reader-section', { hasText: 'Reader window 60.8' })).toBeVisible({ timeout: 1000 });
});

test('before, scroll, after: the lightweight viewer materializes its large reader window', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.evaluate(async (source) => {
    document.body.innerHTML = '<div id="embedded-reader-root" style="width: 60rem; height: 40rem;"></div>';
    const { deserializeDocumentBytes, mountHvyViewer } = await import(/* @vite-ignore */ '/src/embed.ts');
    mountHvyViewer({
      root: document.querySelector<HTMLElement>('#embedded-reader-root')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
    });
  }, `---
hvy_version: 0.1
---

${Array.from({ length: 60 }, (_item, index) => `<!--hvy: {"id":"embedded-reader-window-${index + 1}"}-->
#! Embedded Reader Window ${index + 1}

 Embedded reader window ${index + 1}
`).join('\n')}
`);

  const reader = page.locator('#embedded-reader-root #readerDocument');
  await expect.poll(() => reader.locator('[data-hvy-virtual-placeholder="true"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await reader.locator('.reader-section').count()).toBeLessThan(60);

  await reader.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(reader.locator('.reader-section', { hasText: 'Embedded reader window 60' })).toBeVisible({ timeout: 1000 });
});
