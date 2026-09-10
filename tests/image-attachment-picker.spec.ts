import { expect, test } from '@playwright/test';

test('attached image picker fetches two rows before expansion and can be disabled', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"photos"}-->
#! Photos

 <!--hvy:image {"id":"portrait"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.evaluate(async () => {
    const { setImageAttachment } = await import('/src/attachments.ts');
    const { state, getRenderApp } = await import('/src/state.ts');
    for (let index = 1; index <= 20; index += 1) {
      setImageAttachment(state.document, `photo-${index}.png`, 'image/png', new Uint8Array([137, 80, 78, 71, index]));
    }
    getRenderApp()();
  });
  await page.locator('.editor-block-passive', { hasText: 'No image' }).click({ timeout: 1000 });

  await page.getByRole('button', { name: 'Use an attached image...' }).click({ timeout: 1000 });
  const modal = page.getByRole('dialog', { name: 'Use an attached image' });
  await expect(modal).toBeVisible({ timeout: 1000 });
  const picker = modal.locator('[data-image-attachment-picker]');
  const before = await picker.evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
    visible: Array.from(element.querySelectorAll<HTMLElement>('[data-image-picker-index]')).filter((choice) => !choice.hidden).length,
    hydrated: element.querySelectorAll('img[src]').length,
    total: element.querySelectorAll('[data-image-picker-index]').length,
  }));
  expect(before.visible).toBe(Math.min(before.total, before.columns * 2));
  expect(before.hydrated).toBe(before.visible);

  await modal.locator('[data-image-attachment-picker-toggle]').click({ timeout: 1000 });
  await expect(picker.locator('[data-image-picker-index]:visible')).toHaveCount(20, { timeout: 1000 });
  await expect(picker.locator('img[src]')).toHaveCount(20, { timeout: 1000 });

  await modal.getByRole('button', { name: 'Use image: photo-1.png' }).click({ timeout: 1000 });
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.image-filename')).toHaveText('photo-1.png');
  await expect(page.getByRole('button', { name: 'Alt Text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use an attached image...' })).toBeFocused();

  await page.getByRole('button', { name: 'Rename image attachment photo-1.png' }).click({ timeout: 1000 });
  const filenameInput = page.getByRole('textbox', { name: 'Image attachment filename for photo-1.png' });
  await expect(filenameInput).toBeFocused();
  await filenameInput.fill('portrait.png');
  await page.getByRole('button', { name: 'Alt Text' }).click({ timeout: 1000 });
  const altTextDialog = page.getByRole('dialog', { name: 'Alt Text' });
  await altTextDialog.getByRole('textbox', { name: 'Image description' }).click({ timeout: 1000 });
  await expect(page.getByRole('button', { name: 'Rename image attachment portrait.png' })).toHaveText('portrait.png');
  await expect(altTextDialog.getByRole('textbox', { name: 'Image description' })).toBeFocused();
  await expect.poll(() => page.evaluate(async () => {
    const { listImageFilenames } = await import('/src/attachments.ts');
    const { state } = await import('/src/state.ts');
    return {
      imageFile: state.document.sections[0]?.blocks[0]?.schema.imageFile,
      filenames: listImageFilenames(state.document),
    };
  })).toEqual({
    imageFile: 'portrait.png',
    filenames: expect.arrayContaining(['portrait.png']),
  });
  await expect.poll(() => page.evaluate(async () => {
    const { listImageFilenames } = await import('/src/attachments.ts');
    const { state } = await import('/src/state.ts');
    return listImageFilenames(state.document).includes('photo-1.png');
  })).toBe(false);

  await altTextDialog.getByRole('button', { name: 'Cancel' }).click({ timeout: 1000 });

  await page.getByRole('button', { name: 'Add caption' }).click({ timeout: 1000 });
  await expect(page.getByRole('dialog', { name: 'Image Caption' })).toBeVisible({ timeout: 1000 });
  await page.getByRole('button', { name: 'Close Image Caption' }).click({ timeout: 1000 });

  await page.evaluate(async () => {
    const { state, getRenderApp } = await import('/src/state.ts');
    state.document.sections[0]!.blocks[0]!.schema.allowDocumentImageReuse = false;
    getRenderApp()();
  });
  await expect(page.locator('.image-attachment-modal-root')).toHaveCount(0);
  await expect(page.locator('[data-action="open-image-attachment-modal"]')).toHaveCount(0);
  await expect(page.locator('[data-field="image-upload"]')).toHaveCount(1);
  await expect(page.locator('[data-action="image-take-photo"]')).toHaveCount(1);
});
