import { expect, test } from '@playwright/test';

test('before, image edits, after: the editor viewport stays mounted and keeps its scroll anchor', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click({ timeout: 1000 });
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"scroll-repro"}-->
#! Scroll repro

${Array.from({ length: 24 }, (_, index) => ` <!--hvy:text {}-->
  Spacer ${index + 1}: ${'Long editor content '.repeat(8)}
`).join('\n')}
 <!--hvy:image {}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 1000 });
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });

  const editorTree = page.locator('#editorTree');
  const image = page.locator('.editor-block-passive', { has: page.locator('.image-reader') });
  await image.scrollIntoViewIfNeeded({ timeout: 1000 });
  await editorTree.evaluate((element) => {
    element.dataset.expectedViewportIdentity = 'image-scroll-regression';
  });
  const beforeActivationRenderCount = await page.evaluate(async () => (await import('/src/state.ts')).renderCount);

  await image.click({ timeout: 1000 });
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .image-editor')).toBeVisible({ timeout: 1000 });
  await expect.poll(() => page.evaluate(async () => (await import('/src/state.ts')).state.pendingEditorActivation), { timeout: 1000 })
    .toBeNull();
  const beforeUpload = await editorTree.evaluate((element) => ({
    scrollTop: element.scrollTop,
    identity: element.dataset.expectedViewportIdentity,
  }));

  await page.locator('[data-field="image-upload"]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .image-block-img')).toBeVisible({ timeout: 1000 });
  const afterUpload = await editorTree.evaluate((element) => ({
    scrollTop: element.scrollTop,
    identity: element.dataset.expectedViewportIdentity,
  }));

  await page.locator('.editor-block[data-active-editor-block="true"]').hover({ timeout: 1000 });
  await page.mouse.wheel(0, 350);
  await expect.poll(async () => editorTree.evaluate((element) => element.scrollTop), { timeout: 1000 })
    .toBeGreaterThan(afterUpload.scrollTop);
  const doneButton = page.getByRole('button', { name: 'Done' });
  await doneButton.scrollIntoViewIfNeeded({ timeout: 1000 });
  const beforeDoneScrollTop = await editorTree.evaluate((element) => element.scrollTop);
  await doneButton.click({ timeout: 1000 });
  await expect(image).toBeVisible({ timeout: 1000 });
  const afterDone = await editorTree.evaluate((element) => ({
    scrollTop: element.scrollTop,
    identity: element.dataset.expectedViewportIdentity,
  }));
  const afterDoneRenderCount = await page.evaluate(async () => (await import('/src/state.ts')).renderCount);

  expect(beforeUpload.identity).toBe('image-scroll-regression');
  expect(afterUpload.identity).toBe('image-scroll-regression');
  expect(afterDone.identity).toBe('image-scroll-regression');
  expect(Math.abs(afterUpload.scrollTop - beforeUpload.scrollTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterDone.scrollTop - beforeDoneScrollTop)).toBeLessThanOrEqual(2);
  expect(afterDoneRenderCount).toBe(beforeActivationRenderCount);
});
