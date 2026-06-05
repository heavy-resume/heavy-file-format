import { expect, test } from '@playwright/test';

test('active table editor shows placeholders only for wholly empty rows', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-placeholder-test"}-->
#! Table Placeholder Test

 <!--hvy:table {"tableColumns":["Role","Notes"],"tableRows":[{"cells":["Alpha",""]},{"cells":["",""]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const passiveTable = page.locator('.editor-block-passive', { hasText: 'Alpha' }).first();
  const passiveFirstRowNotes = passiveTable.locator('.reader-table tbody tr').nth(0).locator('td').nth(1);
  const passiveSecondRowRole = passiveTable.locator('.reader-table tbody tr').nth(1).locator('td').nth(0);
  const passiveSecondRowNotes = passiveTable.locator('.reader-table tbody tr').nth(1).locator('td').nth(1);

  await expect.poll(async () => passiveFirstRowNotes.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('none');
  await expect.poll(async () => passiveSecondRowRole.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Role"');
  await expect.poll(async () => passiveSecondRowNotes.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Notes"');

  await passiveTable.click();
  const firstRowLabel = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]');
  const firstRowNotes = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="1"]');
  const secondRowRole = page.locator('[data-field="table-cell"][data-row-index="1"][data-cell-index="0"]');
  const secondRowNotes = page.locator('[data-field="table-cell"][data-row-index="1"][data-cell-index="1"]');

  await expect.poll(async () => firstRowNotes.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('none');
  await expect.poll(async () => secondRowRole.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Role"');
  await expect.poll(async () => secondRowNotes.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Notes"');

  await firstRowLabel.click();
  await firstRowLabel.evaluate((node) => {
    const element = node as HTMLElement;
    element.innerHTML = '';
    element.focus();
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await expect(firstRowLabel).toBeFocused();
  await expect(firstRowLabel).toHaveText('');
  await expect.poll(async () => firstRowLabel.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('none');
  await expect.poll(async () => firstRowNotes.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Notes"');
  await expect.poll(async () => secondRowRole.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Role"');
  await expect.poll(async () => secondRowNotes.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Notes"');

  await firstRowLabel.evaluate((node) => (node as HTMLElement).blur());
  await expect.poll(async () => firstRowLabel.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Role"');
  await expect.poll(async () => firstRowNotes.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Notes"');
  await expect.poll(async () => secondRowRole.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Role"');
  await expect.poll(async () => secondRowNotes.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Notes"');
});

test('static table row delete button is centered in the row utility cell', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-delete-grid-test"}-->
#! Table Delete Grid Test

 <!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();

  const expectedResult = await page.locator('.table-row-remove-cell [data-action="remove-table-row"]').first().evaluate((button) => {
    const icon = button.querySelector('.hvy-ui-icon');
    const utilityCell = button.closest('.table-row-remove-cell');
    if (!icon || !utilityCell) throw new Error('Static table row delete control was not rendered.');

    const buttonBox = button.getBoundingClientRect();
    const iconBox = icon.getBoundingClientRect();
    const utilityCellBox = utilityCell.getBoundingClientRect();
    const buttonCenter = {
      x: buttonBox.left + buttonBox.width / 2,
      y: buttonBox.top + buttonBox.height / 2,
    };
    const iconCenter = {
      x: iconBox.left + iconBox.width / 2,
      y: iconBox.top + iconBox.height / 2,
    };
    const utilityCellCenter = {
      x: utilityCellBox.left + utilityCellBox.width / 2,
      y: utilityCellBox.top + utilityCellBox.height / 2,
    };

    return {
      buttonDisplay: getComputedStyle(button).display,
      buttonPlaceItems: getComputedStyle(button).placeItems,
      iconCenterDeltaX: Math.abs(buttonCenter.x - iconCenter.x),
      iconCenterDeltaY: Math.abs(buttonCenter.y - iconCenter.y),
      buttonCellCenterDeltaX: Math.abs(utilityCellCenter.x - buttonCenter.x),
      buttonCellCenterDeltaY: Math.abs(utilityCellCenter.y - buttonCenter.y),
    };
  });

  expect(expectedResult.buttonDisplay).toBe('inline-grid');
  expect(expectedResult.buttonPlaceItems).toBe('center');
  expect(expectedResult.iconCenterDeltaX).toBeLessThanOrEqual(1);
  expect(expectedResult.iconCenterDeltaY).toBeLessThanOrEqual(1);
  expect(expectedResult.buttonCellCenterDeltaX).toBeLessThanOrEqual(1);
  expect(expectedResult.buttonCellCenterDeltaY).toBeLessThanOrEqual(1);
});

test('empty static table rows delete without confirmation while filled rows still confirm', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-empty-delete-test"}-->
#! Table Empty Delete Test

 <!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]},{"cells":["",""]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();

  await page.locator('[data-action="remove-table-row"][data-row-index="1"]').click();
  await expect(page.locator('.remove-confirmation-modal')).toHaveCount(0);
  await expect(page.locator('[data-field="table-cell"][data-row-index="1"][data-cell-index="0"]')).toHaveCount(0);

  await page.locator('[data-action="remove-table-row"][data-row-index="0"]').click();
  await expect(page.locator('.remove-confirmation-modal')).toBeVisible();
  await page.locator('.remove-confirmation-modal').getByRole('button', { name: 'Cancel' }).click();
});

test('filled static table row delete opens confirmation from an active cell on the first click', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-active-delete-test"}-->
#! Table Active Delete Test

 <!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();
  const firstCell = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]');
  await firstCell.click();
  await expect(firstCell).toBeFocused();
  await page.keyboard.type(' edited');
  await expect(firstCell).toContainText('Alpha edited');

  await page.locator('[data-action="remove-table-row"][data-row-index="0"]').click();
  await expect(page.locator('.remove-confirmation-modal')).toBeVisible();
});

test('active table editor tabs through cells before row controls', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"ai-table-tab-test"}-->
#! AI Table Tab Test

 <!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]},{"cells":["Beta","Closed"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();
  const firstCell = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]');
  const secondCell = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="1"]');
  const nextRowFirstCell = page.locator('[data-field="table-cell"][data-row-index="1"][data-cell-index="0"]');

  await expect(firstCell).toBeVisible();
  await firstCell.click();
  await expect(firstCell).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(secondCell).toBeFocused();
  await expect(page.locator('[data-action="remove-table-row"][data-row-index="0"]')).not.toBeFocused();

  await page.keyboard.press('Tab');
  await expect(nextRowFirstCell).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(secondCell).toBeFocused();
});

test('active table editor Enter advances rows and Shift Enter inserts a cell line break', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"ai-table-enter-test"}-->
#! AI Table Enter Test

 <!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();
  const firstCell = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]');
  await firstCell.click();
  await expect(firstCell).toBeFocused();

  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Second line');
  await expect(firstCell).toContainText('Alpha');
  await expect.poll(async () => firstCell.evaluate((node) => (node as HTMLElement).innerText)).toContain('Second line');
  await expect.poll(async () => firstCell.evaluate((node) => (node as HTMLElement).innerText.split('\n'))).toEqual(['Alpha', 'Second line']);
  await expect.poll(async () => firstCell.evaluate((node) => getComputedStyle(node).display)).toBe('block');

  await page.keyboard.press('Enter');
  const addedRowFirstCell = page.locator('[data-field="table-cell"][data-row-index="1"][data-cell-index="0"]');
  await expect(addedRowFirstCell).toBeFocused();
  await page.waitForTimeout(100);
  await expect(addedRowFirstCell).toBeFocused();
  await expect(page.locator('[data-field="table-column"][data-column-index="0"]')).not.toBeFocused();
  await expect(firstCell).toContainText('Second line');
  await page.keyboard.type('Beta');
  await expect(addedRowFirstCell).toContainText('Beta');
});
