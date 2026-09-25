import { expect, test } from '@playwright/test';

const RECURSIVE_CONTAINER_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"recursive-section-root"}-->
#! Recursive Section Root

 <!--hvy:text {"id":"recursive-section-intro"}-->
  Recursive section introduction

${Array.from({ length: 200 }, (_item, index) => `<!--hvy: {"id":"recursive-child-section-${index + 1}"}-->
#! Fake Section ${index + 1}

 <!--hvy:container {"id":"recursive-child-container-${index + 1}"}-->
  <!--hvy:text {"id":"recursive-child-block-${index + 1}"}-->
   Recursive child content ${index + 1}: ${'content '.repeat(6)}
`).join('\n')}
`;

async function loadRecursiveContainerDocument(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click({ timeout: 1000 });
  await page.locator('#rawEditor').evaluate((rawEditor, value) => {
    rawEditor.value = value;
    rawEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
  }, RECURSIVE_CONTAINER_DOCUMENT);
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 1000 });
}

test('before, scroll and search, after: reader projects sections with nested containers into the viewport', async ({ page }) => {
  test.setTimeout(5000);
  await loadRecursiveContainerDocument(page);
  await page.getByRole('button', { name: 'Viewer' }).click({ timeout: 1000 });

  const reader = page.locator('#readerDocument');
  await expect.poll(() => reader.locator('[data-hvy-virtual-kind="reader"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await reader.locator('.reader-section').count()).toBeLessThan(201);

  await expect.poll(() => reader.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return Boolean(element.querySelector('#recursive-child-block-200'));
  }), { timeout: 1000 }).toBe(true);
  await expect(reader.locator('#recursive-child-block-200')).toBeVisible({ timeout: 1000 });
  expect(await reader.locator('.reader-section').count()).toBeLessThan(100);
  await reader.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const beforeRenderScrollTop = await reader.evaluate((element) => element.scrollTop);

  await page.getByRole('button', { name: 'App', exact: true }).click({ timeout: 1000 });
  expect(Math.abs(await reader.evaluate((element) => element.scrollTop) - beforeRenderScrollTop)).toBeLessThanOrEqual(2);

  await reader.evaluate((element) => { element.scrollTop = 0; });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Recursive child content 200:', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });
  await expect(reader.locator('#recursive-child-block-200')).toBeVisible({ timeout: 1000 });
});

test('before, search and edit, after: editor recursively materializes a nested component path', async ({ page }) => {
  test.setTimeout(5000);
  await loadRecursiveContainerDocument(page);
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });

  const editor = page.locator('#editorTree');
  await expect.poll(() => editor.locator('[data-hvy-virtual-kind="editor"]').count(), { timeout: 1000 })
    .toBeGreaterThan(0);
  expect(await editor.locator('.editor-section-card').count()).toBeLessThan(200);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('Recursive child content 200:', { timeout: 1000 });
  await page.keyboard.press('Enter');
  await page.locator('.search-result').first().click({ timeout: 1000 });

  const target = editor.locator('.editor-block-passive', { hasText: 'Recursive child content 200:' }).last();
  await expect(target).toBeVisible({ timeout: 1000 });
  await target.click({ timeout: 1000 });
  await expect(editor.locator('.editor-block[data-active-editor-block="true"]', { hasText: 'Recursive child content 200:' }).last()).toBeVisible({ timeout: 1000 });
});

test('before, scroll, after: lightweight and full embeds materialize sections with nested containers', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.evaluate(async (source) => {
    document.body.innerHTML = `
      <div id="recursive-viewer-embed" style="width: 60rem; height: 34rem;"></div>
      <div id="recursive-editor-embed" style="width: 60rem; height: 34rem;"></div>
    `;
    const { deserializeDocumentBytes, mountHvy, mountHvyViewer } = await import(/* @vite-ignore */ '/src/embed.ts');
    const bytes = new TextEncoder().encode(source);
    mountHvyViewer({
      root: document.querySelector<HTMLElement>('#recursive-viewer-embed')!,
      document: deserializeDocumentBytes(bytes, '.hvy'),
    });
    mountHvy({
      root: document.querySelector<HTMLElement>('#recursive-editor-embed')!,
      document: deserializeDocumentBytes(bytes, '.hvy'),
      mode: 'editor',
    });
  }, RECURSIVE_CONTAINER_DOCUMENT);

  const viewer = page.locator('#recursive-viewer-embed #readerDocument');
  const editor = page.locator('#recursive-editor-embed #editorTree');
  await expect.poll(() => viewer.locator('[data-hvy-virtual-kind="reader"]').count(), { timeout: 1000 }).toBeGreaterThan(0);
  await expect.poll(() => editor.locator('[data-hvy-virtual-kind="editor"]').count(), { timeout: 1000 }).toBeGreaterThan(0);
  await expect.poll(() => viewer.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return Boolean(element.querySelector('#recursive-child-block-200'));
  }), { timeout: 1000 }).toBe(true);
  await expect.poll(() => editor.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.textContent?.includes('Recursive child content 200:') === true;
  }), { timeout: 1000 }).toBe(true);
  expect(await viewer.locator('.reader-section').count()).toBeLessThan(100);
  expect(await editor.locator('.editor-section-card').count()).toBeLessThan(100);
});
