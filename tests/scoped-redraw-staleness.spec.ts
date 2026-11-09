import { readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The staleness check: after a script edit, what is on the page must match a full redraw exactly.

type FakeWindow = Window & {
  fakeMount: { getDocument(): unknown; setMode(mode: string): Promise<void> };
  fakePanelCtx: { requestRerender(): void };
};

async function mountViewer(page: Page, bytesBase64: string, extension: string, fullRuntime: boolean): Promise<void> {
  await page.goto('/');
  await page.evaluate(async ({ bytesBase64, extension, fullRuntime }) => {
    const embedPath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px;overflow:auto"></div>';
    const fakeWindow = window as unknown as FakeWindow;
    fakeWindow.fakeMount = mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode: 'viewer',
      document: deserializeDocumentBytes(Uint8Array.from(atob(bytesBase64), (c) => c.charCodeAt(0)), extension),
      plugins: Object.values(plugins),
    });
    if (fullRuntime) {
      await fakeWindow.fakeMount.setMode('editor');
      await fakeWindow.fakeMount.setMode('viewer');
    }
  }, { bytesBase64, extension, fullRuntime });
  await page.waitForTimeout(150);
}

async function runScript(page: Page, source: string): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async (scriptSource) => {
    const [{ runUserScript }, stateModule] = await Promise.all([
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/state.ts'),
    ]);
    const document = (window as unknown as FakeWindow).fakeMount.getDocument() as never;
    void stateModule;
    const result = await runUserScript({ document, source: scriptSource });
    return { ok: result.ok, error: result.error };
  }, source);
}

const markRedrawSentinel = (page: Page) => page.evaluate(() => {
  document.querySelector('#readerDocument')?.setAttribute('data-fake-sentinel', 'kept');
});
const sentinelKept = (page: Page) => page.evaluate(() => document.querySelector('#readerDocument')?.getAttribute('data-fake-sentinel') === 'kept');

// Page content without state that legitimately differs between two identical renders.
const readPage = (page: Page) => page.evaluate(() => {
  const clone = document.querySelector('#fakeRoot')!.cloneNode(true) as HTMLElement;
  clone.querySelector('#readerDocument')?.removeAttribute('data-fake-sentinel');
  // Embedded video players add their own id over the network, whenever their script happens to load.
  clone.querySelectorAll('iframe').forEach((frame) => frame.removeAttribute('id'));
  clone.querySelectorAll('input, textarea').forEach((element) => {
    const control = element as HTMLInputElement;
    control.setAttribute('data-fake-value', control.type === 'checkbox' ? String(control.checked) : control.value);
  });
  return clone.innerHTML;
});

async function forceFullRedraw(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { getRenderApp } = await import('/src/state.ts');
    getRenderApp()();
  });
  await page.waitForTimeout(100);
}

function expectSamePage(scoped: string, full: string): void {
  // Compare with a useful failure: the first place the two pages part ways.
  if (scoped === full) return;
  let index = 0;
  while (index < scoped.length && scoped[index] === full[index]) index += 1;
  expect({ scoped: scoped.slice(Math.max(0, index - 120), index + 160) }).toEqual({ scoped: full.slice(Math.max(0, index - 120), index + 160) });
}

const fakeDocument = `---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:text {"id":"fake-text"}-->
Fake **start**

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Fake label"}}-->
fields:
  - label: Fake field
    type: text

<!--hvy:container {"id":"fake-parent"}-->
 <!--hvy:text {"id":"fake-child"}-->
  Fake child

<!--hvy:text {"id":"fake-visible","visibleScript":"return doc.component.get_text(\\"fake-text\\").strip() == \\"Fake reveal\\""}-->
Fake shown only on reveal

<!--hvy:text {"id":"fake-other"}-->
Fake other

<!--hvy:text {"id":"fake-editor-only","editorOnly":true}-->
Fake editor only
`;
const fakeBase64 = Buffer.from(fakeDocument).toString('base64');

// Each edit either qualifies for a partial redraw or must fall back; both must match a full redraw.
const edits: Array<{ name: string; source: string; scoped: boolean }> = [
  { name: 'plain text', source: 'doc.component.set_text("fake-text", "Fake **changed**")', scoped: true },
  { name: 'nested text', source: 'doc.component.set_text("fake-child", "Fake changed child")', scoped: true },
  { name: 'form config', source: 'doc.cli.run("sed -i \'s/Fake label/Changed label/\' /id/fake-form/plugin.json")', scoped: true },
  { name: 'text a visible script depends on', source: 'doc.component.set_text("fake-text", "Fake reveal")', scoped: true },
  { name: 'editor-only text', source: 'doc.component.set_text("fake-editor-only", "Fake changed editor only")', scoped: true },
  { name: 'header value', source: 'doc.header.set("fake_key", "fake value")', scoped: false },
  { name: 'component css', source: 'doc.tool.get_components(component="text")[0].set("css", "color: red;")', scoped: false },
  { name: 'removed component', source: 'doc.tool.remove_component(component_ref="fake-other")', scoped: false },
  { name: 'text with a radio group', source: 'doc.component.set_text("fake-text", "<!--hvy:radio-group fake-->\\n( ) Fake choice")', scoped: false },
];

for (const fullRuntime of [false, true]) {
  const runtimeName = fullRuntime ? 'full runtime' : 'lightweight runtime';
  for (const edit of edits) {
    test(`${runtimeName}: ${edit.name} matches a full redraw`, async ({ page }) => {
      test.setTimeout(5_000);
      await mountViewer(page, fakeBase64, '.hvy', fullRuntime);
      await markRedrawSentinel(page);

      expect(await runScript(page, edit.source)).toMatchObject({ ok: true });
      await page.waitForTimeout(150);

      expect(await sentinelKept(page)).toBe(edit.scoped);
      const scopedPage = await readPage(page);
      await forceFullRedraw(page);
      expectSamePage(scopedPage, await readPage(page));
    });
  }
}

for (const file of readdirSync('examples').filter((name) => /\.hvy$/.test(name))) {
  test(`${file}: text edits match a full redraw`, async ({ page }) => {
    test.setTimeout(5_000);
    await mountViewer(page, readFileSync(`examples/${file}`).toString('base64'), '.hvy', false);

    const result = await runScript(page, `
handles = doc.tool.get_components(component="text")
for handle in handles[:3]:
    handle.set("text", "Fake staleness edit")
`);
    expect(result).toMatchObject({ ok: true });
    await page.waitForTimeout(150);

    const scopedPage = await readPage(page);
    await forceFullRedraw(page);
    expectSamePage(scopedPage, await readPage(page));
  });
}

test('a partial redraw keeps the reader scroll position and focus in a form', async ({ page }) => {
  test.setTimeout(5_000);
  const longDocument = `${fakeDocument}\n${Array.from({ length: 40 }, (_, index) => `<!--hvy:text {"id":"fake-long-${index}"}-->\nFake long text ${index}\n`).join('\n')}`;
  await mountViewer(page, Buffer.from(longDocument).toString('base64'), '.hvy', true);
  const input = page.locator('#fakeRoot').getByLabel('Fake field');
  await input.pressSequentially('abc');
  await markRedrawSentinel(page);
  const scrollBefore = await page.evaluate(() => {
    const reader = document.querySelector('#readerDocument') as HTMLElement;
    reader.scrollTop = 120;
    return reader.scrollTop;
  });

  expect(await runScript(page, 'doc.component.set_text("fake-long-30", "Fake changed long text")')).toMatchObject({ ok: true });
  await page.waitForTimeout(150);

  expect(await sentinelKept(page)).toBe(true);
  await expect(page.locator('#fakeRoot')).toContainText('Fake changed long text');
  expect(await page.evaluate(() => (document.querySelector('#readerDocument') as HTMLElement).scrollTop)).toBe(scrollBefore);
  await expect(input).toBeFocused();
  await input.pressSequentially('d');
  await expect(input).toHaveValue('abcd');
});

const fakeEditingPluginDocument = `---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:text {"id":"fake-text"}-->
Fake start

<!--hvy:plugin {"id":"fake-editing-block","plugin":"fake.editing"}-->
Fake editing plugin
`;

async function mountEditingPluginViewer(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (source) => {
    const embedPath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px;overflow:auto"></div>';
    const fakeWindow = window as unknown as FakeWindow & { fakeHookReasons: string[]; fakeEditOnRefresh: boolean };
    fakeWindow.fakeHookReasons = [];
    fakeWindow.fakeEditOnRefresh = false;
    fakeWindow.fakeMount = mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      plugins: [plugins.scripting, {
        id: 'fake.editing',
        displayName: 'Fake editing',
        mount: { strategy: 'immediate' },
        create: (ctx: { rawDocument: { meta: Record<string, unknown> } }) => ({
          element: document.createElement('div'),
          refresh: () => {
            if (fakeWindow.fakeEditOnRefresh) {
              ctx.rawDocument.meta.fake_plugin_edit = 'edited during refresh';
            }
          },
        }),
        hooks: {
          documentChange: { run: (ctx: { changeReason: string }) => { fakeWindow.fakeHookReasons.push(ctx.changeReason); } },
        },
      }],
    });
  }, fakeEditingPluginDocument);
  await page.waitForTimeout(150);
}

test('a plugin that edits the document during a partial redraw still runs document hooks', async ({ page }) => {
  test.setTimeout(5_000);
  await mountEditingPluginViewer(page);
  await markRedrawSentinel(page);
  await page.evaluate(() => {
    (window as unknown as { fakeEditOnRefresh: boolean; fakeHookReasons: string[] }).fakeEditOnRefresh = true;
    (window as unknown as { fakeHookReasons: string[] }).fakeHookReasons = [];
  });

  expect(await runScript(page, 'doc.component.set_text("fake-text", "Fake changed")')).toMatchObject({ ok: true });

  await expect.poll(() => page.evaluate(() => (window as unknown as { fakeHookReasons: string[] }).fakeHookReasons)).toEqual(['script-edit', 'unknown']);
  expect(await sentinelKept(page)).toBe(true);
});

test('a partial redraw where plugins edit nothing runs no extra document hooks', async ({ page }) => {
  test.setTimeout(5_000);
  await mountEditingPluginViewer(page);
  await markRedrawSentinel(page);
  await page.evaluate(() => { (window as unknown as { fakeHookReasons: string[] }).fakeHookReasons = []; });

  expect(await runScript(page, 'doc.component.set_text("fake-text", "Fake changed")')).toMatchObject({ ok: true });
  await page.waitForTimeout(150);

  expect(await page.evaluate(() => (window as unknown as { fakeHookReasons: string[] }).fakeHookReasons)).toEqual(['script-edit']);
  expect(await sentinelKept(page)).toBe(true);
});

async function mountEmptyingPluginViewer(page: Page, cardCount: number, fullRuntime: boolean): Promise<void> {
  const cards = Array.from({ length: cardCount }, (_, index) => `<!--hvy:text {"id":"fake-card-${index}"}-->\nFake card ${index}\n`).join('\n');
  await page.goto('/');
  await page.evaluate(async ({ source, fullRuntime }) => {
    const embedPath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="fakeRoot" style="height:640px"></div>';
    const fakeWindow = window as unknown as FakeWindow;
    fakeWindow.fakeMount = mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      plugins: [plugins.scripting, {
        id: 'fake.filter',
        displayName: 'Fake filter',
        mount: { strategy: 'immediate' },
        create: () => {
          const element = document.createElement('div');
          const fill = () => { element.innerHTML = '<div style="height:600px">Fake filter results</div>'; };
          fill();
          return {
            element,
            refresh: () => {
              element.innerHTML = '';
              void element.getBoundingClientRect().height;
              fill();
            },
          };
        },
      }],
    });
    if (fullRuntime) {
      await fakeWindow.fakeMount.setMode('editor');
      await fakeWindow.fakeMount.setMode('viewer');
    }
  }, { source: `---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:text {"id":"fake-picks"}-->
none

${cards}

<!--hvy:plugin {"id":"fake-filter-block","plugin":"fake.filter"}-->
Fake filter
`, fullRuntime });
  await page.locator('#readerDocument').getByText('Fake filter results').waitFor();
  // Mounting renders more than once, and each render restores the scroll over the next two frames.
  await page.waitForTimeout(200);
}

for (const fullRuntime of [false, true]) {
  for (const [pageName, cardCount] of [['short', 4], ['long', 60]] as const) {
    test(`${fullRuntime ? 'full' : 'lightweight'} runtime, ${pageName} page: a plugin briefly emptying during a partial redraw keeps the scroll`, async ({ page }) => {
      test.setTimeout(5_000);
      await mountEmptyingPluginViewer(page, cardCount, fullRuntime);
      await markRedrawSentinel(page);
      const scrollBefore = await page.evaluate(() => {
        const reader = document.querySelector('#readerDocument') as HTMLElement;
        reader.scrollTop = reader.scrollHeight;
        return reader.scrollTop;
      });
      expect(scrollBefore).toBeGreaterThan(0);

      expect(await runScript(page, 'doc.component.set_text("fake-picks", "Fake changed")')).toMatchObject({ ok: true });
      await page.waitForTimeout(150);

      expect(await sentinelKept(page)).toBe(true);
      await expect(page.locator('#readerDocument')).toContainText('Fake changed');
      expect(await page.evaluate(() => (document.querySelector('#readerDocument') as HTMLElement).scrollTop)).toBe(scrollBefore);
    });
  }
}

test('a partial redraw that has to fall back to a full redraw keeps the scroll', async ({ page }) => {
  test.setTimeout(5_000);
  await mountEmptyingPluginViewer(page, 4, true);
  await markRedrawSentinel(page);
  const scrollBefore = await page.evaluate(() => {
    const reader = document.querySelector('#readerDocument') as HTMLElement;
    reader.scrollTop = reader.scrollHeight;
    return reader.scrollTop;
  });

  // A header edit does not qualify for a partial redraw.
  expect(await runScript(page, 'doc.header.set("fake_key", "fake value")')).toMatchObject({ ok: true });
  await page.waitForTimeout(150);

  expect(await sentinelKept(page)).toBe(false);
  expect(await page.evaluate(() => (document.querySelector('#readerDocument') as HTMLElement).scrollTop)).toBe(scrollBefore);
});
