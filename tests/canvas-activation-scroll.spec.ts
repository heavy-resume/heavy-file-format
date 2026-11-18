import { expect, test } from '@playwright/test';

// Enough text to scroll, while keeping the canvas within the lazy plugin mount's preload range.
const LONG_TEXT = Array.from({ length: 12 }, (_, index) => `Placeholder paragraph ${index + 1} for scrolling the editor down to the canvas.`).join('\n\n');
const SOURCE = `---
hvy_version: 0.1
plugins:
  - id: hvy.canvas
---

<!--hvy: {"id":"text-section","contained":false}-->
#! Text Section

<!--hvy:text {}-->
${LONG_TEXT}

<!--hvy: {"id":"canvas-section","contained":false}-->
#! Canvas Section

<!--hvy:plugin {"id":"sketch","plugin":"hvy.canvas","pluginConfig":{"width":800,"height":450,"drawing":"activation"}}-->
Placeholder canvas description.
`;

test('before, click empty layer-panel space to edit a canvas block, after: the canvas stays where it was', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    state.document = deserializeDocument(source, '.hvy');
    state.history = [];
    state.future = [];
    getRenderApp()();
  }, SOURCE);
  // Plugins in inactive blocks mount once they scroll near view.
  await page.locator('.editor-block-passive').last().evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const panel = page.locator('.hvy-canvas-layers');
  await expect(panel).toBeVisible({ timeout: 1_000 });
  await panel.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const canvasTop = () => page.locator('.hvy-canvas-surface').evaluate((canvas) => canvas.getBoundingClientRect().top);
  const before = await canvasTop();

  const box = (await panel.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4);
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .hvy-canvas-plugin')).toHaveCount(1);

  // Activation leaves sub-half-pixel displacements alone (see scroll.ts).
  await expect.poll(async () => Math.abs((await canvasTop()) - before), { timeout: 1_000 }).toBeLessThanOrEqual(0.5);
});
