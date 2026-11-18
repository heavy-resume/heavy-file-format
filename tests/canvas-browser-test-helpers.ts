import { expect, type Page } from '@playwright/test';

// Shared helpers for canvas browser tests. Every helper works in the logical
// coordinates of a 400 x 200 canvas mounted as an embedded editor.

export const CANVAS_TEST_SOURCE = `---
hvy_version: 0.1
title: Canvas Test
plugins:
  - id: hvy.canvas
---

<!--hvy: {"id":"canvas-section","contained":false}-->
#! Canvas Section

<!--hvy:plugin {"id":"sketch","plugin":"hvy.canvas","pluginConfig":{"drawing":"sketch","width":400,"height":200,"strokeWidth":4,"strokeColor":"#123456"}}-->
Placeholder sketch description.
`;

export interface StoredCanvasLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  items: Array<Record<string, unknown> & { kind: string; id?: string }>;
}

export async function mountCanvasEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { mountHvy }, { canvasPlugin }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/embed-full.ts'),
      import('/src/plugins/canvas/canvas.ts'),
    ]);
    document.body.innerHTML = '<div id="canvas-test-host" style="height: 900px"></div>';
    (window as typeof window & { canvasTestMount?: unknown }).canvasTestMount = mountHvy({
      root: document.querySelector<HTMLElement>('#canvas-test-host')!,
      document: deserializeDocument(source, '.hvy'),
      mode: 'editor',
      plugins: [canvasPlugin],
    });
  }, CANVAS_TEST_SOURCE);
  await expect(page.locator('.hvy-canvas-surface')).toBeVisible();
}

export async function readLayers(page: Page): Promise<StoredCanvasLayer[]> {
  return page.evaluate(async () => {
    const { getAttachment } = await import('/src/attachments.ts');
    const mount = (window as typeof window & { canvasTestMount: { getDocument(): Parameters<typeof getAttachment>[0] } }).canvasTestMount;
    const attachment = getAttachment(mount.getDocument(), 'canvas:sketch');
    return attachment ? JSON.parse(new TextDecoder().decode(attachment.bytes)).layers : [];
  });
}

export async function readItems(page: Page): Promise<StoredCanvasLayer['items']> {
  return (await readLayers(page)).flatMap((layer) => layer.items);
}

// Page coordinates of a logical canvas point at the canvas's current zoom and pan.
export async function toScreen(page: Page, x: number, y: number): Promise<[number, number]> {
  await page.locator('.hvy-canvas-surface').scrollIntoViewIfNeeded();
  const client = await page.locator('[data-hvy-canvas-id]').evaluate((root: HTMLElement, point) => root.hvyCanvas!.toClientPoint(point), { x, y });
  return [client.x, client.y];
}

export async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(...await toScreen(page, ...from));
  await page.mouse.down();
  await page.mouse.move(...await toScreen(page, ...to), { steps: 5 });
  await page.mouse.up();
}

export async function clickCanvas(page: Page, at: [number, number]): Promise<void> {
  await page.mouse.click(...await toScreen(page, ...at));
}

export async function chooseTool(page: Page, name: string): Promise<void> {
  const button = page.locator('.hvy-canvas-toolbar').getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
}
