// Measures undo history cost for script-driven database edits in viewer mode. It loads
// the document from history-performance-document.mjs, submits every item's form (each
// runs its own script that writes the attached database), undoes every submit, then
// redoes them. Each step is timed until the database table shows the expected total, and
// the JS heap is measured after a forced GC between phases.
//
// Every submit must be exactly one undo step: each undo or redo press must move the total
// by one. A press that does not is a failure. The phase records it and ends, the run
// still writes its measurements, and the process exits 1.
//
// Run with: npm run browser:start && npm run browser:history-perf
// Results are printed and written to scratch/history-performance-results.json.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHistoryPerformanceDocument,
  getFakeItemSubmitLabel,
  getHistoryPerformanceOptions,
  TOTAL_CLICKS_LABEL,
} from './history-performance-document.mjs';

const RESULTS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../scratch/history-performance-results.json');
const STEP_TIMEOUT_MS = 10_000;

export default async function historyPerformanceHarness({ chromium, baseUrl }) {
  const options = getHistoryPerformanceOptions();
  const document = await buildHistoryPerformanceDocument(options);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  const cdp = await page.context().newCDPSession(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.sessionStorage.clear();
    window.__hvyHistoryPerf = { longTasks: [] };
    if ('PerformanceObserver' in window) {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__hvyHistoryPerf.longTasks.push(entry.duration);
        }).observe({ type: 'longtask', buffered: true });
      } catch {
        // Long task observation is best-effort in the browser harness.
      }
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('#fileInput').setInputFiles({
      name: 'history-performance.hvy',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(document.bytes),
    });
    await page.waitForFunction(() => document.querySelector('#downloadName')?.value === 'history-performance.hvy');
    await page.locator('[data-action="switch-view"][data-view="viewer"]').first().click();
    await waitForTotalClicks(page, 0, STEP_TIMEOUT_MS);

    const phases = [await measurePhase(page, cdp, 'loaded-in-viewer', [])];

    const submitSteps = [];
    for (let index = 0; index < options.itemCount; index += 1) {
      const startedAt = performance.now();
      await page.getByRole('button', { name: getFakeItemSubmitLabel(index), exact: true }).click();
      await waitForTotalClicksOrExplain(page, index + 1, `submit ${index + 1}`);
      submitSteps.push(logStep(`submit ${index + 1}`, { ms: elapsedSince(startedAt) }));
    }
    phases.push(await measurePhase(page, cdp, 'after-submits', submitSteps));

    phases.push(await measurePhase(page, cdp, 'after-undos', await runHistoryPhase(page, 'undo', 0)));
    phases.push(await measurePhase(page, cdp, 'after-redos', await runHistoryPhase(page, 'redo', options.itemCount)));

    const results = {
      document: {
        items: options.itemCount,
        seedRows: options.seedRows,
        textChars: document.textChars,
        gzippedDatabaseBytes: document.databaseBytes,
      },
      phases,
      pageErrors,
    };
    writeFileSync(RESULTS_FILE, `${JSON.stringify(results, null, 2)}\n`);
    console.log(JSON.stringify(results, null, 2));
    console.log(`Results written to ${RESULTS_FILE}`);
    if (pageErrors.length > 0 || phases.some((phase) => phase.steps?.failure)) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

// Steps the total one at a time from wherever the reader is toward the target total.
async function runHistoryPhase(page, direction, targetTotalClicks) {
  const steps = [];
  const stepDelta = direction === 'undo' ? -1 : 1;
  let current = Number(await page.evaluate(readRenderedTotalClicks, TOTAL_CLICKS_LABEL));
  while (current !== targetTotalClicks) {
    const expected = current + stepDelta;
    const step = logStep(`${direction} to total ${expected}`, await runHistoryStep(page, direction, expected));
    steps.push(step);
    if (step.failure) break;
    current = expected;
  }
  return steps;
}

async function runHistoryStep(page, direction, expectedTotalClicks) {
  const startedAt = performance.now();
  // The shortcut is ignored while a native input or button owns undo.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press(direction === 'undo' ? 'ControlOrMeta+z' : 'ControlOrMeta+Shift+z');
  try {
    await waitForTotalClicks(page, expectedTotalClicks, STEP_TIMEOUT_MS);
    return { ms: elapsedSince(startedAt) };
  } catch {
    return {
      ms: elapsedSince(startedAt),
      failure: {
        expectedTotalClicks,
        renderedTotalClicks: await page.evaluate(readRenderedTotalClicks, TOTAL_CLICKS_LABEL),
        ...await readHistoryCounts(page),
      },
    };
  }
}

async function waitForTotalClicksOrExplain(page, expectedTotalClicks, stepName, timeout = STEP_TIMEOUT_MS) {
  try {
    await waitForTotalClicks(page, expectedTotalClicks, timeout);
  } catch (error) {
    const rendered = await page.evaluate(readRenderedTotalClicks, TOTAL_CLICKS_LABEL);
    const counts = await readHistoryCounts(page);
    throw new Error(`${stepName}: expected total clicks ${expectedTotalClicks}, reader shows ${rendered} (${JSON.stringify(counts)})`, { cause: error });
  }
}

// Reads the rendered totals table, so a step is only done once the reader shows it.
async function waitForTotalClicks(page, expectedTotalClicks, timeout) {
  await page.waitForFunction(
    `(${readRenderedTotalClicks})(${JSON.stringify(TOTAL_CLICKS_LABEL)}) === ${JSON.stringify(String(expectedTotalClicks))}`,
    undefined,
    { polling: 'raf', timeout },
  );
}

function readRenderedTotalClicks(label) {
  const table = [...document.querySelectorAll('#readerDocument table')]
    .find((candidate) => candidate.querySelector('thead')?.textContent?.includes(label));
  return table?.querySelector('tbody tr td')?.textContent?.trim() ?? null;
}

async function readHistoryCounts(page) {
  return page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return { historyEntries: state.history.length, futureEntries: state.future.length };
  });
}

async function measurePhase(page, cdp, name, steps) {
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const app = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const longTasks = window.__hvyHistoryPerf.longTasks.splice(0);
    return {
      historyEntries: state.history.length,
      historyChars: state.history.reduce((sum, entry) => sum + entry.length, 0),
      futureEntries: state.future.length,
      futureChars: state.future.reduce((sum, entry) => sum + entry.length, 0),
      longTaskCount: longTasks.length,
      longTaskMs: Number(longTasks.reduce((sum, duration) => sum + duration, 0).toFixed(1)),
    };
  });
  return {
    name,
    heapUsedMB: toMegabytes(heap.usedSize),
    heapTotalMB: toMegabytes(heap.totalSize),
    ...app,
    ...(steps.length > 0 ? { steps: summarizeSteps(steps) } : {}),
  };
}

function summarizeSteps(steps) {
  const passedMs = steps.filter((step) => !step.failure).map((step) => step.ms);
  const sorted = [...passedMs].sort((left, right) => left - right);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? null;
  return {
    count: steps.length,
    failure: steps.find((step) => step.failure)?.failure ?? null,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1] ?? null,
    // First and last steps show whether cost grows as the history does.
    first5Ms: steps.slice(0, 5).map((step) => step.ms),
    last5Ms: steps.slice(-5).map((step) => step.ms),
  };
}

// Progress goes to stderr so a slow run shows where it is without mixing into the results.
function logStep(name, step) {
  console.error(`${name}: ${step.failure ? `FAILED ${JSON.stringify(step.failure)}` : `${step.ms} ms`}`);
  return step;
}

function elapsedSince(startedAt) {
  return Number((performance.now() - startedAt).toFixed(1));
}

function toMegabytes(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(1));
}
