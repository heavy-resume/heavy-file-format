import { expect, test, type Page } from '@playwright/test';

// Logical canvas size used by every test: coordinates below are in these units.
const CANVAS_SOURCE = `---
hvy_version: 0.1
title: Canvas Shapes
plugins:
  - id: hvy.canvas
---

<!--hvy: {"id":"canvas-section","contained":false}-->
#! Canvas Section

<!--hvy:plugin {"id":"sketch","plugin":"hvy.canvas","pluginConfig":{"drawing":"sketch","width":400,"height":200,"strokeWidth":4,"strokeColor":"#123456"}}-->
Placeholder sketch description.
`;

interface StoredLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  items: Array<Record<string, unknown> & { kind: string }>;
}

async function mountCanvasEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { mountHvy }, { canvasPlugin }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/embed-full.ts'),
      import('/src/plugins/canvas/canvas.ts'),
    ]);
    document.body.innerHTML = '<div id="shapes-host" style="height: 900px"></div>';
    (window as typeof window & { shapesMount?: unknown }).shapesMount = mountHvy({
      root: document.querySelector<HTMLElement>('#shapes-host')!,
      document: deserializeDocument(source, '.hvy'),
      mode: 'editor',
      plugins: [canvasPlugin],
    });
  }, CANVAS_SOURCE);
  await expect(page.locator('.hvy-canvas-surface')).toBeVisible();
}

async function readLayers(page: Page): Promise<StoredLayer[]> {
  return page.evaluate(async () => {
    const { getAttachment } = await import('/src/attachments.ts');
    const mount = (window as typeof window & { shapesMount: { getDocument(): Parameters<typeof getAttachment>[0] } }).shapesMount;
    const attachment = getAttachment(mount.getDocument(), 'canvas:sketch');
    return attachment ? JSON.parse(new TextDecoder().decode(attachment.bytes)).layers : [];
  });
}

async function readItems(page: Page): Promise<StoredLayer['items']> {
  return (await readLayers(page)).flatMap((layer) => layer.items);
}

// Converts logical canvas coordinates to page coordinates at the current zoom and pan.
async function toScreen(page: Page, x: number, y: number): Promise<[number, number]> {
  await page.locator('.hvy-canvas-surface').scrollIntoViewIfNeeded();
  const client = await page.locator('[data-hvy-canvas-id]').evaluate((root: HTMLElement, point) => root.hvyCanvas!.toClientPoint(point), { x, y });
  return [client.x, client.y];
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(...await toScreen(page, ...from));
  await page.mouse.down();
  await page.mouse.move(...await toScreen(page, ...to), { steps: 5 });
  await page.mouse.up();
}

async function clickCanvas(page: Page, at: [number, number]): Promise<void> {
  await page.mouse.click(...await toScreen(page, ...at));
}

async function chooseTool(page: Page, name: string): Promise<void> {
  const button = page.locator('.hvy-canvas-toolbar').getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
}

test('before, shift-drag a rectangle, undo: the shape is a square, stays selected, and undo removes its placement', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Rectangle');

  await page.keyboard.down('Shift');
  await drag(page, [40, 20], [120, 160]);
  await page.keyboard.up('Shift');

  const [square] = await readItems(page);
  expect(square).toMatchObject({ kind: 'shape', shape: 'rect', from: { x: expect.closeTo(40, 0), y: expect.closeTo(20, 0) } });
  const to = square!.to as { x: number; y: number };
  expect(Math.abs(to.x - 40)).toBeCloseTo(Math.abs(to.y - 20), 3);

  // Selected: Delete removes it, and undo restores it.
  await page.keyboard.press('Delete');
  expect(await readItems(page)).toEqual([]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readItems(page)).length, { timeout: 1_000 }).toBe(1);

  // Undoing again undoes the placement itself.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readItems(page)).length, { timeout: 1_000 }).toBe(0);
});

test('before, bend an arrow by its curve handle, undo/redo: the adjustment and the placement are separate steps', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Arrow');

  // BEFORE: a straight arrow, still selected after placement.
  await drag(page, [60, 100], [300, 100]);
  const [straight] = await readItems(page);
  expect(straight).toMatchObject({ kind: 'shape', shape: 'line', endHead: true });
  expect(straight!.control).toBeUndefined();

  // ADJUST: drag the curve handle at the midpoint upward.
  await drag(page, [180, 100], [180, 40]);
  const [curved] = await readItems(page);
  expect(curved!.control).toBeDefined();

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readItems(page))[0]?.control, { timeout: 1_000 }).toBeUndefined();
  expect(await readItems(page)).toHaveLength(1);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readItems(page)).length, { timeout: 1_000 }).toBe(0);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await readItems(page))[0]?.control, { timeout: 1_000 }).toBeDefined();
});

test('before, quick click away from a selected shape, after: it is deselected and no new shape is drawn', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Ellipse');
  await drag(page, [40, 40], [140, 120]);

  await clickCanvas(page, [300, 160]);
  await page.keyboard.press('Delete');

  expect((await readItems(page)).map((item) => item.shape)).toEqual(['ellipse']);
});

test('line style picker sets arrowheads and dash for new arrows and restyles the selected arrow', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Arrow');
  const toolbar = page.locator('.hvy-canvas-toolbar');
  await toolbar.getByRole('button', { name: 'Start arrowhead' }).click();
  await toolbar.getByRole('button', { name: 'Line style: solid' }).click();

  await drag(page, [60, 60], [300, 60]);
  expect((await readItems(page))[0]).toMatchObject({ startHead: true, endHead: true, dash: 'dashed' });

  // The arrow is selected, so the picker now restyles it as an undo step.
  await toolbar.getByRole('button', { name: 'End arrowhead' }).click();
  expect((await readItems(page))[0]!.endHead).toBeUndefined();
});

test('arrow ends snap onto a nearby box edge', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Rectangle');
  await drag(page, [200, 50], [320, 150]);
  await clickCanvas(page, [380, 12]);

  await chooseTool(page, 'Arrow');
  await drag(page, [40, 100], [198, 104]);

  const arrow = (await readItems(page)).find((item) => item.shape === 'line')!;
  expect((arrow.to as { x: number }).x).toBeCloseTo(200, 3);
});

test('before, text tool click inside a box, type, after: the label is centered in the box and undo removes it', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Rectangle');
  await drag(page, [100, 40], [300, 160]);
  await clickCanvas(page, [380, 12]);

  await chooseTool(page, 'Text');
  await clickCanvas(page, [150, 80]);
  const editor = page.locator('.hvy-canvas-text-editor');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Placeholder label');
  await page.keyboard.press('Escape');

  const label = (await readItems(page)).find((item) => item.kind === 'text')!;
  expect(label).toMatchObject({ text: 'Placeholder label', at: { x: 200, y: 100 }, color: '#123456' });

  await page.locator('.hvy-canvas-surface').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readItems(page)).filter((item) => item.kind === 'text').length, { timeout: 1_000 }).toBe(0);
});

test('layers: adding, locking, hiding, and reordering are undoable, and locked layers ignore drawing', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  const panel = page.locator('.hvy-canvas-layers');

  await panel.getByRole('button', { name: 'Add layer' }).click();
  expect((await readLayers(page)).map((layer) => layer.name)).toEqual(['Layer 1', 'Layer 2']);

  await chooseTool(page, 'Brush');
  await drag(page, [40, 100], [200, 100]);
  expect((await readLayers(page))[1]!.items).toHaveLength(1);

  await panel.getByRole('button', { name: 'Lock Layer 2' }).click();
  await drag(page, [40, 150], [200, 150]);
  expect((await readLayers(page))[1]).toMatchObject({ locked: true });
  expect((await readLayers(page))[1]!.items).toHaveLength(1);

  await panel.getByRole('button', { name: 'Hide Layer 2' }).click();
  await panel.getByRole('button', { name: 'Drag to reorder Layer 2' }).press('ArrowDown');
  expect((await readLayers(page)).map((layer) => [layer.name, layer.visible])).toEqual([['Layer 2', false], ['Layer 1', true]]);

  await page.locator('.hvy-canvas-surface').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await readLayers(page)).map((layer) => layer.name), { timeout: 1_000 }).toEqual(['Layer 1', 'Layer 2']);
});

// Moves through the points with pauses longer than the 200 ms sampling interval.
async function slowDrag(page: Page, points: Array<[number, number]>): Promise<void> {
  await page.mouse.move(...await toScreen(page, ...points[0]!));
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(...await toScreen(page, ...point), { steps: 2 });
    await page.waitForTimeout(210);
  }
  await page.mouse.up();
}

test('a wobbly freehand arrow drag becomes a straight line, and an arched drag becomes a curve', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);
  await chooseTool(page, 'Arrow');

  await slowDrag(page, [[40, 60], [100, 62], [160, 58], [220, 61], [280, 60]]);
  await clickCanvas(page, [390, 10]);
  await slowDrag(page, [[40, 180], [100, 120], [160, 100], [220, 120], [280, 180]]);

  const lines = (await readItems(page)).filter((item) => item.shape === 'line');
  expect(lines[0]!.control).toBeUndefined();
  expect((lines[1]!.control as { y: number }).y).toBeLessThan(100);
});
