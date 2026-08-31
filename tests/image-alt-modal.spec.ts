import { expect, test } from '@playwright/test';

test('before, alt draft dialog actions and drag, after: cancel discards and done commits', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click({ timeout: 1000 });
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alt-dialog"}-->
#! Alt Dialog

 <!--hvy:image {"id":"sample-image","imageFile":"","imageAlt":"Initial alt"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 1000 });
  await page.getByRole('button', { name: 'Basic' }).click({ timeout: 1000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).click({ timeout: 1000 });

  await page.getByRole('button', { name: 'Alt Text' }).click({ timeout: 1000 });
  let dialog = page.getByRole('dialog', { name: 'Alt Text' });
  await expect(dialog).toHaveAttribute('aria-modal', 'false');
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Image description' }).fill('Discarded alt');
  await dialog.getByRole('button', { name: 'Cancel' }).click({ timeout: 1000 });
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await import('/src/state.ts')).state.document.sections[0]?.blocks[0]?.schema.imageAlt)).toBe('Initial alt');

  await page.getByRole('button', { name: 'Alt Text' }).click({ timeout: 1000 });
  dialog = page.getByRole('dialog', { name: 'Alt Text' });
  const before = await dialog.boundingBox();
  const heading = await dialog.getByRole('heading', { name: 'Alt Text' }).boundingBox();
  expect(before).not.toBeNull();
  expect(heading).not.toBeNull();
  await page.mouse.move(heading!.x + heading!.width / 2, heading!.y + heading!.height / 2);
  await page.mouse.down();
  await page.mouse.move(heading!.x - 45, heading!.y + 35, { steps: 3 });
  await page.mouse.up();
  const after = await dialog.boundingBox();
  expect(after!.x).not.toBe(before!.x);
  expect(after!.y).not.toBe(before!.y);

  await dialog.getByRole('textbox', { name: 'Image description' }).fill('Committed alt');
  await dialog.getByRole('button', { name: 'Done' }).click({ timeout: 1000 });
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await import('/src/state.ts')).state.document.sections[0]?.blocks[0]?.schema.imageAlt)).toBe('Committed alt');
  await expect(page.getByRole('button', { name: 'Alt Text' })).toBeFocused();
});
