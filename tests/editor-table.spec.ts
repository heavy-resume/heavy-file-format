import { expect, test, type Page } from '@playwright/test';


/**
 * Waits until a surface stops re-rendering. Scroll positions captured while the AI view is
 * still settling drift by a few pixels afterwards, which breaks scroll-preservation checks.
 */
async function waitForSurfaceIdle(page: Page, selector: string, quietMs = 250): Promise<void> {
  await page.locator(selector).evaluate((root, quiet) => new Promise<void>((resolve) => {
    let timer = window.setTimeout(finish, quiet as number);
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, quiet as number);
    });
    function finish(): void {
      observer.disconnect();
      resolve();
    }
    observer.observe(root, { subtree: true, childList: true, attributes: true });
  }), quietMs);
}

test('entering and canceling a static table edit keeps the document saved', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-dirty-state"}-->
#! Table Dirty State

<!--hvy:table {"tableColumns":["Name","Status"],"tableRows":[{"cells":["Alpha","Open"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.evaluate(async () => {
    const { resetReferenceDocumentDirtyBaseline } = await import('/src/reference-document-dirty.ts');
    resetReferenceDocumentDirtyBaseline();
  });

  // BEFORE: the loaded table is saved.
  await expect(page.locator('[data-reference-save-state]')).toHaveText('Saved');

  // ACTION: enter its inline editor, focus a cell, and cancel without changing content.
  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).click();
  const activeTable = page.locator('.editor-block[data-active-editor-block="true"]', { has: page.locator('.table-editor') });
  await activeTable.locator('[data-field="table-cell"]').first().click();
  await expect(page.locator('[data-reference-save-state]')).toHaveText('Saved');
  await activeTable.getByRole('button', { name: 'Cancel' }).click();

  // AFTER: entering edit mode alone did not mark the document dirty.
  await expect(page.locator('[data-reference-save-state]')).toHaveText('Saved');

  // ADJACENT: real table input still marks the document dirty and keeps its pre-edit undo state.
  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).click();
  await page.locator('[data-field="table-cell"]').first().fill('Beta');
  await expect(page.locator('[data-reference-save-state]')).toHaveText('Unsaved');
  await page.evaluate(async () => {
    const { undoState } = await import('/src/history.ts');
    undoState();
  });
  await expect(page.locator('[data-reference-save-state]')).toHaveText('Saved');
  await expect(page.locator('.editor-block', { hasText: 'Alpha' })).toBeVisible();
});

test('static table columns resize, auto-fit, reset, and contain wide overflow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-column-presentation"}-->
#! Table Column Presentation

<!--hvy:table {"tableColumns":["Name","Details","Status"],"tableColumnProperties":{"Name":{"width":"500px"},"Details":{"width":"500px","wrap":true},"Status":{"width":"500px","align":"right"}}}-->
| Name | Details | Status |
| --- | --- | --- |
| Alpha | Deliberately long details for automatic sizing | Open |
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const passive = page.locator('.editor-block-passive', { hasText: 'Deliberately long details' }).first();
  await expect.poll(() => passive.locator('.reader-table-frame').evaluate((frame) => frame.scrollWidth > frame.clientWidth)).toBe(true);
  await passive.click();

  const editorCellTextStyle = await page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]').evaluate((cell) => ({
    overflow: getComputedStyle(cell).overflow,
    textOverflow: getComputedStyle(cell).textOverflow,
    whiteSpace: getComputedStyle(cell).whiteSpace,
  }));
  expect(editorCellTextStyle).toEqual({ overflow: 'visible', textOverflow: 'clip', whiteSpace: 'pre-wrap' });

  const settings = page.locator('.table-column-settings').first();
  await settings.locator('summary').click();
  await settings.locator('[data-field="table-column-truncate"]').uncheck();
  await expect(page.locator('.table-editor-grid tbody td[data-table-column-index="0"]').first()).toHaveClass(/table-column-no-truncate/);
  await settings.locator('[data-field="table-column-wrap"]').check();
  await settings.locator('[data-field="table-column-align"]').selectOption('right');
  await settings.locator('[data-field="table-column-header-align"]').selectOption('left');
  await expect(page.locator('.table-editor-grid tbody td[data-table-column-index="0"]').first()).toHaveClass(/table-column-wrap/);
  await expect(page.locator('.table-editor-grid tbody td[data-table-column-index="0"]').first()).toHaveClass(/table-column-align-right/);
  await expect(page.locator('.table-editor-grid thead th[data-table-column-index="0"]')).toHaveClass(/table-column-header-align-left/);
  const widthInput = settings.locator('[data-field="table-column-width"]');
  await widthInput.fill('620px');
  await expect(widthInput).toBeFocused();
  await expect(widthInput).toHaveValue('620px');
  await settings.locator('summary').click();

  const handle = page.locator('.table-column-resize-handle').first();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Expected a static table resize handle.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2);
  await page.mouse.up();
  await expect(widthInput).not.toHaveValue('620px');

  await handle.dblclick();
  await expect(widthInput).toHaveValue(/^[0-9]+px$/);
  await settings.locator('summary').click();
  await settings.getByRole('button', { name: 'Fit to contents' }).click();
  await expect(widthInput).toHaveValue(/^[0-9]+px$/);
  await settings.getByRole('button', { name: 'Automatic width' }).click();
  await expect(widthInput).toHaveValue('auto');
  await expect(page.locator('.table-editor-grid col[data-table-column-index="0"]')).not.toHaveAttribute('style');
});

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

test('AI static table activation preserves scroll and Tab advances to the next cell', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  const reader = page.locator('#aiReaderDocument');
  const table = reader.locator('.reader-table', { hasText: 'Applied' });
  await waitForSurfaceIdle(page, '#aiReaderDocument');
  await table.click({ button: 'right' });
  const expectedResult = await reader.evaluate((node) => node.scrollTop);
  await page.getByRole('button', { name: 'Edit component' }).click();

  const firstCell = reader.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]');
  const secondCell = reader.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="1"]');
  await expect(firstCell).toBeVisible();
  await expect.poll(async () => Math.round(await reader.evaluate((node) => node.scrollTop))).toBe(Math.round(expectedResult));
  await firstCell.click();
  await expect(firstCell).toBeFocused();
  await expect.poll(async () => Math.round(await reader.evaluate((node) => node.scrollTop))).toBe(Math.round(expectedResult));
  await page.keyboard.press('Tab');
  await expect(secondCell).toBeFocused();
  await expect.poll(async () => Math.round(await reader.evaluate((node) => node.scrollTop))).toBe(Math.round(expectedResult));
});

test('clicking a static table cell opens that cell in place', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-cell-activation"}-->
#! Table Cell Activation

 <!--hvy:text {}-->
  ${'Generic content above the table. '.repeat(40)}

 <!--hvy:table {"id":"activation-table","tableColumns":["Label","Value"]}-->
  | Label | Value |
  | --- | --- |
${Array.from({ length: 12 }, (_item, index) => `  | Generic row ${index + 1} | ${index === 8 ? 'Clicked cell target' : `Generic value ${index + 1}`} |`).join('\n')}

 <!--hvy:text {}-->
  ${'Generic content below the table. '.repeat(40)}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const passiveCell = page.getByRole('cell', { name: 'Clicked cell target', exact: true });
  await passiveCell.scrollIntoViewIfNeeded();
  const passiveTop = await passiveCell.evaluate((element) => element.getBoundingClientRect().top);
  await passiveCell.click();

  const expectedResult = page.locator(
    '[data-field="table-cell"][data-row-index="8"][data-cell-index="1"]'
  );
  await expect(expectedResult).toBeFocused();
  await expect.poll(async () => {
    const activeTop = await expectedResult.evaluate((element) => element.getBoundingClientRect().top);
    return Math.abs(activeTop - passiveTop);
  }).toBeLessThanOrEqual(3);
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

test('static table Done does not persist untouched Enter-created rows', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-enter-prune-test"}-->
#! Table Enter Prune Test

 <!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();
  const firstCell = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]');
  await firstCell.click();
  await expect(firstCell).toBeFocused();

  await page.keyboard.press('Enter');
  const untouchedAddedRowFirstCell = page.locator('[data-field="table-cell"][data-row-index="1"][data-cell-index="0"]');
  await expect(untouchedAddedRowFirstCell).toBeFocused();

  const doneButton = page.locator('.editor-block[data-active-editor-block="true"]').getByRole('button', { name: 'Done' });
  await doneButton.scrollIntoViewIfNeeded();
  const doneButtonBox = await doneButton.boundingBox();
  expect(doneButtonBox).not.toBeNull();
  const expectedResult = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim() ?? '',
    { x: doneButtonBox!.x + doneButtonBox!.width / 2, y: doneButtonBox!.y + doneButtonBox!.height / 2 }
  );
  expect(expectedResult).toBe('Done');
  await page.mouse.click(doneButtonBox!.x + doneButtonBox!.width / 2, doneButtonBox!.y + doneButtonBox!.height / 2);
  await expect(page.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  const passiveTable = page.locator('.editor-block-passive', { hasText: 'Alpha' }).first();
  await expect(passiveTable.locator('.reader-table tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toHaveValue(/\| Alpha \| Open \|/);
  await expect(page.locator('#rawEditor')).not.toHaveValue(/"cells":\["",""\]/);
});
