import { expect, test } from '@playwright/test';

const PHVY_CANVAS_SOURCE = `---
hvy_version: 0.1
title: Canvas PDF Export
plugins:
  - id: hvy.canvas
---

<!--hvy: {"id":"canvas-section","contained":false}-->
#! Canvas Section

<!--hvy:plugin {"id":"sketch","plugin":"hvy.canvas","pluginConfig":{"drawing":"sketch","width":200,"height":100,"viewerDrawing":false},"css":"width: 50%;"}-->
Placeholder sketch description.
`;

test('before, PDF export prep, after: PHVY canvas resolves to a PNG image block of the drawing', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();

  const result = await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { setAttachment, getAttachment }, { preparePdfExport }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/attachments.ts'),
      import('/src/pdf-export/export.ts'),
    ]);
    const document = deserializeDocument(source, '.phvy');
    // BEFORE: the left half of the logical canvas is filled red by one stroke.
    setAttachment(document, 'canvas:sketch', { plugin: 'hvy.canvas', mediaType: 'application/vnd.hvy.canvas+json' }, new TextEncoder().encode(JSON.stringify({
      version: 2,
      layers: [{ id: 'layer-1', name: 'Layer 1', visible: true, locked: false, items: [{ kind: 'brush', color: '#ff0000', width: 100, points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] }] }],
    })));

    // PDF EXPORT PREP
    const { sourceDocument, exportDocument } = await preparePdfExport(document, { runPrepScript: false });

    // AFTER
    const exportedBlock = exportDocument.sections[0]!.blocks[0]!;
    const imageAttachment = getAttachment(exportDocument, `image:${exportedBlock.schema.imageFile}`)!;
    const bitmap = await createImageBitmap(new Blob([imageAttachment.bytes], { type: 'image/png' }));
    const probe = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    probe.drawImage(bitmap, 0, 0);
    return {
      exportedComponent: exportedBlock.schema.component,
      exportedImageFile: exportedBlock.schema.imageFile,
      exportedImageAlt: exportedBlock.schema.imageAlt,
      exportedCss: exportedBlock.schema.css,
      imageMediaType: imageAttachment.meta.mediaType,
      imageSize: [bitmap.width, bitmap.height],
      leftPixel: [...probe.getImageData(150, 150, 1, 1).data],
      rightPixel: [...probe.getImageData(450, 150, 1, 1).data],
      sourceComponent: sourceDocument.sections[0]!.blocks[0]!.schema.component,
      sourceHasStaticImage: getAttachment(sourceDocument, 'image:canvas-sketch.png') !== null,
    };
  }, PHVY_CANVAS_SOURCE);

  expect(result).toEqual({
    exportedComponent: 'image',
    exportedImageFile: 'canvas-sketch.png',
    exportedImageAlt: 'Placeholder sketch description.',
    exportedCss: 'width: 50%;',
    imageMediaType: 'image/png',
    imageSize: [600, 300],
    leftPixel: [255, 0, 0, 255],
    rightPixel: [0, 0, 0, 0],
    sourceComponent: 'plugin',
    sourceHasStaticImage: false,
  });
});

test('before, PDF export prep, after: PHVY canvas without a drawing exports a blank image at the configured size', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();

  const result = await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { getAttachment }, { preparePdfExport }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/attachments.ts'),
      import('/src/pdf-export/export.ts'),
    ]);
    const { exportDocument } = await preparePdfExport(deserializeDocument(source, '.phvy'), { runPrepScript: false });
    const exportedBlock = exportDocument.sections[0]!.blocks[0]!;
    const bitmap = await createImageBitmap(new Blob([getAttachment(exportDocument, `image:${exportedBlock.schema.imageFile}`)!.bytes], { type: 'image/png' }));
    const probe = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    probe.drawImage(bitmap, 0, 0);
    return {
      exportedComponent: exportedBlock.schema.component,
      imageSize: [bitmap.width, bitmap.height],
      centerPixel: [...probe.getImageData(300, 150, 1, 1).data],
    };
  }, PHVY_CANVAS_SOURCE);

  expect(result).toEqual({
    exportedComponent: 'image',
    imageSize: [600, 300],
    centerPixel: [0, 0, 0, 0],
  });
});

test('PHVY editor shows canvas viewer drawing as fixed off, even when stored on, and still allows drawing in the editor', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    state.document = deserializeDocument(source, '.phvy');
    state.filename = 'canvas-pdf-export.phvy';
    getRenderApp()();
  }, PHVY_CANVAS_SOURCE.replace('"viewerDrawing":false', '"viewerDrawing":true'));

  const viewerDrawingToggle = page.locator('.hvy-canvas-toggle').filter({ hasText: 'Viewer drawing' });
  await expect(viewerDrawingToggle).toHaveClass(/is-locked/, { timeout: 1_000 });
  await expect(viewerDrawingToggle.locator('input')).not.toBeChecked();
  await expect(viewerDrawingToggle.locator('input')).toBeDisabled();

  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Brush', exact: true }).click();
  const surface = page.locator('.hvy-canvas-surface');
  await surface.scrollIntoViewIfNeeded();
  const bounds = (await surface.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5, { steps: 4 });
  await page.mouse.up();

  const storedStrokeCount = await page.evaluate(async () => {
    const [{ state }, { getAttachment }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/attachments.ts'),
    ]);
    const attachment = getAttachment(state.document, 'canvas:sketch');
    return attachment ? JSON.parse(new TextDecoder().decode(attachment.bytes)).layers.flatMap((layer: { items: unknown[] }) => layer.items).length : 0;
  });
  expect(storedStrokeCount).toBe(1);
});

const UNNAMED_CANVAS_SOURCE = `---
hvy_version: 0.1
title: Unnamed Canvas
plugins:
  - id: hvy.canvas
---

<!--hvy: {"id":"canvas-section","contained":false}-->
#! Canvas Section

<!--hvy:plugin {"plugin":"hvy.canvas","pluginConfig":{"width":200,"height":100,"strokeWidth":16,"strokeColor":"#ff0000"}}-->
Placeholder sketch description.
`;

test('before, draw on a PHVY canvas without an id or drawing name, after: the drawing survives PDF export and reload', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    state.document = deserializeDocument(source, '.phvy');
    state.filename = 'unnamed-canvas.phvy';
    state.history = [];
    state.future = [];
    getRenderApp()();
  }, UNNAMED_CANVAS_SOURCE);

  // DRAW: one horizontal stroke through the vertical middle.
  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Brush', exact: true }).click();
  const surface = page.locator('.hvy-canvas-surface');
  await surface.scrollIntoViewIfNeeded();
  const bounds = (await surface.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + bounds.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.3, { steps: 5 });
  await page.mouse.up();

  const readCanvas = () => page.evaluate(async () => {
    const [{ state }, { getAttachment }, { preparePdfExport }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/attachments.ts'),
      import('/src/pdf-export/export.ts'),
    ]);
    const drawingName = state.document.sections[0]!.blocks[0]!.schema.pluginConfig.drawing as string | undefined;
    const stored = drawingName ? getAttachment(state.document, `canvas:${drawingName}`) : null;
    const { exportDocument } = await preparePdfExport(state.document, { runPrepScript: false });
    const image = getAttachment(exportDocument, `image:${exportDocument.sections[0]!.blocks[0]!.schema.imageFile}`)!;
    const bitmap = await createImageBitmap(new Blob([image.bytes], { type: 'image/png' }));
    const probe = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    probe.drawImage(bitmap, 0, 0);
    return {
      named: typeof drawingName === 'string' && drawingName.startsWith('canvas-'),
      storedItems: stored ? JSON.parse(new TextDecoder().decode(stored.bytes)).layers[0].items.length : 0,
      exportedPixel: [...probe.getImageData(Math.round(bitmap.width / 2), Math.round(bitmap.height * 0.3), 1, 1).data],
    };
  });

  // AFTER DRAW: the canvas named its drawing, and the PDF export shows the stroke.
  expect(await readCanvas()).toEqual({ named: true, storedItems: 1, exportedPixel: [255, 0, 0, 255] });

  // RELOAD: save and reopen the document bytes.
  await page.evaluate(async () => {
    const [{ state, getRenderApp }, { serializeDocumentBytes, deserializeDocumentBytes }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/serialization.ts'),
    ]);
    state.document = deserializeDocumentBytes(serializeDocumentBytes(state.document), '.phvy');
    getRenderApp()();
  });
  await expect.poll(() => page.evaluate(() => (
    document.querySelector<HTMLElement>('[data-hvy-canvas-id]')?.hvyCanvas?.getDrawing().layers[0]!.items.length ?? null
  )), { timeout: 1_000 }).toBe(1);
  expect(await readCanvas()).toEqual({ named: true, storedItems: 1, exportedPixel: [255, 0, 0, 255] });
});

test('before, first stroke on an unnamed canvas, undo/redo: the stroke and the drawing name come and go together', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async (source) => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    state.document = deserializeDocument(source, '.phvy');
    state.filename = 'unnamed-canvas.phvy';
    state.history = [];
    state.future = [];
    getRenderApp()();
  }, UNNAMED_CANVAS_SOURCE);
  await page.locator('.hvy-canvas-toolbar').getByRole('button', { name: 'Brush', exact: true }).click();
  const surface = page.locator('.hvy-canvas-surface');
  await surface.scrollIntoViewIfNeeded();
  const bounds = (await surface.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + bounds.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.3, { steps: 5 });
  await page.mouse.up();

  const readState = () => page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-hvy-canvas-id]')!;
    return import('/src/state.ts').then(({ state }) => ({
      named: Boolean(state.document.sections[0]!.blocks[0]!.schema.pluginConfig.drawing),
      shownItems: root.hvyCanvas!.getDrawing().layers[0]!.items.length,
    }));
  });
  expect(await readState()).toEqual({ named: true, shownItems: 1 });

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(readState, { timeout: 1_000 }).toEqual({ named: false, shownItems: 0 });

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(readState, { timeout: 1_000 }).toEqual({ named: true, shownItems: 1 });
});
