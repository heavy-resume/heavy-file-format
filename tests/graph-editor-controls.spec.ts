import { expect, test, type Page } from '@playwright/test';

const FAKE_GRAPH_DOCUMENT = `---
hvy_version: 0.1
plugins:
  - id: hvy.graph
---

<!--hvy: {"id":"fake-graph-section","contained":false}-->
#! Fake graph section

<!--hvy:plugin {"id":"fake-graph","plugin":"hvy.graph","pluginConfig":{"type":"bar","title":"Fake graph"}}-->
Label,Fake A,Fake B
Fake one,10,20
Fake two,30,15
`;

async function mountFakeGraph(page: Page, mode: 'editor' | 'viewer'): Promise<void> {
  await page.goto('/');
  await page.evaluate(async ({ source, mode }) => {
    const [{ deserializeDocument }, { mountHvy }, { graphPlugin }] = await Promise.all([
      import('/src/serialization.ts'), import('/src/embed-full.ts'), import('/src/plugins/graph.ts'),
    ]);
    document.body.innerHTML = '<div id="fakeHost" style="height: 900px"></div>';
    (window as unknown as { fakeMount: unknown }).fakeMount = mountHvy({
      root: document.querySelector<HTMLElement>('#fakeHost')!,
      document: deserializeDocument(source, '.hvy'),
      mode,
      plugins: [graphPlugin],
    });
  }, { source: FAKE_GRAPH_DOCUMENT, mode });
}

async function readSerializedGraphConfig(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const mount = (window as unknown as { fakeMount: { serializeDocumentBytes(): Uint8Array } }).fakeMount;
    const line = new TextDecoder().decode(mount.serializeDocumentBytes()).split('\n').find((text) => text.includes('"fake-graph"')) ?? '';
    return JSON.parse(line.trim().replace(/^<!--hvy:plugin /, '').replace(/-->$/, '')).pluginConfig;
  });
}

test('a full rerender redraws an already shown graph at rest instead of replaying its animation', async ({ page }) => {
  test.setTimeout(5000);
  await mountFakeGraph(page, 'viewer');
  const canvas = page.locator('.hvy-graph-reader canvas');
  await canvas.waitFor({ timeout: 1000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => (window as unknown as { fakeMount: { setThemeOverrides(value: object): void } }).fakeMount.setThemeOverrides({}));
  await page.waitForTimeout(40);
  const rightAfterRerender = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.waitForTimeout(500);
  const expectedSettledResult = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());

  expect(rightAfterRerender).toBe(expectedSettledResult);
});

test('series, axis, and bar controls follow the graph type and layout', async ({ page }) => {
  test.setTimeout(5000);
  await mountFakeGraph(page, 'editor');
  await page.locator('.hvy-graph canvas').click();
  const typeSelect = page.getByRole('combobox', { name: 'Type' });
  const xAxisInput = page.getByRole('textbox', { name: 'X axis' });
  const yAxisInput = page.getByRole('textbox', { name: 'Y axis' });
  const seriesSelect = page.getByRole('combobox', { name: 'Series' });
  const barWidth = page.getByRole('slider', { name: 'Bar width' });
  const barGap = page.getByRole('slider', { name: 'Bar gap' });

  await expect(typeSelect.locator('option[value="polarArea"]')).toHaveText('Polar area');
  await expect(xAxisInput).toBeVisible();
  await expect(yAxisInput).toBeVisible();
  await expect(seriesSelect).toBeVisible();
  await expect(barWidth).toBeVisible();
  await expect(barGap).toBeVisible();
  await expect(page.locator('[data-graph-range-slot="barWidth"] output')).toHaveText('80%');
  await expect(page.locator('[data-graph-range-slot="barGap"] output')).toHaveText('10%');

  await seriesSelect.selectOption('stacked');

  await expect(barGap).toBeHidden();
  await expect.poll(() => readSerializedGraphConfig(page)).toMatchObject({ seriesLayout: 'stacked' });

  await typeSelect.selectOption('line');

  await expect(xAxisInput).toBeVisible();
  await expect(seriesSelect).toBeVisible();
  await expect(seriesSelect.locator('option')).toHaveText(['Separate', 'Stacked']);
  await expect(barWidth).toBeHidden();

  await typeSelect.selectOption('pie');

  await expect(xAxisInput).toBeHidden();
  await expect(yAxisInput).toBeHidden();
  await expect(seriesSelect).toBeHidden();
});

test('dragging the bar width slider updates the config without remounting the slider', async ({ page }) => {
  test.setTimeout(5000);
  await mountFakeGraph(page, 'editor');
  await page.locator('.hvy-graph canvas').click();
  const barWidth = page.getByRole('slider', { name: 'Bar width' });
  await barWidth.evaluate((input: HTMLInputElement) => { input.dataset.fakeOriginalNode = 'true'; });
  const box = (await barWidth.boundingBox())!;

  await page.mouse.move(box.x + box.width * 0.77, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();

  await expect(barWidth).toHaveAttribute('data-fake-original-node', 'true');
  const expectedBarWidth = Number(await barWidth.inputValue()) / 100;
  expect(expectedBarWidth).toBeLessThan(0.5);
  await expect.poll(() => readSerializedGraphConfig(page)).toMatchObject({ barWidth: expectedBarWidth });
});

test('long graph column headers wrap without clipping the remove column button', async ({ page }) => {
  test.setTimeout(5000);
  await page.setViewportSize({ width: 920, height: 900 });
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ deserializeDocument }, { mountHvy }, { graphPlugin }] = await Promise.all([
      import('/src/serialization.ts'), import('/src/embed-full.ts'), import('/src/plugins/graph.ts'),
    ]);
    document.body.innerHTML = '<div id="fakeHost" style="height: 900px"></div>';
    const source = `---
hvy_version: 0.1
plugins:
  - id: hvy.graph
---

<!--hvy: {"id":"fake-graph-section","contained":false}-->
#! Fake graph section

<!--hvy:plugin {"id":"fake-graph","plugin":"hvy.graph","pluginConfig":{"type":"bar","title":"Fake graph"}}-->
Fake date,Fake score,Fake short ratio,Fake short-exempt ratio
Fake 1,0,0,0
`;
    (window as unknown as { fakeMount: unknown }).fakeMount = mountHvy({
      root: document.querySelector<HTMLElement>('#fakeHost')!,
      document: deserializeDocument(source, '.hvy'),
      mode: 'editor',
      plugins: [graphPlugin],
    });
  });

  await page.locator('.hvy-graph canvas').click();
  await page.locator('.hvy-graph-data-panel table').waitFor({ timeout: 1000 });

  const overflows = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.hvy-graph-data-panel thead th[data-graph-column-drop]')).map((th) => {
      const thRect = th.getBoundingClientRect();
      const buttonRect = th.querySelector('button.remove-x')!.getBoundingClientRect();
      return buttonRect.right - thRect.right;
    });
  });

  expect(overflows.length).toBe(4);
  for (const overflow of overflows) {
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
