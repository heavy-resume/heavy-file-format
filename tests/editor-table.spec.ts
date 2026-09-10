import { expect, test, type Locator, type Page } from '@playwright/test';


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

async function scrollDownUntilVisible(page: Page, scroller: Locator, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const visibility = await target.evaluate((element) => {
      const scrollContainer = element.closest<HTMLElement>('#editorTree')!;
      const elementRect = element.getBoundingClientRect();
      const scrollRect = scrollContainer.getBoundingClientRect();
      return elementRect.top >= scrollRect.top && elementRect.bottom <= scrollRect.bottom;
    });
    if (visibility) return;
    const scrollerBox = await scroller.boundingBox();
    if (!scrollerBox) throw new Error('Expected the editor scroll surface.');
    await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2);
    await page.mouse.wheel(0, 300);
  }
  throw new Error('Expected the editor control to become visible while scrolling down.');
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

test('canceling an untouched static table restores its pre-activation viewport position', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-viewport-anchor"}-->
#! Table Viewport Anchor

<!--hvy:text {}-->
${Array.from({ length: 24 }, (_item, index) => `  Spacer paragraph ${index + 1}.\n`).join('\n')}

<!--hvy:table {"tableColumns":["Neighborhood","Formally Opposed"]}-->
| Neighborhood | Formally Opposed |
| --- | --- |
| Trovitsky Park | Yes |
| Lake Desire | No |
| Woodside | Yes |
| The Parks | No |
| Fairwood Greens | No |
| Carriage Wood | No |
| Candlewood Ridge | No |

<!--hvy:text {}-->
${Array.from({ length: 24 }, (_item, index) => `  Trailing paragraph ${index + 1}.\n`).join('\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const passiveTable = page.locator('.editor-block-passive', { hasText: 'Formally Opposed' });
  await passiveTable.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const expectedResult = await passiveTable.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    scrollTop: element.closest<HTMLElement>('.editor-tree')?.scrollTop ?? -1,
  }));
  await passiveTable.evaluate((element) => {
    element.closest('.editor-section-card')?.setAttribute('data-editor-section-identity', 'preserved');
    element.previousElementSibling?.setAttribute('data-editor-sibling-identity', 'preserved');
  });

  // ACTION: activate a body cell and cancel without editing or scrolling.
  await passiveTable.locator('.reader-table tbody td').first().dispatchEvent('click');
  const activeTable = page.locator('.editor-block[data-active-editor-block="true"]', { has: page.locator('.table-editor') });
  await expect(page.locator('[data-editor-section-identity="preserved"]')).toHaveCount(1);
  await expect(page.locator('[data-editor-sibling-identity="preserved"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.pendingEditorActivation;
  })).toBeNull();
  await activeTable.getByRole('button', { name: 'Cancel' }).dispatchEvent('click');

  // AFTER: the surrounding DOM stays mounted while the table animates back to its original position.
  await expect(page.locator('[data-editor-section-identity="preserved"]')).toHaveCount(1);
  await expect(page.locator('[data-editor-sibling-identity="preserved"]')).toHaveCount(1);
  expect(await passiveTable.evaluate((element) => element.getAnimations()
    .some((animation) => animation.id === 'hvy-editor-block-collapse'))).toBe(true);
  await expect.poll(() => passiveTable.evaluate((element, expected) => ({
    topDelta: Math.abs(element.getBoundingClientRect().top - expected.top),
    scrollTopDelta: Math.abs((element.closest<HTMLElement>('.editor-tree')?.scrollTop ?? -1) - expected.scrollTop),
  }), expectedResult)).toEqual({ topDelta: 0, scrollTopDelta: 0 });
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

  const headerToggle = page.locator('.table-header-toggle');
  const headerToggleBox = await headerToggle.boundingBox();
  const tableEditorBox = await page.locator('.table-editor').boundingBox();
  if (!headerToggleBox || !tableEditorBox) throw new Error('Expected the table header toggle and editor to be visible.');
  expect(headerToggleBox.width).toBeLessThan(tableEditorBox.width / 2);
  const expectedHeaderChecked = await headerToggle.locator('input').isChecked();
  await page.mouse.click(tableEditorBox.x + tableEditorBox.width - 8, headerToggleBox.y + headerToggleBox.height / 2);
  expect(await headerToggle.locator('input').isChecked()).toBe(expectedHeaderChecked);

  const editorCellTextStyle = await page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="0"]').evaluate((cell) => ({
    overflow: getComputedStyle(cell).overflow,
    textOverflow: getComputedStyle(cell).textOverflow,
    whiteSpace: getComputedStyle(cell).whiteSpace,
  }));
  expect(editorCellTextStyle).toEqual({ overflow: 'visible', textOverflow: 'clip', whiteSpace: 'pre-wrap' });

  const settings = page.locator('.table-column-settings').first();
  await settings.locator('summary').click();
  await settings.locator('[data-field="table-column-width"]').focus();
  await page.keyboard.press('Escape');
  await expect(settings).not.toHaveAttribute('open', '');
  await expect(settings.locator('summary')).toBeFocused();
  await settings.locator('summary').click();
  const overflowFit = await settings.evaluate((details) => {
    const panel = details.querySelector<HTMLElement>('.table-column-settings-panel');
    const truncate = Array.from(details.querySelectorAll<HTMLElement>('.table-column-overflow-options span'))
      .find((label) => label.textContent === 'Truncate');
    if (!panel || !truncate) return null;
    return truncate.getBoundingClientRect().right <= panel.getBoundingClientRect().right;
  });
  expect(overflowFit).toBe(true);
  await settings.locator('[data-field="table-column-truncate"]').uncheck();
  await expect(page.locator('.table-editor-grid tbody td[data-table-column-index="0"]').first()).toHaveClass(/table-column-no-truncate/);
  await settings.locator('[data-field="table-column-wrap"]').check();
  await settings.locator('[data-field="table-column-truncate"]').check();
  await expect(settings.locator('[data-field="table-column-wrap"]')).not.toBeChecked();
  await settings.locator('[data-field="table-column-wrap"]').check();
  await expect(settings.locator('[data-field="table-column-truncate"]')).not.toBeChecked();
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

test('right-clicking and double-clicking static table grabbers inserts rows and columns on either side', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-grabber-insert-test"}-->
#! Table Grabber Insert Test

<!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]},{"cells":["Beta","Closed"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();

  // BEFORE: the table has its two original rows and columns, with no insertion menu open.
  await expect(page.locator('[data-field="table-cell"]')).toHaveCount(4);
  await expect(page.locator('[data-field="table-column"]')).toHaveCount(2);
  await expect(page.locator('.table-grabber-insert-popover:not([hidden])')).toHaveCount(0);

  // ACTION: right-click the second row grabber to open its insertion menu.
  await page.locator('[data-drag-handle="table-row"][data-row-index="1"]').click({ button: 'right' });
  const rowPopover = page.locator('.table-grabber-insert-popover:not([hidden])');
  await expect(rowPopover).toBeVisible();
  await expect(rowPopover.getByRole('menuitem')).toHaveText(['Insert before', 'Insert after']);
  await page.keyboard.press('Escape');
  await expect(rowPopover).toHaveCount(0);
  await expect(page.locator('[data-drag-handle="table-row"][data-row-index="1"]')).toBeFocused();
  await page.locator('[data-drag-handle="table-row"][data-row-index="1"]').click({ button: 'right' });
  await rowPopover.getByRole('menuitem', { name: 'Insert before' }).click();

  await page.locator('[data-drag-handle="table-column"][data-column-index="0"]').click({ button: 'right' });
  await page.locator('.table-grabber-insert-popover:not([hidden])').getByRole('menuitem', { name: 'Insert after' }).click();

  // AFTER: blank entries were inserted at the requested indexes without displacing existing values.
  await expect(page.locator('[data-field="table-column"]')).toHaveText(['Role', 'Column 3', 'Scope']);
  await expect(page.locator('[data-field="table-cell"]')).toHaveCount(9);
  await expect(page.locator('[data-field="table-cell"][data-row-index="0"]')).toHaveText(['Alpha', '', 'Open']);
  await expect(page.locator('[data-field="table-cell"][data-row-index="1"]')).toHaveText(['', '', '']);
  await expect(page.locator('[data-field="table-cell"][data-row-index="2"]')).toHaveText(['Beta', '', 'Closed']);

  // ADJACENT: double-click still opens the same menu for either kind of grabber.
  await page.locator('[data-drag-handle="table-row"][data-row-index="2"]').dblclick();
  await page.locator('.table-grabber-insert-popover:not([hidden])').getByRole('menuitem', { name: 'Insert after' }).click();
  await page.locator('[data-drag-handle="table-column"][data-column-index="0"]').dblclick();
  await page.locator('.table-grabber-insert-popover:not([hidden])').getByRole('menuitem', { name: 'Insert before' }).click();
  await expect(page.locator('[data-field="table-column"]')).toHaveText(['Column 4', 'Role', 'Column 3', 'Scope']);
  await expect(page.locator('[data-field="table-cell"]')).toHaveCount(16);
});

test('table row drag previews matching before or after insertion edges without a custom cursor ghost', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-row-drag-preview-test"}-->
#! Table Row Drag Preview Test

<!--hvy:table {"tableColumns":["Name","Status"],"tableRows":[{"cells":["Alpha","Open"]},{"cells":["Beta","Closed"]},{"cells":["Gamma","Pending"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();

  // BEFORE: rows have no drag-source or insertion-edge treatment.
  await expect(page.locator('.is-table-row-drag-source')).toHaveCount(0);
  await expect(page.locator('.is-table-row-drop-before, .is-table-row-drop-after')).toHaveCount(0);

  // TOOL CALL: start dragging Alpha and cross the midpoint of Beta.
  const expectedResult = await page.evaluate(() => {
    const sourceRow = document.querySelector<HTMLElement>('[data-table-row-drop][data-row-index="0"]');
    const targetRow = document.querySelector<HTMLElement>('[data-table-row-drop][data-row-index="1"]');
    const sourceHandle = sourceRow?.querySelector<HTMLElement>('[data-drag-handle="table-row"]');
    if (!sourceRow || !targetRow || !sourceHandle) throw new Error('Expected editable table rows');
    const transfer = new DataTransfer();
    let dragImageCalls = 0;
    transfer.setDragImage = () => { dragImageCalls += 1; };
    sourceHandle.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      clientX: sourceRow.getBoundingClientRect().left + 8,
      clientY: sourceRow.getBoundingClientRect().top + 8,
      dataTransfer: transfer,
    }));
    const bounds = targetRow.getBoundingClientRect();
    targetRow.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: bounds.top + 2,
      dataTransfer: transfer,
    }));
    const before = targetRow.classList.contains('is-table-row-drop-before');
    const insertionLabel = getComputedStyle(targetRow.cells[0]!, '::after').content;
    targetRow.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: bounds.bottom - 2,
      dataTransfer: transfer,
    }));
    const after = targetRow.classList.contains('is-table-row-drop-after');
    const sourceDimmed = sourceRow.classList.contains('is-table-row-drag-source');
    targetRow.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientY: bounds.bottom - 2,
      dataTransfer: transfer,
    }));
    return { dragImageCalls, before, after, insertionLabel, sourceDimmed };
  });

  // AFTER: the custom cursor ghost stayed disabled, both edges previewed, and the lower edge placed Alpha after Beta.
  expect(expectedResult).toEqual({
    dragImageCalls: 0,
    before: true,
    after: true,
    insertionLabel: '""',
    sourceDimmed: true,
  });
  await expect(page.locator('[data-field="table-cell"][data-cell-index="0"]')).toHaveText(['Beta', 'Alpha', 'Gamma']);
  await expect(page.locator('.is-table-row-drag-source, .is-table-row-drop-before, .is-table-row-drop-after')).toHaveCount(0);
});

test('table column drag previews matching before or after insertion boundaries without a custom cursor ghost', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-column-drag-preview-test"}-->
#! Table Column Drag Preview Test

<!--hvy:table {"tableColumns":["Name","Status"],"tableRows":[{"cells":["Alpha","Open"]},{"cells":["Beta","Closed"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).first().click();

  // BEFORE: no table cell carries a column insertion boundary.
  await expect(page.locator('.is-table-column-drop-before, .is-table-column-drop-after')).toHaveCount(0);

  // TOOL CALL: drag Name across the midpoint of Status and drop at its right boundary.
  const expectedResult = await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>('[data-drag-handle="table-column"][data-column-index="0"]');
    const target = document.querySelector<HTMLTableCellElement>('[data-table-column-drop][data-column-index="1"]');
    if (!source || !target) throw new Error('Expected editable table columns');
    const transfer = new DataTransfer();
    let dragImageCalls = 0;
    transfer.setDragImage = () => { dragImageCalls += 1; };
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const bounds = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + 2,
      dataTransfer: transfer,
    }));
    const beforeCount = target.closest('table')?.querySelectorAll('.is-table-column-drop-before').length ?? 0;
    const insertionLabel = getComputedStyle(target, '::after').content;
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.right - 2,
      dataTransfer: transfer,
    }));
    const afterCount = target.closest('table')?.querySelectorAll('.is-table-column-drop-after').length ?? 0;
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.right - 2,
      dataTransfer: transfer,
    }));
    return { dragImageCalls, beforeCount, afterCount, insertionLabel };
  });

  // AFTER: the boundary spanned the header and both rows, and Status moved before Name.
  expect(expectedResult).toEqual({ dragImageCalls: 0, beforeCount: 3, afterCount: 3, insertionLabel: '""' });
  await expect(page.locator('[data-field="table-column"]')).toHaveText(['Status', 'Name']);
  await expect(page.locator('[data-field="table-cell"][data-row-index="0"]')).toHaveText(['Open', 'Alpha']);
  await expect(page.locator('[data-field="table-cell"][data-row-index="1"]')).toHaveText(['Closed', 'Beta']);
  await expect(page.locator('.is-table-column-drop-before, .is-table-column-drop-after')).toHaveCount(0);
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

test('select all and delete keeps a static table cell canonically empty and undoes once', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-cell-clear"}-->
#! Table Cell Clear

<!--hvy: {"id":"nested-table-section"}-->
## Nested Table Section

 <!--hvy:table {"tableColumns":["Role","Scope"],"tableRows":[{"cells":["Alpha","Open"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.getByRole('cell', { name: 'Open', exact: true }).click();
  const cell = page.locator('[data-field="table-cell"][data-row-index="0"][data-cell-index="1"]');
  await cell.click();
  const expectedDocument = await page.evaluate(async () =>
    JSON.parse(JSON.stringify((await import('/src/state.ts')).state.document))
  );
  const expectedResult = await cell.evaluate((node) => node.getBoundingClientRect().height);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');

  await expect(cell).toBeFocused();
  await expect(cell).toHaveText('');
  const clearedDocument = await page.evaluate(async () =>
    JSON.parse(JSON.stringify((await import('/src/state.ts')).state.document))
  );
  expect(await cell.evaluate((node) => node.innerHTML)).toBe('');
  expect(await cell.evaluate(
    (node, initialHeight) => Math.abs(node.getBoundingClientRect().height - initialHeight),
    expectedResult
  )).toBeLessThanOrEqual(1);
  expect(await cell.evaluate((node) => {
    const selection = window.getSelection();
    return Boolean(selection?.isCollapsed && selection.rangeCount && node.contains(selection.getRangeAt(0).startContainer));
  })).toBe(true);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');

  await expect(page.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(1);
  await expect(cell).toBeFocused();
  await expect(cell).toHaveText('Open');
  await expect(page.locator('.table-inline-text p')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () =>
    JSON.parse(JSON.stringify((await import('/src/state.ts')).state.document))
  )).toEqual(expectedDocument);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(() => page.evaluate(async () =>
    JSON.parse(JSON.stringify((await import('/src/state.ts')).state.document))
  )).toEqual(clearedDocument);
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

test('static table Done keeps a newly added bottom row anchored in the viewport', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"long-static-table-viewport"}-->
#! Long Static Table Viewport

<!--hvy:table {"tableColumns":["Issue","Notes"],"tableColumnProperties":{"Issue":{"width":"488px","wrap":false,"truncate":true,"align":"left","headerAlign":"center"}},"tableRows":${JSON.stringify(Array.from({ length: 40 }, (_item, index) => ({
    cells: [`Example issue ${index + 1}: ${'placeholder details '.repeat(5)}`, index % 5 === 0 ? 'Example note' : ''],
  })))} }-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const passiveFirstRow = page.getByRole('row', { name: /Example issue 1:/ });
  await passiveFirstRow.scrollIntoViewIfNeeded();
  await passiveFirstRow.getByRole('cell').first().click();

  const activeTable = page.locator('.editor-block[data-active-editor-block="true"]', { has: page.locator('.table-editor') });
  const editorTree = page.locator('#editorTree');
  const addRowButton = activeTable.getByRole('button', { name: 'Row', exact: true });
  await scrollDownUntilVisible(page, editorTree, addRowButton);

  const previousRowCount = await activeTable.locator('.table-row-editor-main').count();
  await addRowButton.dispatchEvent('click');
  await expect(activeTable.locator('.table-row-editor-main')).toHaveCount(previousRowCount + 1);
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.pendingEditorActivation;
  })).toBeNull();
  const doneButton = activeTable.getByRole('button', { name: 'Done' });
  await scrollDownUntilVisible(page, editorTree, doneButton);
  const doneButtonBox = await doneButton.boundingBox();
  expect(doneButtonBox).not.toBeNull();
  const editorTreeAfterRowBox = await editorTree.boundingBox();
  expect(editorTreeAfterRowBox).not.toBeNull();
  expect(doneButtonBox!.y + doneButtonBox!.height).toBeLessThanOrEqual(
    editorTreeAfterRowBox!.y + editorTreeAfterRowBox!.height
  );
  const expectedLastRowTop = await activeTable.locator('.table-row-editor-main').last().evaluate(
    (element) => element.getBoundingClientRect().top
  );

  // ACTION: close the static table after adding a row.
  await page.mouse.click(
    doneButtonBox!.x + doneButtonBox!.width / 2,
    doneButtonBox!.y + doneButtonBox!.height / 2
  );

  // AFTER: closing the table does not move the document away from the user's viewport.
  const passiveTable = page.locator('.editor-block-passive', { hasText: 'Example issue 40:' });
  await expect.poll(async () => Math.abs(
    await passiveTable.locator('.reader-table tbody tr').last().evaluate((element) => element.getBoundingClientRect().top)
      - expectedLastRowTop
  )).toBeLessThanOrEqual(2);
});
