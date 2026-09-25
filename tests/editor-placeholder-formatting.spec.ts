import { expect, test } from '@playwright/test';

for (const { name, source, marker } of [
  { name: 'fake_title', source: '{% fake_title | text %}', marker: '.template-value-token' },
  { name: 'fake-title', source: '{% fake-title | text %}', marker: '.template-value-token' },
  { name: 'fill-in', source: '<!-- value {"placeholder":"Fake_title"} -->', marker: '[data-hvy-fill-in-marker]' },
]) {
  for (const format of ['Bold', 'Italic']) {
    test(`${format} preserves placeholder ${name} after reopening`, async ({ page }) => {
      test.setTimeout(5_000);
      await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.goto('/');
      await page.getByRole('button', { name: 'Raw', exact: true }).click();
      await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: fake-format-template
    baseType: text
    template:
      id: fake-format-template
      text: ${JSON.stringify(`Before ${source} after`)}
      schema:
        component: text
        fillIn: ${name === 'fill-in'}
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section
`);
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.getByRole('button', { name: 'Advanced', exact: true }).click();
      await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
      await page.getByRole('button', { name: 'Edit Template', exact: true }).click();
      const modal = page.locator('.reusable-definition-modal');
      await modal.locator('.editor-block-passive').click();
      const editor = modal.locator('.rich-editor[data-field="block-rich"]');
      await expect(editor.locator(marker)).toHaveCount(1);
      await modal.locator('[data-text-toolbar-expand]').last().click();
      await editor.evaluate((node, selector) => {
        (node as HTMLElement).focus();
        const range = document.createRange();
        range.selectNode(node.querySelector(selector)!);
        if (selector === '.template-value-token') range.collapse(true);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      }, marker);
      if (name !== 'fill-in') {
        if (format === 'Bold') {
          await page.keyboard.press('Shift+ArrowRight');
        } else {
          const labelBounds = await editor.locator('.template-value-token-label').boundingBox();
          await page.mouse.move(labelBounds!.x - 1, labelBounds!.y + labelBounds!.height / 2);
          await page.mouse.down();
          const dragSelections = [await page.evaluate(() => window.getSelection()!.toString())];
          for (let step = 0; step <= 12; step += 1) {
            await page.mouse.move(labelBounds!.x + (labelBounds!.width + 1) * step / 12, labelBounds!.y + labelBounds!.height / 2);
            dragSelections.push(await page.evaluate(() => window.getSelection()!.toString()));
          }
          for (let step = 12; step >= 0; step -= 1) {
            await page.mouse.move(labelBounds!.x + labelBounds!.width * step / 12, labelBounds!.y + labelBounds!.height / 2);
            dragSelections.push(await page.evaluate(() => window.getSelection()!.toString()));
          }
          const paragraphBounds = await editor.locator('p').boundingBox();
          await page.mouse.move(paragraphBounds!.x + paragraphBounds!.width - 1, labelBounds!.y + labelBounds!.height / 2);
          expect(await page.evaluate(() => window.getSelection()!.toString())).toContain('after');
          await page.mouse.move(paragraphBounds!.x, labelBounds!.y + labelBounds!.height / 2);
          expect(await page.evaluate(() => window.getSelection()!.toString())).toContain('Before');
          expect(await page.evaluate(() => {
            const s = window.getSelection()!;
            const range = s.getRangeAt(0);
            return s.focusNode === range.startContainer && s.focusOffset === range.startOffset;
          })).toBe(true);
          await page.mouse.move(labelBounds!.x + labelBounds!.width / 2, labelBounds!.y + labelBounds!.height / 2);
          await page.mouse.up();
          await page.mouse.move(paragraphBounds!.x, labelBounds!.y + labelBounds!.height / 2);
          expect(dragSelections).toEqual(Array(27).fill(await editor.locator(marker).getAttribute('data-template-value-display')));
        }
        expect(await page.evaluate(() => window.getSelection()!.toString()))
          .toBe(await editor.locator(marker).getAttribute('data-template-value-display'));
      }
      await modal.getByRole('button', { name: format, exact: true }).click();
      await expect(editor.locator(`${format === 'Bold' ? 'strong' : 'em'} ${marker}`)).toHaveCount(1);
      if (format === 'Bold' && name !== 'fill-in') {
        expect(await editor.locator(marker).evaluate((node) =>
          getComputedStyle(node).fontWeight === getComputedStyle(node.parentElement!).fontWeight
        )).toBe(true);
      }
      await modal.getByRole('button', { name: format, exact: true }).click();
      await expect(editor.locator('strong, em')).toHaveCount(0);
      await expect(editor.locator(marker)).toHaveCount(1);
      await modal.getByRole('button', { name: format, exact: true }).click();
      await modal.getByRole('button', { name: 'Save Template', exact: true }).click();
      const delimiter = format === 'Bold' ? '**' : '_';
      expect(await page.evaluate(async () => {
        const { state } = await import('/src/state.ts');
        return state.document.meta.component_defs![0].template.text;
      })).toBe(`Before ${delimiter}${source}${delimiter} after`);
      await page.getByRole('button', { name: 'Edit Template', exact: true }).click();
      await modal.locator('.editor-block-passive').click();
      await expect(editor.locator(`${format === 'Bold' ? 'strong' : 'em'} ${marker}`)).toHaveCount(1);
    });
  }
}
