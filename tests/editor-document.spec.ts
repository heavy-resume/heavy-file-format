import { expect, test } from '@playwright/test';

test('can add section and undo/redo', async ({ page }) => {
  await page.goto('/');

  const sections = page.locator('[data-action="remove-section"]');
  const initialCount = await sections.count();

  await page.locator('[data-action="add-top-level-section"]').click();
  await expect(sections).toHaveCount(initialCount + 1);

  await page.keyboard.press('Control+z');
  await expect(sections).toHaveCount(initialCount);

  await page.keyboard.press('Control+y');
  await expect(sections).toHaveCount(initialCount + 1);
});

test('section remove requires confirmation', async ({ page }) => {
  await page.goto('/');

  const sections = page.locator('[data-action="remove-section"]');
  const initialCount = await sections.count();

  await page.locator('[data-action="add-top-level-section"]').click();
  await expect(sections).toHaveCount(initialCount + 1);

  const removeButton = sections.nth(initialCount);
  await removeButton.dispatchEvent('click');
  await expect(sections).toHaveCount(initialCount + 1);
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();
  await expect(removeButton).toHaveText('Remove');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toHaveCount(0);
  await expect(sections).toHaveCount(initialCount + 1);

  await removeButton.dispatchEvent('click');
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => sections.count()).toBeLessThan(initialCount + 1);
});

test('reader max width keeps focus while typing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  const readerMaxWidth = page.locator('[data-field="meta-reader-max-width"]');
  await readerMaxWidth.fill('');
  await readerMaxWidth.type('60rem');

  await expect(readerMaxWidth).toBeFocused();
  await expect(readerMaxWidth).toHaveValue('60rem');
});

test('resume template shows friendly empty component-list add prompts before activation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();

  await expect(page.locator('.editor-block-passive .ghost-label', { hasText: 'Add Skill' }).first()).toBeVisible();
  await expect(page.locator('.editor-block-passive .ghost-label', { hasText: 'Add Tool / Tech' }).first()).toBeVisible();
});

test('resume template spaces stacked location labels from block css', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();

  const locationBlock = page.locator('.reader-block-text', { hasText: 'Target Location(s)' }).first();
  await expect(locationBlock).toHaveCSS('white-space', 'pre-line');

  const labels = locationBlock.locator('strong');
  await expect(labels).toHaveCount(2);

  const firstBox = await labels.nth(0).boundingBox();
  const secondBox = await labels.nth(1).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(secondBox!.y - (firstBox!.y + firstBox!.height)).toBeGreaterThan(1);
});

test('trailing spaces after bold labels remain editable outside bold text', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"locations"}-->
#! Locations

 <!--hvy:text {"css":"margin: 0.5rem 0; line-height: 1.5;","lock":true}-->
  **Location:** 

  **Target Location(s):** 
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Location:' }).click();

  const editor = page.locator('.rich-editor').first();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Location:');
  await expect(editor).toContainText('Target Location(s):');
  await expect(editor.locator('p').first()).toHaveJSProperty('innerHTML', '<strong>Location:</strong>&nbsp;');

  await editor.evaluate((node) => {
    const paragraph = node.querySelector('p');
    const trailingSpace = paragraph?.lastChild;
    if (!paragraph || !trailingSpace) {
      throw new Error('Expected trailing editable space after Location label.');
    }
    const range = document.createRange();
    range.setStart(trailingSpace, trailingSpace.textContent?.length ?? 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type('Seattle, WA');

  await expect(editor.locator('p').first().locator('strong')).toHaveText('Location:');
  await expect(editor.locator('p').first()).toContainText('Location: Seattle, WA');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('**Location:** Seattle, WA');
});
