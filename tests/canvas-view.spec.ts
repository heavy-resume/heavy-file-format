import { expect, test, type Page } from '@playwright/test';
import { chooseTool, mountCanvasEditor, readLayers, toScreen } from './canvas-browser-test-helpers';

async function zoomLabel(page: Page): Promise<string> {
  return (await page.locator('.hvy-canvas-zoom-button.is-percent').textContent()) ?? '';
}

async function displayedPixel(page: Page, x: number, y: number): Promise<number[]> {
  const [clientX, clientY] = await toScreen(page, x, y);
  return page.locator('.hvy-canvas-surface').evaluate((canvas: HTMLCanvasElement, [cx, cy]) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return [...canvas.getContext('2d')!.getImageData(Math.round((cx - rect.left) * scale), Math.round((cy - rect.top) * scale), 1, 1).data];
  }, [clientX, clientY]);
}

test('the artboard opens at 100%, Ctrl+scroll zooms around the cursor, scrolling pans, and Fit fits', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  expect(await zoomLabel(page)).toBe('100%');

  const [x, y] = await toScreen(page, 200, 100);
  await page.mouse.move(x, y);
  await page.locator('.hvy-canvas-surface').focus();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomLabel(page), { timeout: 1_000 }).not.toBe('100%');
  // The point under the cursor stays put while zooming.
  const [afterX, afterY] = await toScreen(page, 200, 100);
  expect(Math.abs(afterX - x)).toBeLessThan(1);
  expect(Math.abs(afterY - y)).toBeLessThan(1);

  await page.mouse.wheel(0, 60);
  const [, pannedY] = await toScreen(page, 200, 100);
  expect(pannedY).toBeLessThan(afterY - 20);

  await page.getByRole('button', { name: 'Fit to window' }).click();
  await page.getByRole('button', { name: 'Zoom to 100%' }).click();
  await expect.poll(() => zoomLabel(page), { timeout: 1_000 }).toBe('100%');
});

test('the canvas keeps its tool when the block re-renders, and its frame has square corners', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Text');

  // Clicking empty toolbar space activates the editor block, which re-renders the plugin.
  const toolbarBox = (await page.locator('.hvy-canvas-toolbar').boundingBox())!;
  await page.mouse.click(toolbarBox.x + toolbarBox.width - 6, toolbarBox.y + 4);
  await expect(page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true');

  expect(await page.locator('.hvy-canvas-frame').evaluate((frame) => getComputedStyle(frame).borderRadius)).toBe('0px');
});

test('canvas settings: width, height, and grid live in the cog dialog', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await expect(page.locator('.hvy-canvas-toolbar').getByRole('spinbutton', { name: 'Width' })).toHaveCount(0);

  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Canvas settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Canvas settings' });
  // A small dialog, not the shared modal's full width.
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(24 * 16 + 1);
  await dialog.getByRole('spinbutton', { name: 'Width' }).fill('600');
  await dialog.getByRole('spinbutton', { name: 'Width' }).press('Enter');
  await dialog.getByRole('spinbutton', { name: 'Grid size' }).fill('0');
  await dialog.getByRole('spinbutton', { name: 'Grid size' }).press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  const config = await page.evaluate(async () => {
    const mount = (window as typeof window & { canvasTestMount: { getDocument(): { sections: Array<{ blocks: Array<{ schema: { pluginConfig: Record<string, unknown> } }> }> } } }).canvasTestMount;
    return mount.getDocument().sections[0]!.blocks[0]!.schema.pluginConfig;
  });
  expect(config).toMatchObject({ width: 600, gridSize: 0 });
});

test('dragging a layer by its grip reorders it as one undo step', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  const panel = page.locator('.hvy-canvas-layers');
  await panel.getByRole('button', { name: 'Add layer' }).click();
  await panel.getByRole('button', { name: 'Add layer' }).click();
  expect((await readLayers(page)).map((layer) => layer.name)).toEqual(['Layer 1', 'Layer 2', 'Layer 3']);

  const grip = (await panel.getByRole('button', { name: 'Drag to reorder Layer 3' }).boundingBox())!;
  const bottomRow = (await panel.locator('.hvy-canvas-layer-row').last().boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, bottomRow.y + bottomRow.height - 2, { steps: 6 });
  await page.mouse.up();
  expect((await readLayers(page)).map((layer) => layer.name)).toEqual(['Layer 3', 'Layer 1', 'Layer 2']);

  await page.locator('.hvy-canvas-surface').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readLayers(page)).map((layer) => layer.name), { timeout: 1_000 }).toEqual(['Layer 1', 'Layer 2', 'Layer 3']);
});

test('before, invert a layer from its settings, after: its fill shows inverted, and undo restores it', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Fill canvas');
  const [x, y] = await toScreen(page, 100, 100);
  await page.mouse.click(x, y);
  expect(await displayedPixel(page, 100, 100)).toEqual([18, 52, 86, 255]);

  await page.locator('.hvy-canvas-layers').getByRole('button', { name: 'Layer 1 settings' }).click();
  await page.getByRole('dialog').getByText('Invert colors').click();
  await page.keyboard.press('Escape');

  expect((await readLayers(page))[0]!.filter).toEqual({ invert: true });
  expect(await displayedPixel(page, 100, 100)).toEqual([237, 203, 169, 255]);

  await page.locator('.hvy-canvas-surface').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readLayers(page))[0]!.filter, { timeout: 1_000 }).toBeUndefined();
});

test('before, drag a layer opacity slider, during: the canvas shows the new opacity before it is stored, after release: it is stored', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Fill canvas');
  const [x, y] = await toScreen(page, 100, 100);
  await page.mouse.click(x, y);
  expect(await displayedPixel(page, 100, 100)).toEqual([18, 52, 86, 255]);
  await page.locator('.hvy-canvas-layers').getByRole('button', { name: 'Layer 1 settings' }).click();
  const opacity = page.getByRole('dialog').locator('input[type="range"]');

  await opacity.evaluate((input: HTMLInputElement) => {
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  expect((await readLayers(page))[0]!.filter).toBeUndefined();
  expect(await displayedPixel(page, 100, 100)).not.toEqual([18, 52, 86, 255]);

  await opacity.evaluate((input: HTMLInputElement) => input.dispatchEvent(new Event('change', { bubbles: true })));

  expect((await readLayers(page))[0]!.filter).toEqual({ multiply: { r: 255, g: 255, b: 255, a: 0 } });
});

test('before, close the layer dialog mid-preview, after: the canvas goes back to the stored filter', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Fill canvas');
  const [x, y] = await toScreen(page, 100, 100);
  await page.mouse.click(x, y);
  await page.locator('.hvy-canvas-layers').getByRole('button', { name: 'Layer 1 settings' }).click();
  await page.getByRole('dialog').locator('input[type="color"]').evaluate((input: HTMLInputElement) => {
    input.value = '#000000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await displayedPixel(page, 100, 100)).toEqual([0, 0, 0, 255]);

  await page.keyboard.press('Escape');

  expect((await readLayers(page))[0]!.filter).toBeUndefined();
  expect(await displayedPixel(page, 100, 100)).toEqual([18, 52, 86, 255]);
});

test('before, invert a layer, tool call: fill with the picked color, after: it shows as picked and stores the inverse', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await page.locator('.hvy-canvas-layers').getByRole('button', { name: 'Layer 1 settings' }).click();
  await page.getByRole('dialog').getByText('Invert colors').click();
  await page.keyboard.press('Escape');

  await chooseTool(page, 'Fill canvas');
  const [x, y] = await toScreen(page, 100, 100);
  await page.mouse.click(x, y);

  expect(await displayedPixel(page, 100, 100)).toEqual([18, 52, 86, 255]);
  expect((await readLayers(page))[0]!.items).toEqual([expect.objectContaining({ kind: 'fill', color: '#edcba9' })]);
});

// Where a logical point sits within the canvas element: changes only when the
// canvas itself pans or zooms, not when the surrounding page scrolls.
async function pointInsideCanvas(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.locator('[data-hvy-canvas-id]').evaluate((root: HTMLElement, point) => {
    const client = root.hvyCanvas!.toClientPoint(point);
    const rect = root.querySelector('.hvy-canvas-surface')!.getBoundingClientRect();
    return { x: client.x - rect.left, y: client.y - rect.top };
  }, { x, y });
}

test('scrolling over an unfocused canvas leaves it alone; once focused, the canvas takes the wheel', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  const [x, y] = await toScreen(page, 200, 100);
  await page.mouse.move(x, y);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const start = await pointInsideCanvas(page, 200, 100);

  await page.mouse.wheel(0, 120);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  expect(await pointInsideCanvas(page, 200, 100)).toEqual(start);
  expect(await zoomLabel(page)).toBe('100%');

  await page.locator('.hvy-canvas-surface').focus();
  await page.mouse.move(...await toScreen(page, 200, 100));
  await page.mouse.wheel(0, 60);
  expect((await pointInsideCanvas(page, 200, 100)).y).toBeLessThan(start.y - 20);
});

test('the hand tool pans by dragging without drawing, and the middle button pans with any tool', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await page.locator('.hvy-canvas-surface').focus();
  await page.keyboard.down('Control');
  await page.mouse.move(...await toScreen(page, 200, 100));
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await chooseTool(page, 'Hand (pan)');
  expect(await page.locator('.hvy-canvas-surface').evaluate((canvas) => getComputedStyle(canvas).cursor)).toBe('grab');
  const start = await pointInsideCanvas(page, 200, 100);

  const [x, y] = await toScreen(page, 200, 100);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y - 30, { steps: 4 });
  await page.mouse.up();
  const afterHand = await pointInsideCanvas(page, 200, 100);
  expect(afterHand.x).toBeCloseTo(start.x - 40, 0);
  expect(afterHand.y).toBeCloseTo(start.y - 30, 0);

  await chooseTool(page, 'Brush');
  const [bx, by] = await toScreen(page, 200, 100);
  await page.mouse.move(bx, by);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bx + 25, by, { steps: 3 });
  await page.mouse.up({ button: 'middle' });
  expect((await pointInsideCanvas(page, 200, 100)).x).toBeCloseTo(afterHand.x + 25, 0);
  expect((await readLayers(page)).flatMap((layer) => layer.items)).toEqual([]);
});

test('a new canvas starts on the hand tool, so a stray drag pans instead of drawing', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);

  await expect(page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Hand (pan)', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('WebKit trackpad pinch gesture events zoom a focused canvas around the pinch point and leave an unfocused one alone', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  const [x, y] = await toScreen(page, 200, 100);
  const pinch = (scales: number[]) => page.locator('.hvy-canvas-surface').evaluate((canvas, { scales, x, y }) => {
    // WebKit's GestureEvent isn't constructible elsewhere; carry the same fields on a plain event.
    const send = (type: string, scale: number) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: x, clientY: y });
      canvas.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const prevented = [send('gesturestart', 1), ...scales.map((scale) => send('gesturechange', scale)), send('gestureend', scales[scales.length - 1]!)];
    return prevented.every(Boolean);
  }, { scales, x, y });

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await pinch([1.5, 2])).toBe(false);
  expect(await zoomLabel(page)).toBe('100%');

  await page.locator('.hvy-canvas-surface').focus();
  expect(await pinch([1.5, 2])).toBe(true);
  expect(await zoomLabel(page)).toBe('200%');
  const [afterX, afterY] = await toScreen(page, 200, 100);
  expect(Math.abs(afterX - x)).toBeLessThan(1);
  expect(Math.abs(afterY - y)).toBeLessThan(1);
});

test('expand moves the same canvas into a large panel; Escape and dialogs keep it open; Collapse puts it back', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Rectangle');
  const [fromX, fromY] = await toScreen(page, 60, 40);
  const [toX, toY] = await toScreen(page, 160, 120);
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 4 });
  await page.mouse.up();
  const inlineHeight = (await page.locator('.hvy-canvas-plugin').boundingBox())!.height;

  await page.locator('.hvy-canvas-zoom-controls').getByRole('button', { name: 'Expand canvas' }).click();
  const panel = page.locator('.hvy-canvas-expanded-panel');
  await expect(panel.locator('.hvy-canvas-plugin')).toHaveCount(1);
  await expect(page.locator('.hvy-canvas-expanded-placeholder')).toHaveCount(1);
  expect((await page.locator('.hvy-canvas-expanded-placeholder').boundingBox())!.height).toBeCloseTo(inlineHeight, 0);
  await expect(panel.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Rectangle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hvy-canvas-surface')).toBeFocused();

  // Escape deselects the new rectangle without closing the expanded view.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(1);

  // Settings stack above the expanded view; closing them leaves it open.
  await panel.getByRole('button', { name: 'Canvas settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Canvas settings' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Canvas settings' })).toHaveCount(0);
  await expect(panel).toHaveCount(1);

  // The same zoom-controls button now collapses it.
  await panel.locator('.hvy-canvas-zoom-controls').getByRole('button', { name: 'Collapse canvas' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.hvy-canvas-expanded-placeholder')).toHaveCount(0);
  await expect(page.locator('#canvas-test-host .hvy-canvas-plugin')).toHaveCount(1);
  expect((await readLayers(page))[0]!.items).toHaveLength(1);
});

test('the expanded view stays open when the editor re-renders', async ({ page }) => {
  test.setTimeout(5_000);
  // The reference app, whose full editor render is reachable from the test.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    state.document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: hvy.canvas
---

<!--hvy: {"id":"canvas-section","contained":false}-->
#! Canvas Section

<!--hvy:plugin {"id":"sketch","plugin":"hvy.canvas","pluginConfig":{"drawing":"sketch","width":400,"height":200}}-->
Placeholder sketch description.
`, '.hvy');
    state.history = [];
    state.future = [];
    getRenderApp()();
  });
  await page.locator('.hvy-canvas-zoom-controls').getByRole('button', { name: 'Expand canvas' }).click();
  await expect(page.locator('.hvy-canvas-expanded-panel')).toHaveCount(1);

  await page.evaluate(async () => {
    const { getRenderApp } = await import('/src/state.ts');
    getRenderApp()();
  });

  await expect(page.locator('.hvy-canvas-expanded-panel .hvy-canvas-plugin')).toHaveCount(1, { timeout: 1_000 });
  await expect(page.locator('.hvy-canvas-plugin')).toHaveCount(1);
});

test('canvas settings sit at the right end of the toolbar, and expand sits after Fit in the zoom controls', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  const row = (await page.locator('.hvy-canvas-toolbar-row').first().boundingBox())!;
  const settings = (await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Canvas settings' }).boundingBox())!;
  expect(row.x + row.width - (settings.x + settings.width)).toBeLessThan(2);

  const labels = await page.locator('.hvy-canvas-zoom-controls button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  expect(labels.slice(-2)).toEqual(['Fit to window', 'Expand canvas']);
  await expect(page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Expand canvas' })).toHaveCount(0);
});

