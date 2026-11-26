import { expect, test, type Page } from '@playwright/test';

const CANVAS_SOURCE = `---
hvy_version: 0.1
title: Canvas Whiteboard
plugins:
  - id: hvy.canvas
---

<!--hvy: {"id":"canvas-section","contained":false}-->
#! Canvas Section

<!--hvy:plugin {"id":"sketch","plugin":"hvy.canvas","pluginConfig":{"drawing":"sketch","width":200,"height":100,"strokeWidth":8}}-->
Placeholder sketch description.
`;

async function mountCanvasEditor(page: Page, source = CANVAS_SOURCE, mode: 'editor' | 'viewer' = 'editor'): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async ([source, mode]) => {
    const [{ deserializeDocument }, { mountHvy }, { canvasPlugin }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/embed-full.ts'),
      import('/src/plugins/canvas/canvas.ts'),
    ]);
    document.body.innerHTML = '<div id="whiteboard-host" style="height: 900px"></div>';
    (window as typeof window & { whiteboardMount?: unknown }).whiteboardMount = mountHvy({
      root: document.querySelector<HTMLElement>('#whiteboard-host')!,
      document: deserializeDocument(source, '.hvy'),
      mode,
      plugins: [canvasPlugin],
    });
  }, [source, mode] as const);
  await expect(page.locator('.hvy-canvas-surface')).toBeVisible();
}

async function readItemKinds(page: Page): Promise<{ stored: string[]; shown: string[] }> {
  return page.evaluate(async () => {
    const { getAttachment } = await import('/src/attachments.ts');
    const mount = (window as typeof window & { whiteboardMount: { getDocument(): Parameters<typeof getAttachment>[0] } }).whiteboardMount;
    const attachment = getAttachment(mount.getDocument(), 'canvas:sketch');
    const stored: Array<{ items: Array<{ kind: string }> }> = attachment ? JSON.parse(new TextDecoder().decode(attachment.bytes)).layers : [];
    const shown = document.querySelector<HTMLElement>('[data-hvy-canvas-id="sketch"]')?.hvyCanvas?.getDrawing().layers ?? [];
    const kindsOf = (layers: Array<{ items: Array<{ kind: string }> }>) => layers.flatMap((layer) => layer.items.map((item) => item.kind));
    return { stored: kindsOf(stored), shown: kindsOf(shown) };
  });
}

// Page coordinates of a point given as fractions of the 200 x 100 artboard.
async function artboardPoint(page: Page, fraction: [number, number]): Promise<[number, number]> {
  await page.locator('.hvy-canvas-surface').scrollIntoViewIfNeeded();
  const client = await page.locator('[data-hvy-canvas-id]').evaluate((root: HTMLElement, point) => root.hvyCanvas!.toClientPoint(point), { x: fraction[0] * 200, y: fraction[1] * 100 });
  return [client.x, client.y];
}

async function dragOnCanvas(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(...await artboardPoint(page, from));
  await page.mouse.down();
  await page.mouse.move(...await artboardPoint(page, to), { steps: 4 });
  await page.mouse.up();
}

async function chooseTool(page: Page, name: string): Promise<void> {
  const button = page.getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
}

test('before, eraser drag, after: the eraser splits a brush stroke and app undo/redo walk it back and forth', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);

  // BEFORE: one horizontal brush stroke.
  await chooseTool(page, 'Brush');
  await dragOnCanvas(page, [0.1, 0.5], [0.9, 0.5]);
  expect(await readItemKinds(page)).toEqual({ stored: ['brush'], shown: ['brush'] });

  // ERASER DRAG: a vertical sweep through the middle.
  await chooseTool(page, 'Eraser');
  await dragOnCanvas(page, [0.5, 0.1], [0.5, 0.9]);

  // AFTER: two brush strokes and no erase layer.
  expect(await readItemKinds(page)).toEqual({ stored: ['brush', 'brush'], shown: ['brush', 'brush'] });

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readItemKinds(page), { timeout: 1_000 }).toEqual({ stored: ['brush'], shown: ['brush'] });

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readItemKinds(page), { timeout: 1_000 }).toEqual({ stored: [], shown: [] });

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => readItemKinds(page), { timeout: 1_000 }).toEqual({ stored: ['brush'], shown: ['brush'] });

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => readItemKinds(page), { timeout: 1_000 }).toEqual({ stored: ['brush', 'brush'], shown: ['brush', 'brush'] });
});

test('before, script edit, app undo: script canvas changes are not undo steps and a stale whiteboard step leaves the drawing alone', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);

  // BEFORE: one whiteboard stroke, then a script replaces the drawing.
  await dragOnCanvas(page, [0.1, 0.5], [0.9, 0.5]);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-hvy-canvas-id="sketch"]')!.hvyCanvas!.setDrawing({
      version: 2,
      layers: [{ id: 'layer-1', name: 'Layer 1', visible: true, locked: false, items: [{ kind: 'fill', color: '#123456' }] }],
    });
  });
  expect(await readItemKinds(page)).toEqual({ stored: ['fill'], shown: ['fill'] });

  // APP UNDO: the only undo step is the whiteboard stroke, which is no longer in place.
  await page.evaluate(() => (window as typeof window & { whiteboardMount: { undo(): Promise<void> } }).whiteboardMount.undo());

  // AFTER: the script's drawing is untouched.
  expect(await readItemKinds(page)).toEqual({ stored: ['fill'], shown: ['fill'] });
});

// The displayed pixel at a point given as fractions of the artboard.
async function readCanvasPixel(page: Page, x: number, y: number): Promise<number[]> {
  const [clientX, clientY] = await artboardPoint(page, [x, y]);
  return page.locator('.hvy-canvas-surface').evaluate((canvas: HTMLCanvasElement, [cx, cy]) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return [...canvas.getContext('2d')!.getImageData(Math.round((cx - rect.left) * scale), Math.round((cy - rect.top) * scale), 1, 1).data];
  }, [clientX, clientY]);
}

test('before, eraser drag over a fill, after: the fill shows a cutout hole and app undo fills it back in', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page, CANVAS_SOURCE.replace('"strokeWidth":8', '"strokeWidth":16,"strokeColor":"#ff0000"'));

  // BEFORE: the whole canvas is filled red.
  await chooseTool(page, 'Fill canvas');
  const surface = page.locator('.hvy-canvas-surface');
  await surface.scrollIntoViewIfNeeded();
  await surface.click({ position: { x: 5, y: 5 } });
  expect(await readCanvasPixel(page, 0.5, 0.5)).toEqual([255, 0, 0, 255]);

  // ERASER DRAG: a vertical sweep through the middle.
  await chooseTool(page, 'Eraser');
  await dragOnCanvas(page, [0.5, 0.1], [0.5, 0.9]);

  // AFTER: a transparent hole in the middle, the corner still filled.
  // The hole shows the editor's artboard background instead of the red fill.
  expect(await readCanvasPixel(page, 0.5, 0.5)).not.toEqual([255, 0, 0, 255]);
  expect(await readCanvasPixel(page, 0.05, 0.05)).toEqual([255, 0, 0, 255]);
  expect(await readItemKinds(page)).toEqual({ stored: ['fill'], shown: ['fill'] });

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readCanvasPixel(page, 0.5, 0.5), { timeout: 1_000 }).toEqual([255, 0, 0, 255]);
});

test('before, viewer drawing, after: whiteboard strokes in the viewer are undo and redo steps', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page, CANVAS_SOURCE.replace('"strokeWidth":8', '"strokeWidth":8,"viewerDrawing":true'), 'viewer');

  // BEFORE: two strokes drawn in the viewer.
  await dragOnCanvas(page, [0.1, 0.3], [0.9, 0.3]);
  await dragOnCanvas(page, [0.1, 0.7], [0.9, 0.7]);
  expect(await readItemKinds(page)).toEqual({ stored: ['brush', 'brush'], shown: ['brush', 'brush'] });

  // UNDO, then REDO, through the mount.
  await page.evaluate(() => (window as typeof window & { whiteboardMount: { undo(): Promise<void> } }).whiteboardMount.undo());
  expect(await readItemKinds(page)).toEqual({ stored: ['brush'], shown: ['brush'] });

  await page.evaluate(() => (window as typeof window & { whiteboardMount: { redo(): Promise<void> } }).whiteboardMount.redo());
  expect(await readItemKinds(page)).toEqual({ stored: ['brush', 'brush'], shown: ['brush', 'brush'] });
});

test('canvas toolbar has square tool buttons, quick sizes, a round eraser preview, and script changes redraw once and save', async ({ page }) => {
  test.setTimeout(5_000);
  await mountCanvasEditor(page);

  const brush = page.getByRole('button', { name: 'Brush', exact: true });
  const brushBounds = (await brush.boundingBox())!;
  expect(Math.abs(brushBounds.width - brushBounds.height)).toBeLessThan(1);

  await chooseTool(page, 'Eraser');
  await expect(page.getByRole('button', { name: 'Eraser', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const largeSize = page.getByRole('button', { name: 'Brush size 16' });
  await largeSize.click();
  await expect(largeSize).toHaveAttribute('aria-pressed', 'true');
  const surface = page.locator('.hvy-canvas-surface');
  await surface.scrollIntoViewIfNeeded();
  await surface.hover({ position: { x: 120, y: 60 } });
  const cursorBounds = (await page.locator('.hvy-canvas-cursor-preview').boundingBox())!;
  expect(cursorBounds.width).toBeGreaterThan(2);
  expect(Math.abs(cursorBounds.width - cursorBounds.height)).toBeLessThan(1);

  // Script API: add then remove an item; each change redraws once and is saved.
  expect(await surface.evaluate((canvas) => {
    const root = canvas.closest<HTMLElement>('[data-hvy-canvas-id]')!;
    const api = root.hvyCanvas!;
    api.addItem({ kind: 'brush', color: '#123456', width: 4, points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] });
    let renderCount = 0;
    root.addEventListener('hvy:canvas:render', () => {
      renderCount += 1;
    });
    api.undo();
    return renderCount;
  })).toBe(1);
  expect(await readItemKinds(page)).toEqual({ stored: [], shown: [] });
});

