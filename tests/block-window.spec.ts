import { expect, test } from '@playwright/test';

const GIANT_BLOCK_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"giant-window-section"}-->
#! Giant Window Section

${Array.from({ length: 200 }, (_item, index) => `<!--hvy:text {"id":"giant-window-block-${index + 1}"}-->
 Giant window block ${index + 1}: ${'content '.repeat(8)}
`).join('\n')}

<!--hvy:plugin {"id":"giant-window-progress","plugin":"hvy.progress-bar","pluginConfig":{"min":0,"max":100,"value":77}}-->
 \`77%\`
`;

async function loadGiantBlockDocument(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click({ timeout: 1000 });
  await page.locator('#rawEditor').evaluate((rawEditor, value) => {
    rawEditor.value = value;
    rawEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
  }, GIANT_BLOCK_DOCUMENT);
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 1000 });
}

test('before, scroll and rerender, after: a giant reader section keeps only its block window mounted', async ({ page }) => {
  test.setTimeout(5000);
  await loadGiantBlockDocument(page);
  await page.getByRole('button', { name: 'Viewer' }).click({ timeout: 1000 });

  const reader = page.locator('#readerDocument');
  await expect.poll(() => reader.locator('[data-hvy-virtual-kind="reader-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await reader.locator('.reader-block').count()).toBeLessThan(200);
  await expect.poll(() => reader.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return Boolean(element.querySelector('.hvy-progress-bar'));
  }), { timeout: 1000 }).toBe(true);
  await expect(reader.locator('.reader-block', { hasText: 'Giant window block 200:' })).toBeVisible({ timeout: 1000 });
  await expect(reader.locator('.hvy-progress-bar')).toBeVisible({ timeout: 1000 });
  await reader.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const beforeRenderScrollTop = await reader.evaluate((element) => element.scrollTop);

  await page.getByRole('button', { name: 'App', exact: true }).click({ timeout: 1000 });
  await expect(reader.locator('.reader-block', { hasText: 'Giant window block 200:' })).toBeVisible({ timeout: 1000 });
  const afterRender = await reader.evaluate((element) => ({
    scrollTop: element.scrollTop,
    mountedBlocks: element.querySelectorAll('.reader-block').length,
    rangePlaceholders: element.querySelectorAll('[data-hvy-virtual-kind="reader-block-range"]').length,
  }));

  expect(Math.abs(afterRender.scrollTop - beforeRenderScrollTop)).toBeLessThanOrEqual(2);
  expect(afterRender.mountedBlocks).toBeLessThan(200);
  expect(afterRender.rangePlaceholders).toBeGreaterThan(0);

  await reader.evaluate((element) => { element.scrollTop = 0; });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Giant window block 200:', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });
  await expect(reader.locator('.reader-block', { hasText: 'Giant window block 200:' })).toBeVisible({ timeout: 1000 });
});

test('before, search, after: editor navigation materializes a block inside a giant section', async ({ page }) => {
  test.setTimeout(5000);
  await loadGiantBlockDocument(page);
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });

  const editor = page.locator('#editorTree');
  await expect.poll(() => editor.locator('[data-hvy-virtual-kind="editor-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await editor.locator('.editor-block-passive').count()).toBeLessThan(200);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Giant window block 200:', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });

  const target = editor.locator('.editor-block-passive', { hasText: 'Giant window block 200:' });
  await expect(target).toBeVisible({ timeout: 1000 });
  expect(await editor.locator('.editor-block-passive').count()).toBeLessThan(200);
  await target.click({ timeout: 1000 });
  await expect(editor.locator('.editor-block[data-active-editor-block="true"]')).toBeVisible({ timeout: 1000 });
});

test('before, scroll, after: lightweight viewer and full editor embeds materialize giant block windows', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.evaluate(async (source) => {
    document.body.innerHTML = `
      <div id="giant-viewer-embed" style="width: 60rem; height: 34rem;"></div>
      <div id="giant-editor-embed" style="width: 60rem; height: 34rem;"></div>
    `;
    const { deserializeDocumentBytes, mountHvy, mountHvyViewer, plugins } = await import(/* @vite-ignore */ '/src/embed.ts');
    const bytes = new TextEncoder().encode(source);
    mountHvyViewer({
      root: document.querySelector<HTMLElement>('#giant-viewer-embed')!,
      document: deserializeDocumentBytes(bytes, '.hvy'),
      plugins: plugins.progressBar ? [plugins.progressBar] : [],
    });
    mountHvy({
      root: document.querySelector<HTMLElement>('#giant-editor-embed')!,
      document: deserializeDocumentBytes(bytes, '.hvy'),
      mode: 'editor',
      plugins: plugins.progressBar ? [plugins.progressBar] : [],
    });
  }, GIANT_BLOCK_DOCUMENT);

  const viewer = page.locator('#giant-viewer-embed #readerDocument');
  const editor = page.locator('#giant-editor-embed #editorTree');
  await expect.poll(() => viewer.locator('[data-hvy-virtual-kind="reader-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  await expect.poll(() => editor.locator('[data-hvy-virtual-kind="editor-block-range"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);

  await expect.poll(() => viewer.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return Boolean(element.querySelector('.hvy-progress-bar'));
  }), { timeout: 1000 }).toBe(true);
  await expect.poll(() => editor.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return Boolean(element.querySelector('.hvy-progress-bar'));
  }), { timeout: 1000 }).toBe(true);
  await expect(viewer.locator('.reader-block', { hasText: 'Giant window block 200:' })).toBeVisible({ timeout: 1000 });
  await expect(editor.locator('.editor-block-passive', { hasText: 'Giant window block 200:' })).toBeVisible({ timeout: 1000 });
  await expect(viewer.locator('.hvy-progress-bar')).toBeVisible({ timeout: 1000 });
  await expect(editor.locator('.hvy-progress-bar')).toBeVisible({ timeout: 1000 });
});
