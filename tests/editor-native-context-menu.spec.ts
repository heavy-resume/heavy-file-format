import { expect, test } from '@playwright/test';

for (const view of ['ai', 'editor']) {
  test(`${view} active prose editor preserves the native context menu`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"sample"}-->
#! Sample

 Misspeled sample words
`);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.locator(`[data-action="switch-view"][data-view="${view}"]`).click();
    if (view === 'ai') {
      await page.locator('#aiReaderDocument .reader-block').first().click({ button: 'right' });
      await page.getByRole('button', { name: 'Edit component', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Advanced', exact: true }).click();
      await page.locator('#editorTree .editor-block-passive').first().click();
    }

    const editor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor').first();
    await editor.fill('Misspeled sample words');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveAttribute('spellcheck', 'true');
    await expect(page.locator('.hvy-context-popover')).toHaveCount(0);

    // Observe the real right-click event after application handlers have run.
    await page.evaluate(() => {
      document.addEventListener('contextmenu', (event) => {
        (event.target as HTMLElement).closest('.rich-editor')?.setAttribute(
          'data-native-context-menu-allowed', String(!event.defaultPrevented)
        );
      }, { once: true });
    });
    await editor.click({ button: 'right' });

    await expect(editor).toHaveAttribute('data-native-context-menu-allowed', 'true');
    await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('Misspeled sample words');
    await page.keyboard.type('!');
    await expect(editor).toBeFocused();
    await expect(editor).toContainText('!');
  });
}
