import { expect, test } from '@playwright/test';

for (const preview of ['Full', 'Phone 390']) {
  test(`mouse menus replace each other in ${preview} preview`, async ({ page }) => {
    test.setTimeout(5000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"popover-probe"}-->
#! Popover Probe

<!--hvy:table {"tableColumns":["First","Second"],"tableRows":[{"cells":["Alpha","Open"]},{"cells":["Beta","Closed"]}]}-->
`);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: 'Basic', exact: true }).click();
    await page.getByRole('button', { name: preview, exact: true }).click();
    await page.locator('.editor-block-passive', { hasText: 'Alpha' }).click();

    // BEFORE: a row insertion menu is open.
    await page.locator('[data-drag-handle="table-row"]').last().click({ button: 'right' });
    await expect(page.locator('.table-grabber-insert-popover:popover-open')).toHaveCount(1);

    // ACTION: right-click a different target that opens the component menu.
    await page.locator('.table-editor-head strong').click({ button: 'right', position: { x: 200, y: 4 } });

    // EXPECTED RESULT: the previous menu and its expanded state are cleared.
    await expect(page.locator('.hvy-context-popover')).toBeVisible();
    await expect(page.locator('.table-grabber-insert-popover:popover-open')).toHaveCount(0);
    await expect(page.locator('[data-drag-handle="table-row"][aria-expanded="true"]')).toHaveCount(0);

    // ACTION: open the row menu again while the component menu is visible.
    await page.locator('[data-drag-handle="table-row"]').last().click({ button: 'right' });

    // EXPECTED RESULT: only the newly opened menu remains, and its action still works.
    await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
    await expect(page.locator('.is-context-menu-open, .is-context-menu-target')).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Insert after', exact: true }).click();
    await expect(page.locator('[data-field="table-cell"]')).toHaveCount(6);
    await expect(page.locator('.table-grabber-insert-popover:popover-open')).toHaveCount(0);

    // ADJACENT: a right-click inside an editable cell also dismisses the custom menu.
    await page.locator('[data-drag-handle="table-row"]').last().click({ button: 'right' });
    await page.locator('[data-field="table-cell"]').first().click({ button: 'right' });
    await expect(page.locator('.table-grabber-insert-popover:popover-open')).toHaveCount(0);
    await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
  });
}
