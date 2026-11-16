import { expect, test, type Page } from '@playwright/test';

// The editor keeps earlier blocks open when another block is opened. Closing an
// earlier-opened block must refresh that block, not the most recently opened one.

const FAKE_SOURCE = String.raw`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section

 <!--hvy:text {}-->
  Fake first text

 <!--hvy:container {}-->

  <!--hvy:text {}-->
   Fake nested text

 <!--hvy:text {}-->
  Fake last text
`;

async function openFakeDocumentInEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(FAKE_SOURCE);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
}

function passiveBlock(page: Page, text: string) {
  return page.locator('#editorTree .editor-block-passive[data-action="activate-block"]', { hasText: text }).last();
}

function openBlock(page: Page, text: string) {
  return page.locator('#editorTree .editor-block[data-active-editor-block="true"]', { hasText: text }).last();
}

for (const button of ['Done', 'Cancel']) {
  test(`${button} closes an earlier-opened block while a later sibling stays open`, async ({ page }) => {
    test.setTimeout(5_000);
    await openFakeDocumentInEditor(page);
    await passiveBlock(page, 'Fake first text').click();
    await passiveBlock(page, 'Fake last text').click();
    await expect(openBlock(page, 'Fake first text')).toHaveCount(1);
    await expect(openBlock(page, 'Fake last text')).toHaveCount(1);

    await openBlock(page, 'Fake first text').locator(':scope > .editor-block-done-row').getByRole('button', { name: button, exact: true }).click();

    await expect(openBlock(page, 'Fake first text')).toHaveCount(0);
    await expect(passiveBlock(page, 'Fake first text')).toHaveCount(1);
    await expect(openBlock(page, 'Fake last text')).toHaveCount(1);
  });
}

test('Done closes an earlier-opened nested block while a later top-level block stays open', async ({ page }) => {
  test.setTimeout(5_000);
  await openFakeDocumentInEditor(page);
  await passiveBlock(page, 'Fake nested text').click();
  await passiveBlock(page, 'Fake last text').click();
  await expect(openBlock(page, 'Fake nested text')).not.toHaveCount(0);

  await page.locator('#editorTree .editor-block[data-active-editor-block="true"]:not(:has(.editor-block[data-active-editor-block="true"]))', { hasText: 'Fake nested text' })
    .locator(':scope > .editor-block-done-row')
    .getByRole('button', { name: 'Done', exact: true })
    .click();

  await expect(passiveBlock(page, 'Fake nested text')).toHaveCount(1);
  await expect(openBlock(page, 'Fake last text')).toHaveCount(1);
});

test('Done closes an accepted section heading after a text block is added below it', async ({ page }) => {
  test.setTimeout(5_000);
  await openFakeDocumentInEditor(page);
  await page.locator('#editorTree [data-action="add-top-level-section"][data-section-location="main"]').click();
  const sectionCard = page.locator('#editorTree .editor-section-card').last();
  await sectionCard.locator('[data-field="section-title"]').fill('Fake Heading');
  await sectionCard.locator('[data-field="section-title"]').press('Enter');
  await sectionCard.locator('[data-action="add-empty-section-heading"] .ghost-plus-big').click();
  const sectionEndPicker = sectionCard.locator('.compact-add-component-ghost[data-section-before-kind="end"]').last();
  await sectionEndPicker.locator('.component-picker-trigger').click();
  await sectionEndPicker.locator('[data-action="add-block"][data-component="text"]').first().click();
  await expect(sectionCard.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(2);

  await sectionCard.locator('.editor-block[data-active-editor-block="true"]').first()
    .locator(':scope > .editor-block-done-row')
    .getByRole('button', { name: 'Done', exact: true })
    .click();

  await expect(sectionCard.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(1);
});
