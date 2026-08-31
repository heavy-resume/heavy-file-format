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

test('before, text above a loaded image, after: activating the text keeps its viewport anchor', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click({ timeout: 1000 });
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

${Array.from({ length: 10 }, (_item, index) => `<!--hvy: {"id":"lead-section-${index + 1}"}-->
#! Lead Section ${index + 1}

 <!--hvy:text {}-->
  ${'Synthetic section content. '.repeat(24)}
`).join('\n')}
<!--hvy: {"id":"activation-target"}-->
#! Activation Target

${Array.from({ length: 14 }, (_item, index) => ` <!--hvy:text {}-->
  Synthetic lead-in ${index + 1}: ${'Generic content. '.repeat(12)}
`).join('\n')}
 <!--hvy:text {"id":"editable-above-image"}-->
  Editable text immediately above the image.

 <!--hvy:image {"id":"loaded-image","imageFile":"synthetic-landscape.svg","imageAlt":"Synthetic landscape"}-->

 <!--hvy:text {}-->
  Content immediately below the image.
`);
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 1000 });
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });
  await page.evaluate(async () => {
    const [{ state, getRefreshEditorSection }, { setImageAttachment }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/attachments.ts'),
    ]);
    setImageAttachment(
      state.document,
      'synthetic-landscape.svg',
      'image/svg+xml',
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#789"/></svg>')
    );
    const targetSection = state.document.sections.find((section) => section.customId === 'activation-target');
    if (!targetSection) throw new Error('Synthetic target section missing.');
    getRefreshEditorSection()(targetSection.key);
  });

  const editorTree = page.locator('#editorTree');
  const passiveText = page.locator('.editor-block-passive', { hasText: 'Editable text immediately above the image.' });
  await editorTree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await editorTree.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await passiveText.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(page.getByRole('img', { name: 'Synthetic landscape' })).toBeVisible({ timeout: 1000 });
  const beforeActivationTop = await passiveText.locator('.reader-block').evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!textNode) throw new Error('Passive text anchor missing.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return range.getBoundingClientRect().top;
  });

  await passiveText.click({ timeout: 1000 });

  const activeText = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(activeText).toBeFocused({ timeout: 1000 });
  const afterActivationTop = await activeText.locator('p').evaluate((element) => {
    const textNode = element.firstChild;
    if (!textNode) throw new Error('Active text anchor missing.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return range.getBoundingClientRect().top;
  });
  await activeText.type('x', { timeout: 1000 });
  await expect(activeText).toBeFocused({ timeout: 1000 });
  const afterTypingTop = await activeText.locator('p').evaluate((element) => {
    const textNode = element.firstChild;
    if (!textNode) throw new Error('Typed text anchor missing.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return range.getBoundingClientRect().top;
  });

  expect(Math.abs(afterTypingTop - afterActivationTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterActivationTop - beforeActivationTop)).toBeLessThanOrEqual(2);
});

test('before, deferred image hydration, after: following content keeps its viewport anchor', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="syntheticMount" style="width: 30rem; height: 36rem;"></div>';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ '/src/embed.ts');
    const testWindow = window as Window & { resolveSyntheticImage?: () => void };
    let resolveImage: ((value: Blob) => void) | null = null;
    const imageUrl = new Promise<Blob>((resolve) => { resolveImage = resolve; });
    testWindow.resolveSyntheticImage = () => resolveImage?.(new Blob([
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#789"/></svg>',
    ], { type: 'image/svg+xml' }));
    mountHvy({
      root: document.querySelector<HTMLElement>('#syntheticMount')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---

<!--hvy: {"id":"layout-shift"}-->
#! Layout Shift

 <!--hvy:text {}-->
  Generic content above the image.

 <!--hvy:image {"imageFile":"deferred-landscape.svg","imageAlt":"Deferred landscape"}-->

 <!--hvy:text {}-->
  Generic content below the image.
`), '.hvy'),
      mode: 'editor',
      attachmentStore: {
        list: () => [{
          id: 'image:deferred-landscape.svg',
          meta: { mediaType: 'image/svg+xml', pixelWidth: 1200, pixelHeight: 800 },
          length: 128,
        }],
        recall: () => null,
        store: () => undefined,
        remove: () => undefined,
        resolveUrl: () => imageUrl,
      },
    });
  });

  const followingContent = page.getByText('Generic content below the image.', { exact: true });
  const image = page.getByRole('img', { name: 'Deferred landscape' });
  const reservedImageSize = await image.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const beforeHydrationTop = await followingContent.evaluate((element) => element.getBoundingClientRect().top);

  await page.evaluate(() => (window as Window & { resolveSyntheticImage?: () => void }).resolveSyntheticImage?.());

  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalHeight), { timeout: 1000 })
    .toBeGreaterThan(0);
  const afterHydrationTop = await followingContent.evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(reservedImageSize.width / reservedImageSize.height - 1.5)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(afterHydrationTop - beforeHydrationTop)).toBeLessThanOrEqual(2);
});
