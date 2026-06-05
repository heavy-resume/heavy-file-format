import { expect, test } from '@playwright/test';

test('active empty table cell does not show placeholder under the caret', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-placeholder-test"}-->
#! Table Placeholder Test

 <!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();
  const cell = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]');

  await cell.evaluate((node) => {
    const element = node as HTMLElement;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.focus();
  });
  await page.keyboard.press('Backspace');

  await expect(cell).toBeFocused();
  await expect(cell).toHaveText('');
  await expect.poll(async () => cell.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('none');

  await cell.evaluate((node) => (node as HTMLElement).blur());
  await expect.poll(async () => cell.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('"Role"');
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
