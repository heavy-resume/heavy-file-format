import { expect, test, type Page } from '@playwright/test';
import { chooseTool, clickCanvas, drag, mountCanvasEditor, readItems, readLayers } from './canvas-browser-test-helpers';

async function drawBox(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await chooseTool(page, 'Rectangle');
  await drag(page, from, to);
}

function boxLeft(item: Record<string, unknown> | undefined): number {
  return Math.min((item!.from as { x: number }).x, (item!.to as { x: number }).x);
}

test('before, select tool drag on an older shape, undo: the shape moves as one step', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await drawBox(page, [40, 40], [120, 100]);
  await drawBox(page, [200, 40], [280, 100]);

  await chooseTool(page, 'Select');
  await drag(page, [80, 70], [120, 70]);

  const [moved, untouched] = await readItems(page);
  expect(boxLeft(moved)).toBeCloseTo(80, 0);
  expect(boxLeft(untouched)).toBeCloseTo(200, 0);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => boxLeft((await readItems(page))[0]), { timeout: 1_000 }).toBeCloseTo(40, 0);
});

test('shift-click and the selection box select several items, which delete together', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await drawBox(page, [40, 40], [120, 100]);
  await drawBox(page, [200, 40], [280, 100]);
  await drawBox(page, [300, 140], [360, 190]);
  await chooseTool(page, 'Select');

  await clickCanvas(page, [80, 70]);
  await page.keyboard.down('Shift');
  await clickCanvas(page, [240, 70]);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Delete');
  expect(await readItems(page)).toHaveLength(1);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readItems(page)).length, { timeout: 1_000 }).toBe(3);

  // A selection box over empty space picks the items entirely inside it.
  await drag(page, [20, 20], [300, 120]);
  await page.keyboard.press('Delete');
  expect((await readItems(page)).map((item) => boxLeft(item))).toEqual([300]);
});

test('before, drag the corner of a selected brush stroke, after: the stroke scales and keeps its width', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Brush');
  await drag(page, [100, 100], [200, 150]);
  const [before] = await readItems(page);

  await chooseTool(page, 'Select');
  await clickCanvas(page, [150, 125]);
  const points = before!.points as Array<{ x: number; y: number }>;
  const corner: [number, number] = [Math.max(...points.map((point) => point.x)), Math.max(...points.map((point) => point.y))];
  await drag(page, corner, [corner[0] + 100, corner[1] + 40]);

  const [after] = await readItems(page);
  const afterPoints = after!.points as Array<{ x: number; y: number }>;
  expect(Math.max(...afterPoints.map((point) => point.x))).toBeGreaterThan(corner[0] + 80);
  expect(after!.width).toBe(before!.width);
  expect(after!.id).toBe(before!.id);
});

test('select tool: clicking selected text again reopens it for editing', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Text');
  await clickCanvas(page, [200, 100]);
  await page.keyboard.type('Placeholder');
  await page.keyboard.press('Escape');
  await clickCanvas(page, [380, 12]);

  await chooseTool(page, 'Select');
  await clickCanvas(page, [200, 100]);
  await expect(page.locator('.hvy-canvas-text-editor')).toHaveCount(0);
  await clickCanvas(page, [200, 100]);
  await expect(page.locator('.hvy-canvas-text-editor')).toHaveText('Placeholder');
});

test('layer rows: click picks the draw layer, shift-click adds a layer or isolates a selected one', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  const panel = page.locator('.hvy-canvas-layers');
  const rowState = () => panel.locator('.hvy-canvas-layer-row').evaluateAll((rows) => rows.map((row) => (
    `${row.querySelector('.hvy-canvas-layer-name')!.textContent}:${row.classList.contains('is-active') ? 'draw' : row.classList.contains('is-selected') ? 'selected' : '-'}`
  )));
  const layerName = (name: string) => panel.locator('.hvy-canvas-layer-name', { hasText: name });

  await panel.getByRole('button', { name: 'Add layer' }).click();
  expect(await rowState()).toEqual(['Layer 2:draw', 'Layer 1:-']);

  await layerName('Layer 1').click();
  expect(await rowState()).toEqual(['Layer 2:-', 'Layer 1:draw']);

  await layerName('Layer 2').click({ modifiers: ['Shift'] });
  expect(await rowState()).toEqual(['Layer 2:selected', 'Layer 1:draw']);

  await layerName('Layer 2').click();
  expect(await rowState()).toEqual(['Layer 2:draw', 'Layer 1:selected']);

  await layerName('Layer 1').click({ modifiers: ['Shift'] });
  expect(await rowState()).toEqual(['Layer 2:-', 'Layer 1:draw']);
});

test('the selection box reaches every selected layer, while drawing stays on the draw layer', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  const panel = page.locator('.hvy-canvas-layers');
  await drawBox(page, [40, 40], [120, 100]);
  await panel.getByRole('button', { name: 'Add layer' }).click();
  await drawBox(page, [200, 40], [280, 100]);
  expect((await readLayers(page)).map((layer) => layer.items.length)).toEqual([1, 1]);

  await panel.locator('.hvy-canvas-layer-name', { hasText: 'Layer 1' }).click({ modifiers: ['Shift'] });
  await chooseTool(page, 'Select');
  await drag(page, [20, 20], [300, 120]);
  await page.keyboard.press('Delete');

  expect((await readLayers(page)).map((layer) => layer.items.length)).toEqual([0, 0]);
});

test('a second arrow lines up with the first, and holding Cmd or Alt places it freely', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Arrow');
  await drag(page, [40, 100], [160, 100]);
  await clickCanvas(page, [380, 12]);

  await drag(page, [240, 102], [360, 101]);
  const aligned = (await readItems(page))[1]!;
  expect((aligned.from as { y: number }).y).toBeCloseTo(100, 3);
  expect((aligned.to as { y: number }).y).toBeCloseTo(100, 3);
  await clickCanvas(page, [380, 12]);

  await page.keyboard.down('Alt');
  await drag(page, [240, 152], [360, 151]);
  await page.keyboard.up('Alt');
  const free = (await readItems(page))[2]!;
  expect((free.to as { y: number }).y).not.toBeCloseTo(150, 1);
});

test('arrow keys nudge the selection by a screen pixel, or ten with Shift', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await drawBox(page, [40, 40], [120, 100]);
  const unitsPerPixel = await page.locator('[data-hvy-canvas-id]').evaluate((root: HTMLElement) => (
    1 / (root.hvyCanvas!.toClientPoint({ x: 1, y: 0 }).x - root.hvyCanvas!.toClientPoint({ x: 0, y: 0 }).x)
  ));

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');

  expect(boxLeft((await readItems(page))[0])).toBeCloseTo(40 + 11 * unitsPerPixel, 3);
});

test('font size: pick a common size from the list for new text, then type a size for the selected text', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Text');
  const fontSize = page.locator('.hvy-canvas-toolbar').getByRole('spinbutton', { name: 'Font size' });
  await expect(fontSize).toHaveValue('24');

  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Common font sizes' }).click();
  await page.getByRole('option', { name: '72', exact: true }).click();
  await expect(fontSize).toHaveValue('72');

  await clickCanvas(page, [200, 100]);
  await page.keyboard.type('Placeholder');
  await page.keyboard.press('Escape');
  expect((await readItems(page))[0]).toMatchObject({ kind: 'text', size: 72 });

  // The new text stays selected, so the field now restyles it.
  await fontSize.fill('17');
  await fontSize.press('Enter');
  expect((await readItems(page))[0]).toMatchObject({ kind: 'text', size: 17 });
});


test('the text tool shows a text cursor over the canvas', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Text');

  expect(await page.locator('.hvy-canvas-surface').evaluate((canvas) => getComputedStyle(canvas).cursor)).toBe('text');
});

test('while editing text, the font size list sizes the selected word and keeps the editor open', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Text');
  await clickCanvas(page, [200, 100]);
  await page.keyboard.type('Placeholder words');
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Shift+ArrowLeft');

  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Common font sizes' }).click();
  await page.getByRole('option', { name: '48', exact: true }).click();
  await expect(page.locator('.hvy-canvas-text-editor')).toBeFocused();
  await page.keyboard.press('Escape');

  expect((await readItems(page))[0]).toMatchObject({ text: 'Placeholder words', size: 24, sizes: [{ start: 12, end: 17, size: 48 }] });
});

test('while editing text with nothing selected, a font size applies to the whole text', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Text');
  await clickCanvas(page, [200, 100]);
  await page.keyboard.type('Placeholder');

  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Common font sizes' }).click();
  await page.getByRole('option', { name: '12', exact: true }).click();
  await page.keyboard.press('Escape');

  const [text] = await readItems(page);
  expect(text).toMatchObject({ text: 'Placeholder', size: 12 });
  expect(text!.sizes).toBeUndefined();
});

test('stepping the font size field applies on every step', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Text');
  await clickCanvas(page, [200, 100]);
  await page.keyboard.type('Placeholder');
  await page.keyboard.press('Escape');
  const fontSize = page.locator('.hvy-canvas-toolbar').getByRole('spinbutton', { name: 'Font size' });

  await fontSize.focus();
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
  }

  expect((await readItems(page))[0]).toMatchObject({ size: 27 });
  await expect(fontSize).toBeFocused();
});
