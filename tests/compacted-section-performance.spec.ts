import { expect, test, type Page } from '@playwright/test';

type PerfEvent = {
  event?: string;
  elapsedMs?: number;
  readerRenderMs?: number;
  readerDomMs?: number;
  [key: string]: unknown;
};

type RenderMeasurement = {
  label: string;
  sectionId: string;
  iterations: number;
  perRenderMs: number;
  totalMs: number;
  htmlLength: number;
};

type ClickMeasurement = {
  label: string;
  sectionId: string;
  latencyMs: number;
  expanded: boolean;
  refreshEvents: number;
  refreshElapsedMs: number | null;
  readerRenderMs: number | null;
  readerDomMs: number | null;
  sectionRefreshEvents: number;
  sectionRefreshElapsedMs: number | null;
};

test('compacted section direct render cost compares small, large, and nearly empty files', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');

  await loadRawDocument(page, createMixedSectionDocument());
  const sameFileSmall = await measureSectionRender(page, 'same-file small direct render', 'small-section', 500);
  const sameFileLarge = await measureSectionRender(page, 'same-file large direct render', 'large-section', 20);

  await loadRawDocument(page, createNearlyEmptySectionDocument());
  const nearlyEmptySmall = await measureSectionRender(page, 'nearly-empty small direct render', 'small-section', 500);

  const smallConsistencyRatio = ratio(sameFileSmall.perRenderMs, nearlyEmptySmall.perRenderMs);
  const measurements = {
    sameFileSmall,
    sameFileLarge,
    nearlyEmptySmall,
    largeVsSmallRatio: ratio(sameFileLarge.perRenderMs, sameFileSmall.perRenderMs),
    smallConsistencyRatio,
  };
  console.info('compacted-section-render-measurements', JSON.stringify(measurements));

  expect(sameFileSmall.htmlLength).toBeGreaterThan(0);
  expect(sameFileLarge.htmlLength).toBeGreaterThan(sameFileSmall.htmlLength);
  expect(nearlyEmptySmall.htmlLength).toBe(sameFileSmall.htmlLength);
  expect(sameFileLarge.perRenderMs).toBeGreaterThan(sameFileSmall.perRenderMs);
  expect(smallConsistencyRatio).toBeLessThanOrEqual(3);
});

test('compacted section click refresh cost compares small, large, and nearly empty files', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await installPerfCapture(page);

  await loadRawDocument(page, createMixedSectionDocument());
  const sameFileSmall = await measureCompactedSectionClick(page, 'same-file small click refresh', 'small-section');

  await loadRawDocument(page, createMixedSectionDocument());
  const sameFileLarge = await measureCompactedSectionClick(page, 'same-file large click refresh', 'large-section');
  await expect(page.locator('#large-section [data-component-id="large-text-140"]')).toBeVisible();

  await loadRawDocument(page, createNearlyEmptySectionDocument());
  const nearlyEmptySmall = await measureCompactedSectionClick(page, 'nearly-empty small click refresh', 'small-section');

  const measurements = {
    sameFileSmall,
    sameFileLarge,
    nearlyEmptySmall,
    largeVsSmallSectionRefreshRatio: ratio(sameFileLarge.sectionRefreshElapsedMs ?? 0, sameFileSmall.sectionRefreshElapsedMs ?? 0),
    smallFileSectionRefreshRatio: ratio(sameFileSmall.sectionRefreshElapsedMs ?? 0, nearlyEmptySmall.sectionRefreshElapsedMs ?? 0),
  };
  console.info('compacted-section-click-measurements', JSON.stringify(measurements));

  expect(sameFileSmall.expanded).toBe(true);
  expect(sameFileLarge.expanded).toBe(true);
  expect(nearlyEmptySmall.expanded).toBe(true);
  expect(sameFileSmall.refreshEvents).toBe(0);
  expect(sameFileLarge.refreshEvents).toBe(0);
  expect(nearlyEmptySmall.refreshEvents).toBe(0);
  expect(sameFileSmall.sectionRefreshEvents).toBeGreaterThan(0);
  expect(sameFileLarge.sectionRefreshEvents).toBeGreaterThan(0);
  expect(nearlyEmptySmall.sectionRefreshEvents).toBeGreaterThan(0);
  expect(sameFileLarge.sectionRefreshElapsedMs ?? 0).toBeGreaterThan(sameFileSmall.sectionRefreshElapsedMs ?? 0);
});

async function loadRawDocument(page: Page, source: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'Editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toBeVisible();
  await page.locator('#rawEditor').evaluate((textarea, value) => {
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Raw editor textarea missing.');
    }
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }, source);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('#readerDocument .reader-section.is-collapsed-preview')).toHaveCount(
    source.includes('large-section') ? 2 : 1
  );
}

async function installPerfCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as Window & {
      __hvyPerfEvents?: PerfEvent[];
      __hvyPerfCaptureInstalled?: boolean;
    };
    win.__hvyPerfEvents = [];
    if (win.__hvyPerfCaptureInstalled) {
      return;
    }
    win.__hvyPerfCaptureInstalled = true;
    const originalDebug = console.debug.bind(console);
    console.debug = (...args: unknown[]) => {
      if (args[0] === '[hvy:perf]') {
        win.__hvyPerfEvents?.push((args[1] ?? {}) as PerfEvent);
      }
      originalDebug(...args);
    };
  });
}

async function measureSectionRender(
  page: Page,
  label: string,
  sectionId: string,
  iterations: number
): Promise<RenderMeasurement> {
  return page.evaluate(
    async ({ label, sectionId, iterations }) => {
      const [{ state }, { getReaderRenderer }] = await Promise.all([
        import(/* @vite-ignore */ '/src/state.ts'),
        import(/* @vite-ignore */ '/src/state.ts'),
      ]);
      const section = state.document.sections.find((candidate) => candidate.customId === sectionId);
      if (!section) {
        throw new Error(`Missing section ${sectionId}`);
      }
      const renderer = getReaderRenderer();
      renderer.renderReaderSection(section);
      const startedAt = performance.now();
      let html = '';
      for (let index = 0; index < iterations; index += 1) {
        html = renderer.renderReaderSection(section);
      }
      const totalMs = Number((performance.now() - startedAt).toFixed(3));
      return {
        label,
        sectionId,
        iterations,
        perRenderMs: Number((totalMs / iterations).toFixed(5)),
        totalMs,
        htmlLength: html.length,
      };
    },
    { label, sectionId, iterations }
  );
}

async function measureCompactedSectionClick(
  page: Page,
  label: string,
  sectionId: string
): Promise<ClickMeasurement> {
  return page.evaluate(
    ({ label, sectionId }) => {
      const win = window as Window & { __hvyPerfEvents?: PerfEvent[] };
      win.__hvyPerfEvents = [];
      const sectionSelector = `#readerDocument #${CSS.escape(sectionId)}`;
      const sectionBefore = document.querySelector<HTMLElement>(sectionSelector);
      const toggle = sectionBefore?.querySelector<HTMLElement>('[data-reader-action="toggle-expand"]');
      if (!sectionBefore || !toggle) {
        throw new Error(`Missing compacted section toggle for ${sectionId}`);
      }
      if (!sectionBefore.classList.contains('is-collapsed-preview')) {
        throw new Error(`Section ${sectionId} was not compacted before click`);
      }
      const startedAt = performance.now();
      toggle.click();
      const latencyMs = Number((performance.now() - startedAt).toFixed(3));
      const sectionAfter = document.querySelector<HTMLElement>(sectionSelector);
      const refreshEvents = (win.__hvyPerfEvents ?? []).filter((event) => event.event === 'refreshReaderPanels');
      const sectionRefreshEvents = (win.__hvyPerfEvents ?? []).filter((event) => event.event === 'refreshReaderSection');
      const refreshEvent = refreshEvents.at(-1);
      const sectionRefreshEvent = sectionRefreshEvents.at(-1);
      return {
        label,
        sectionId,
        latencyMs,
        expanded: Boolean(sectionAfter && !sectionAfter.classList.contains('is-collapsed-preview')),
        refreshEvents: refreshEvents.length,
        refreshElapsedMs: typeof refreshEvent?.elapsedMs === 'number' ? refreshEvent.elapsedMs : null,
        readerRenderMs: typeof refreshEvent?.readerRenderMs === 'number' ? refreshEvent.readerRenderMs : null,
        readerDomMs: typeof refreshEvent?.readerDomMs === 'number' ? refreshEvent.readerDomMs : null,
        sectionRefreshEvents: sectionRefreshEvents.length,
        sectionRefreshElapsedMs: typeof sectionRefreshEvent?.elapsedMs === 'number' ? sectionRefreshEvent.elapsedMs : null,
      };
    },
    { label, sectionId }
  );
}

function createMixedSectionDocument(): string {
  return createDocument([
    createSection('small-section', 'Small Section', [createTextBlock('small-text', 'Small section body.')]),
    createSection('large-section', 'Large Section', createLargeSectionBlocks()),
  ]);
}

function createNearlyEmptySectionDocument(): string {
  return createDocument([
    createSection('small-section', 'Small Section', [createTextBlock('small-text', 'Small section body.')]),
  ]);
}

function createDocument(sections: string[]): string {
  return `---
hvy_version: 0.1
---

${sections.join('\n')}`;
}

function createSection(id: string, title: string, blocks: string[]): string {
  return `<!--hvy: {"id":"${id}","contained":true,"expanded":false}-->
#! ${title}

${blocks.join('\n')}`;
}

function createLargeSectionBlocks(): string[] {
  const blocks: string[] = [];
  for (let index = 1; index <= 140; index += 1) {
    blocks.push(createTextBlock(
      `large-text-${index}`,
      `### Large row ${index}\nThis fake measurement row has enough text to produce real reader work while staying deterministic.`
    ));
  }
  return blocks;
}

function createTextBlock(id: string, text: string): string {
  return ` <!--hvy:text {"id":"${id}"}-->
  ${text.replace(/\n/g, '\n  ')}
`;
}

function ratio(a: number, b: number): number {
  const left = Math.max(Math.abs(a), 0.00001);
  const right = Math.max(Math.abs(b), 0.00001);
  return Number((Math.max(left, right) / Math.min(left, right)).toFixed(3));
}
