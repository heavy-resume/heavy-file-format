import { expect, test, type Page } from '@playwright/test';

const CANVAS_SOURCE = `---
hvy_version: 0.1
title: Canvas Focus
plugins:
  - id: hvy.canvas
---

<!--hvy: {"id":"canvas-section","contained":false}-->
#! Canvas Section

<!--hvy:plugin {"id":"sketch","plugin":"hvy.canvas","pluginConfig":{"drawing":"sketch","width":200,"height":100,"strokeWidth":8}}-->
Placeholder sketch description.
`;

async function openCanvasDocument(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    state.document = deserializeDocument(source, '.hvy');
    state.filename = 'canvas-focus.hvy';
    state.history = [];
    state.future = [];
    getRenderApp()();
  }, CANVAS_SOURCE);
  await expect(page.locator('.hvy-canvas-surface')).toBeVisible();
}

async function drawStroke(page: Page, y: number): Promise<void> {
  const surface = page.locator('.hvy-canvas-surface');
  await surface.scrollIntoViewIfNeeded();
  const bounds = (await surface.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + bounds.height * y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * y, { steps: 4 });
  await page.mouse.up();
}

async function readFocusedField(page: Page): Promise<string> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.field ?? document.activeElement?.tagName ?? 'none');
}

async function readStoredStrokeCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const [{ state }, { getAttachment }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/attachments.ts'),
    ]);
    const attachment = getAttachment(state.document, 'canvas:sketch');
    return attachment ? JSON.parse(new TextDecoder().decode(attachment.bytes)).layers.flatMap((layer: { items: unknown[] }) => layer.items).length : 0;
  });
}

test('before, activate and draw, undo: focus stays on the drawing surface instead of jumping to the width input', async ({ page }) => {
  test.setTimeout(5_000);
  await openCanvasDocument(page);

  // BEFORE: activate the canvas block from its toolbar, then draw two strokes.
  await page.locator('.hvy-canvas-toolbar').getByText('Tool', { exact: true }).click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .hvy-canvas-surface')).toHaveCount(1);
  expect(await readFocusedField(page)).not.toBe('INPUT');
  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Brush', exact: true }).click();
  await drawStroke(page, 0.2);
  await drawStroke(page, 0.4);
  expect(await readFocusedField(page)).toBe('canvas-surface');

  // UNDO
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readStoredStrokeCount(page), { timeout: 1_000 }).toBe(1);

  // AFTER: focus is back on the drawing surface.
  expect(await readFocusedField(page)).toBe('canvas-surface');
});

test('before, draw on an inactive canvas block, after: the drawing surface has focus', async ({ page }) => {
  test.setTimeout(5_000);
  await openCanvasDocument(page);
  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Brush', exact: true }).click();

  await drawStroke(page, 0.5);

  expect(await readStoredStrokeCount(page)).toBe(1);
  expect(await readFocusedField(page)).toBe('canvas-surface');
});
