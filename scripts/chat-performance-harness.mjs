const DEFAULT_SECTION_COUNT = 32;

export default async function chatPerformanceHarness({ chromium, baseUrl }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);

  const sectionCount = getSectionCount();
  const source = buildLargePerfDocument({ sections: sectionCount });
  const consoleMessages = [];
  page.on('console', (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    consoleMessages.push(`pageerror: ${error.message}`);
  });

  let qaCalls = 0;
  let editCalls = 0;
  await page.route('**/api/chat', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}');
    if (!Array.isArray(payload.tools)) {
      qaCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          output: 'Mock QA answer for performance measurement.',
          usage: { inputTokens: 2400, outputTokens: 32, totalTokens: 2432 },
        }),
      });
      return;
    }

    editCalls += 1;
    if (editCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          output: '',
          reasoningSummary: 'Mock reasoning: target the first section and add a note.',
          usage: { inputTokens: 6200, outputTokens: 128, totalTokens: 6328 },
          toolCalls: [
            {
              id: 'perf_call_insert',
              name: 'run_hvy_cli',
              arguments: { command: 'hvy insert -1 text /body/perf-section-001 perf-added-note' },
            },
            {
              id: 'perf_call_write',
              name: 'run_hvy_cli',
              arguments: { command: 'echo "Measured edit result from mocked tool call." > /body/perf-section-001/perf-added-note/text.txt' },
            },
          ],
          nativeMessages: [
            { type: 'function_call', call_id: 'perf_call_insert', name: 'run_hvy_cli', arguments: '{"command":"hvy insert -1 text /body/perf-section-001 perf-added-note"}' },
            { type: 'function_call', call_id: 'perf_call_write', name: 'run_hvy_cli', arguments: '{"command":"echo \\"Measured edit result from mocked tool call.\\" > /body/perf-section-001/perf-added-note/text.txt"}' },
          ],
          toolState: { provider: 'openai', input: [] },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: '',
        reasoningSummary: '',
        usage: { inputTokens: 5600, outputTokens: 48, totalTokens: 5648 },
        toolCalls: [
          {
            id: 'perf_call_finish',
            name: 'finish_task',
            arguments: { summary: 'Mock document edit completed.' },
          },
        ],
        nativeMessages: [
          { type: 'function_call', call_id: 'perf_call_finish', name: 'finish_task', arguments: '{"summary":"Mock document edit completed."}' },
        ],
        toolState: { provider: 'openai', input: [] },
      }),
    });
  });

  await page.addInitScript(() => {
    window.sessionStorage.clear();
    window.localStorage.removeItem('hvy-palette-override-v1');
    window.__hvyChatPerf = {
      renderAppCount: 0,
      chatRenderCount: 0,
      storageWrites: [],
      longTasks: [],
    };

    const originalDebug = console.debug.bind(console);
    console.debug = (...args) => {
      if (args[0] === '[hvy:perf]' && args[1]?.event === 'renderApp') {
        window.__hvyChatPerf.renderAppCount += 1;
      }
      if (args[0] === '[hvy:chat-render] composer state') {
        window.__hvyChatPerf.chatRenderCount += 1;
      }
      originalDebug(...args);
    };

    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function measuredSetItem(key, value) {
      const startedAt = performance.now();
      try {
        return originalSetItem.call(this, key, value);
      } finally {
        window.__hvyChatPerf.storageWrites.push({
          key,
          chars: typeof value === 'string' ? value.length : 0,
          elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
        });
      }
    };

    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__hvyChatPerf.longTasks.push({
              duration: Number(entry.duration.toFixed(2)),
              startTime: Number(entry.startTime.toFixed(2)),
            });
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        // Long task observation is best-effort in the browser harness.
      }
    }
  });

  try {
    const metrics = [];
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    const loadStarted = await snapshotPerf(page);
    await page.locator('#fileInput').setInputFiles({
      name: 'perf-large.hvy',
      mimeType: 'text/plain',
      buffer: Buffer.from(source),
    });
    await page.waitForFunction(() => {
      const filename = document.querySelector('#downloadName');
      const editor = document.querySelector('#editorTree');
      return filename instanceof HTMLInputElement
        && filename.value === 'perf-large.hvy'
        && editor instanceof HTMLElement
        && editor.textContent?.includes('Performance Section');
    });
    metrics.push(await measureSince(page, 'load-large-document', loadStarted));

    const switchViewerStarted = await snapshotPerf(page);
    await clickInPage(page, '[data-action="switch-view"][data-view="viewer"]');
    await page.waitForSelector('#readerDocument');
    metrics.push(await measureSince(page, 'switch-to-viewer', switchViewerStarted));

    metrics.push(await measureStep(page, 'viewer-open-chat', async () => {
      await clickInPage(page, '[data-action="toggle-chat-panel"]');
      await page.getByRole('heading', { name: 'Ask This Document' }).waitFor();
    }));

    metrics.push(await measureStep(page, 'viewer-ask-question', async () => {
      await page.locator('[data-field="chat-input"]').fill('What themes does this performance document cover?');
      await submitChatComposer(page);
      await page.locator('.chat-bubble', { hasText: 'Mock QA answer for performance measurement.' }).waitFor();
    }));

    metrics.push(await measureStep(page, 'switch-to-ai-edit-chat', async () => {
      await clickInPage(page, '[data-action="switch-view"][data-view="ai"]');
      await page.getByRole('heading', { name: 'Edit This Document' }).waitFor();
    }));

    metrics.push(await measureStep(page, 'ai-document-edit-chat', async () => {
      await page.locator('[data-field="chat-input"]').fill('Add a measured note to the first section.');
      await submitChatComposer(page);
      await page.locator('.chat-bubble', { hasText: 'Mock document edit completed.' }).waitFor();
      await page.locator('#aiReaderDocument', { hasText: 'Measured edit result from mocked tool call.' }).waitFor();
    }));

    const summary = {
      document: {
        sections: sectionCount,
        sourceChars: source.length,
      },
      apiCalls: {
        qa: qaCalls,
        documentEdit: editCalls,
      },
      metrics,
    };
    console.log(`chat-performance ${JSON.stringify(summary)}`);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}\nMessages:\n${consoleMessages.join('\n')}`);
  } finally {
    await browser.close();
  }
}

function getSectionCount() {
  const raw = process.env.HVY_CHAT_PERF_SECTIONS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_SECTION_COUNT;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SECTION_COUNT;
}

async function clickInPage(page, selector) {
  await page.locator(selector).first().evaluate((element) => {
    element.click();
  });
}

async function submitChatComposer(page) {
  await page.locator('#chatComposer').evaluate((form) => {
    form.requestSubmit();
  });
}

async function measureStep(page, name, action) {
  const before = await snapshotPerf(page);
  await action();
  return measureSince(page, name, before);
}

async function snapshotPerf(page) {
  return page.evaluate(() => {
    const perf = window.__hvyChatPerf;
    return {
      timeMs: performance.now(),
      renderAppCount: perf.renderAppCount,
      chatRenderCount: perf.chatRenderCount,
      storageWriteCount: perf.storageWrites.length,
      storageWriteMs: Number(perf.storageWrites.reduce((sum, write) => sum + write.elapsedMs, 0).toFixed(2)),
      storageWriteChars: perf.storageWrites.reduce((sum, write) => sum + write.chars, 0),
      longTaskCount: perf.longTasks.length,
      longTaskMs: Number(perf.longTasks.reduce((sum, task) => sum + task.duration, 0).toFixed(2)),
    };
  });
}

async function measureSince(page, name, before) {
  const after = await snapshotPerf(page);
  return {
    name,
    elapsedMs: Number((after.timeMs - before.timeMs).toFixed(2)),
    renderAppCount: after.renderAppCount - before.renderAppCount,
    chatRenderCount: after.chatRenderCount - before.chatRenderCount,
    storageWriteCount: after.storageWriteCount - before.storageWriteCount,
    storageWriteMs: Number((after.storageWriteMs - before.storageWriteMs).toFixed(2)),
    storageWriteChars: after.storageWriteChars - before.storageWriteChars,
    longTaskCount: after.longTaskCount - before.longTaskCount,
    longTaskMs: Number((after.longTaskMs - before.longTaskMs).toFixed(2)),
  };
}

function buildLargePerfDocument(options) {
  const sections = Array.from({ length: options.sections }, (_value, index) => buildPerfSection(index + 1));
  return `---
hvy_version: 0.1
title: Chat Performance Fixture
reader_max_width: 64rem
section_defaults:
  css: "margin: 0.5rem 0;"
---

${sections.join('\n')}`;
}

function buildPerfSection(sectionNumber) {
  const id = `perf-section-${String(sectionNumber).padStart(3, '0')}`;
  const title = `Performance Section ${sectionNumber}`;
  return `<!--hvy: {"id":"${id}","expanded":true,"highlight":${sectionNumber % 7 === 0 ? 'true' : 'false'},"tags":"perf-fixture"}-->
#! ${title}

 <!--hvy:text {"id":"${id}-overview","css":"margin: 0.5rem 0;"}-->
  ## ${title}

  This section repeats realistic prose so chat context building, reader rendering, and session persistence have enough material to measure. It covers workflows, ownership, review status, and follow-up notes for component group ${sectionNumber}.

 <!--hvy:table {"id":"${id}-table","css":"margin: 0.5rem 0;","tableColumns":["ITEM","OWNER","STATUS"],"tableShowHeader":true,"tableRows":[{"cells":["Discovery ${sectionNumber}","Team Alpha","Ready"]},{"cells":["Implementation ${sectionNumber}","Team Beta","In review"]},{"cells":["Validation ${sectionNumber}","Team Gamma","Queued"]}]}-->

 <!--hvy:grid {"id":"${id}-grid","css":"margin: 0.5rem 0; gap: 0.75rem;","gridColumns":2}-->

  <!--hvy:grid:0 {"id":"${id}-grid-left"}-->

   <!--hvy:container {"id":"${id}-left-container","css":"margin: 0;"}-->

    <!--hvy:text {"id":"${id}-left-note"}-->
     Left column note for ${title}. It contains enough text to exercise nested component rendering and virtual document paths.

  <!--hvy:grid:1 {"id":"${id}-grid-right"}-->

   <!--hvy:container {"id":"${id}-right-container","css":"margin: 0;"}-->

    <!--hvy:text {"id":"${id}-right-note"}-->
     Right column note for ${title}. This mirrors a dashboard-like document with repeated nested components.

 <!--hvy:expandable {"id":"${id}-expandable","css":"margin: 0.5rem 0;","expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {"id":"${id}-summary"}-->
    Summary row ${sectionNumber}

  <!--hvy:expandable:content {}-->

   <!--hvy:text {"id":"${id}-details"}-->
    Detailed notes for ${title}. The hidden content creates work for editor, viewer, and AI mode surfaces without relying on any remote API.

 <!--hvy:component-list {"id":"${id}-refs","componentListComponent":"xref-card","componentListItemLabel":"reference","css":"margin: 0.5rem 0;"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:xref-card {"id":"${id}-xref-a","xrefTitle":"Reference ${sectionNumber}A","xrefDetail":"Links back to this section","xrefTarget":"${id}"}-->

  <!--hvy:component-list:1 {}-->

   <!--hvy:xref-card {"id":"${id}-xref-b","xrefTitle":"Reference ${sectionNumber}B","xrefDetail":"Secondary reference","xrefTarget":"${id}"}-->
`;
}
