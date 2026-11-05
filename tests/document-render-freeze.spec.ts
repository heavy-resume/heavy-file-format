import { expect, test, type Page } from '@playwright/test';

type FreezeTestWindow = Window & {
  fakePanelCtx?: { requestRerender(): void };
  releaseFakeHook?: () => void;
  fakeHookHeld?: boolean;
};

// A document with a fake panel plugin whose documentChange hook rewrites the card
// and can be held open, so a test can look at the page while hooks are running.
async function openFakePanelDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { state, getRenderApp } = await import('/src/state.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    const { runPluginDocumentHooks } = await import('/src/plugins/hooks.ts');
    const registry = await import('/src/plugins/registry.ts');
    const fakeWindow = window as FreezeTestWindow;
    let hold: Promise<void> | null = null;
    fakeWindow.releaseFakeHook = () => undefined;
    registry.registerHostPlugin({
      id: 'com.example.fake-panel',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake Panel',
      create: (ctx) => {
        fakeWindow.fakePanelCtx = ctx;
        return { element: document.createElement('div') };
      },
      hooks: {
        documentChange: {
          run: async (ctx) => {
            if (fakeWindow.fakeHookHeld) {
              hold = new Promise<void>((resolve) => { fakeWindow.releaseFakeHook = resolve; });
              await hold;
            }
            const card = ctx.document.sections[0]!.blocks.find((block) => block.schema.id === 'fake-card')!;
            card.text = `Fake card ${String(ctx.document.meta.fake_score ?? 'unscored')}`;
          },
        },
      },
    });
    const filler = Array.from({ length: 40 }, (_, index) => ` <!--hvy:text {"id":"fake-filler-${index}"}-->\n  Fake filler ${index}\n`).join('');
    state.document = deserializeDocument(`---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section
 <!--hvy:plugin {"id":"fake-panel","plugin":"com.example.fake-panel"}-->
 <!--hvy:text {"id":"fake-card"}-->
  Fake card unscored
${filler}`, '.hvy');
    state.currentView = 'viewer';
    getRenderApp()();
    await runPluginDocumentHooks('unknown');
    // A full render restores the reader scroll again over the next two frames.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator('#readerDocument')).toContainText('Fake card unscored');
}

test('before, a plugin render request after an outside change, after: the page stays frozen until hooks finish and swaps once', async ({ page }) => {
  test.setTimeout(5_000);
  await openFakePanelDocument(page);
  await page.evaluate(async () => {
    const { state, renderCount } = await import('/src/state.ts');
    const fakeWindow = window as FreezeTestWindow & { fakeCardBefore?: Element | null; fakeRendersBefore?: number };
    fakeWindow.fakeCardBefore = document.querySelector('#readerDocument [data-block-id]');
    fakeWindow.fakeRendersBefore = renderCount;
    fakeWindow.fakeHookHeld = true;
    state.document.meta.fake_score = 87;
    fakeWindow.fakePanelCtx!.requestRerender();
  });

  const whileHeld = await page.evaluate(async () => {
    const { renderCount } = await import('/src/state.ts');
    const fakeWindow = window as FreezeTestWindow & { fakeCardBefore?: Element | null; fakeRendersBefore?: number };
    const reader = document.querySelector<HTMLElement>('#readerDocument')!;
    const scrolled = new Promise((resolve) => reader.addEventListener('scroll', resolve, { once: true }));
    reader.scrollTop = 300;
    await scrolled;
    return { swapped: !fakeWindow.fakeCardBefore?.isConnected, renders: renderCount - fakeWindow.fakeRendersBefore!, scrollTop: reader.scrollTop };
  });
  expect(whileHeld).toEqual({ swapped: false, renders: 0, scrollTop: 300 });
  await expect(page.locator('#readerDocument')).toContainText('Fake card unscored');

  await page.evaluate(() => (window as FreezeTestWindow).releaseFakeHook!());

  await expect(page.locator('#readerDocument')).toContainText('Fake card 87');
  // The render restores scroll right away and again over the next two frames.
  await expect.poll(() => page.evaluate(async () => {
    const { renderCount } = await import('/src/state.ts');
    const fakeWindow = window as FreezeTestWindow & { fakeRendersBefore?: number };
    return { renders: renderCount - fakeWindow.fakeRendersBefore!, scrollTop: document.querySelector('#readerDocument')!.scrollTop };
  })).toEqual({ renders: 1, scrollTop: 300 });
});

test('before, a plugin render request with an unchanged document, after: it renders right away', async ({ page }) => {
  test.setTimeout(5_000);
  await openFakePanelDocument(page);

  const expectedResult = await page.evaluate(async () => {
    const stateModule = await import('/src/state.ts');
    const rendersBefore = stateModule.renderCount;
    (window as FreezeTestWindow).fakePanelCtx!.requestRerender();
    return stateModule.renderCount - rendersBefore;
  });

  expect(expectedResult).toBe(1);
});

test('before, an embedded viewer script card, outside database write and render request, after: the card is replaced once with the final value', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async () => {
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ '/src/embed.ts');
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px"></div>';
    const fakeWindow = window as FreezeTestWindow & { fakeMount?: { getDocument(): unknown } };
    fakeWindow.fakeMount = mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-jobs"}-->
#! Fake jobs

 <!--hvy:text {"id":"fake-card"}-->
  Loading

 <!--hvy:plugin {"id":"fake-queue-ui","plugin":"fake.queue"}-->

 <!--hvy:plugin {"id":"fake-load","plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
  if not doc.db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'"):
      doc.db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, score TEXT)")
      doc.db.execute("INSERT INTO jobs (id, score) VALUES (1, 'unscored')")
  doc.component.set_text("fake-card", "Fake job " + doc.db.query("SELECT score FROM jobs WHERE id = 1")[0]["score"])
`), '.hvy'),
      plugins: [plugins.scripting, {
        id: 'fake.queue',
        displayName: 'Fake queue',
        create: (ctx: { requestRerender(): void }) => {
          fakeWindow.fakePanelCtx = ctx;
          return { element: document.createElement('div') };
        },
      }],
    });
  });
  await expect(page.locator('#fakeRoot')).toContainText('Fake job unscored');
  await page.evaluate(() => {
    const fakeWindow = window as Window & { fakeCardTexts?: string[] };
    fakeWindow.fakeCardTexts = [];
    new MutationObserver((records) => {
      for (const node of records.flatMap((record) => [...record.addedNodes])) {
        const match = node.textContent?.match(/Fake job \S+/);
        if (match) fakeWindow.fakeCardTexts!.push(match[0]);
      }
    }).observe(document.querySelector('#fakeRoot')!, { childList: true, subtree: true });
  });

  await page.evaluate(async () => {
    const { createScriptingDbRuntime } = await import('/src/plugins/db-table.ts');
    const fakeWindow = window as FreezeTestWindow & { fakeMount?: { getDocument(): Parameters<typeof createScriptingDbRuntime>[0] } };
    const database = await createScriptingDbRuntime(fakeWindow.fakeMount!.getDocument());
    database.api.execute("UPDATE jobs SET score = '87' WHERE id = 1");
    database.dispose();
    fakeWindow.fakePanelCtx!.requestRerender();
  });

  await expect(page.locator('#fakeRoot')).toContainText('Fake job 87');
  expect(await page.evaluate(() => (window as Window & { fakeCardTexts?: string[] }).fakeCardTexts)).toEqual(['Fake job 87']);
});

const visibilityScriptedSource = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-jobs"}-->
#! Fake jobs

 <!--hvy:text {"id":"fake-card"}-->
  Fake card first

 <!--hvy:text {"id":"fake-badge","visibleScript":"return True"}-->
  Fake badge always visible

 <!--hvy:button {"id":"fake-action","buttonLabel":"Fake action","buttonVisibleScript":"return True"}-->

 <!--hvy:plugin {"id":"fake-queue-ui","plugin":"fake.queue"}-->
`;

// Edits the card, requests a render, and records for the next frames whether
// the visibility-scripted badge and button are shown.
function sampleVisibilityAcrossRender(page: Page, runtime: 'embedded' | 'reference'): Promise<string[]> {
  return page.evaluate(async (runtime) => {
    const fakeWindow = window as FreezeTestWindow & { fakeMount?: { getDocument(): { sections: Array<{ blocks: Array<{ text: string }> }> } } };
    const document = runtime === 'embedded'
      ? fakeWindow.fakeMount!.getDocument()
      : (await import('/src/state.ts')).state.document;
    const shown = (element: Element | null | undefined) => Boolean(element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().height > 0);
    const sample = () => {
      const badge = window.document.querySelector('[data-component-id="fake-badge"]')?.closest('[data-visible-state]');
      const button = window.document.querySelector('[data-hvy-button="true"]');
      return `${window.document.body.textContent?.match(/Fake card [a-z]+/)?.[0]} badge:${shown(badge)} button:${shown(button)}`;
    };
    document.sections[0]!.blocks[0]!.text = 'Fake card second';
    fakeWindow.fakePanelCtx!.requestRerender();
    const frames: string[] = [];
    for (let frame = 0; frame < 4; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      frames.push(sample());
    }
    return frames;
  }, runtime);
}

const expectedVisibleFrames = Array.from({ length: 4 }, () => 'Fake card second badge:true button:true');

test('before, visibility-scripted blocks in an embedded viewer, after a script-driven render: no frame hides them', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async (source) => {
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ '/src/embed.ts');
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px"></div>';
    const fakeWindow = window as FreezeTestWindow & { fakeMount?: { getDocument(): unknown } };
    fakeWindow.fakeMount = mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      plugins: [plugins.scripting, {
        id: 'fake.queue',
        displayName: 'Fake queue',
        create: (ctx: { requestRerender(): void }) => {
          fakeWindow.fakePanelCtx = ctx;
          return { element: document.createElement('div') };
        },
      }],
    });
  }, visibilityScriptedSource);
  await expect(page.locator('#fakeRoot [data-hvy-button="true"]')).toHaveAttribute('data-visible-state', 'visible');
  await expect.poll(() => page.evaluate(() => Boolean((window as FreezeTestWindow).fakePanelCtx))).toBe(true);

  const expectedResult = await sampleVisibilityAcrossRender(page, 'embedded');

  expect(expectedResult).toEqual(expectedVisibleFrames);
});

test('before, visibility-scripted blocks in the viewer, after a script-driven render: no frame hides them', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  await page.evaluate(async (source) => {
    const { state, getRenderApp } = await import('/src/state.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    const { runPluginDocumentHooks } = await import('/src/plugins/hooks.ts');
    const registry = await import('/src/plugins/registry.ts');
    registry.registerHostPlugin({
      id: 'fake.queue',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake queue',
      create: (ctx) => {
        (window as FreezeTestWindow).fakePanelCtx = ctx;
        return { element: document.createElement('div') };
      },
    });
    state.document = deserializeDocument(source, '.hvy');
    state.currentView = 'viewer';
    getRenderApp()();
    await runPluginDocumentHooks('unknown');
  }, visibilityScriptedSource);
  await expect(page.locator('#readerDocument [data-hvy-button="true"]')).toHaveAttribute('data-visible-state', 'visible');
  await expect.poll(() => page.evaluate(() => Boolean((window as FreezeTestWindow).fakePanelCtx))).toBe(true);

  const expectedResult = await sampleVisibilityAcrossRender(page, 'reference');

  expect(expectedResult).toEqual(expectedVisibleFrames);
});
