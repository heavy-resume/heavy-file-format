import { expect, test } from '@playwright/test';
import type { HvyMount } from '../src/embed';

declare global {
  interface Window { undoSelectionMount: HvyMount }
}

for (const entry of ['embed', 'embed-full']) {
  for (const navigation of ['keyboard', 'api']) {
    test(`${entry} restores focus and selection through ${navigation} undo and redo`, async ({ page }) => {
      test.setTimeout(5_000);
      await page.goto('/');
      await page.evaluate(async (entry) => {
        const { mountHvy } = await import(`/src/${entry}.ts`);
        const serializationPath = '/src/serialization.ts';
        const { deserializeDocument } = await import(/* @vite-ignore */ serializationPath);
        document.body.innerHTML = '<div id="undoSelectionRoot"></div>';
        window.undoSelectionMount = mountHvy({
          root: document.querySelector('#undoSelectionRoot')!,
          mode: 'editor',
          document: deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"sample-undo"}-->
#! Sample Undo

 <!--hvy:xref-card {"id":"sample-reference","xrefTitle":"Sample title","xrefDetail":"Sample detail suffix","xrefTarget":"sample-undo"}-->
`, '.hvy'),
        });
      }, entry);

      await page.locator('.editor-block-passive', { has: page.locator('[data-component-id="sample-reference"]') }).click();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const detail = page.locator('[data-active-editor-block="true"] [data-field="block-xref-detail"]');
      await detail.evaluate((node) => {
        (node as HTMLElement).focus();
        window.getSelection()!.setBaseAndExtent(node.firstChild!, 7, node.firstChild!, 13);
      });
      await expect(detail).toBeFocused();
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('detail');

      await page.keyboard.press('Backspace');
      await expect(detail).toHaveText('Sample suffix');

      if (navigation === 'api') {
        await page.evaluate(() => window.undoSelectionMount.undo());
      } else {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
      }
      await expect(detail).toHaveText('Sample detail suffix');
      await expect(detail).toBeFocused();
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('detail');

      if (navigation === 'api') {
        await page.evaluate(() => window.undoSelectionMount.redo());
      } else {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
      }
      await expect(detail).toHaveText('Sample suffix');
      await expect(detail).toBeFocused();
      expect(await detail.evaluate((node) => {
        const selection = window.getSelection()!;
        const range = document.createRange();
        range.selectNodeContents(node);
        range.setEnd(selection.anchorNode!, selection.anchorOffset);
        return { collapsed: selection.isCollapsed, offset: range.toString().length };
      })).toEqual({ collapsed: true, offset: 7 });
    });
  }
}
