import { expect, test } from '@playwright/test';

for (const initialMode of ['viewer', 'editor', 'ai']) {
  test(`public mount switches all views in place from ${initialMode}`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    await page.evaluate(async (initialMode) => {
      const embedPath = '/src/embed.ts';
      const { mountHvy, deserializeDocumentBytes } = await import(/* @vite-ignore */ embedPath);
      document.body.innerHTML = '<div id="modeRoot" style="height:500px"></div>';
      const root = document.querySelector('#modeRoot');
      const mount = mountHvy({ root, mode: initialMode, document: deserializeDocumentBytes(
        new TextEncoder().encode('---\nhvy_version: 0.1\n---\n\n#! Sample\n\n Sample body.\n'), '.hvy') });
      Object.assign(window, { viewTestMount: mount });
    }, initialMode);
    await expect(page.locator('#modeRoot .workspace-shell')).toBeVisible();
    expect(await page.evaluate(async () => {
      const statePath = '/src/state.ts';
      const historyPath = '/src/history.ts';
      const { getActiveStateRuntime, runWithStateRuntime } = await import(/* @vite-ignore */ statePath);
      const { recordHistory } = await import(/* @vite-ignore */ historyPath);
      const root = document.querySelector('#modeRoot')!;
      root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const runtime = getActiveStateRuntime();
      const mount = (window as any).viewTestMount;
      const originalDocument = mount.getDocument();
      runWithStateRuntime(runtime, () => {
        recordHistory();
        runtime.state.document.meta.title = 'Edited sample';
        runtime.state.search.query = 'Retained search';
        runtime.state.viewerSidebarOpen = true;
      });
      const history = runtime.state.history;
      const search = runtime.state.search;
      const dirtyBefore = mount.isDirty();
      await mount.setMode('editor');
      mount.setEditorMode('advanced');
      runtime.state.chat.draft = 'Retained editing draft';
      await mount.setMode('ai');
      const editingChatRetained = runtime.state.chat.draft === 'Retained editing draft';
      const ai = Boolean(root.querySelector('#aiReaderDocument')) && runtime.state.editorMode === 'basic';
      await mount.setMode('viewer');
      const viewer = Boolean(root.querySelector('#readerDocument'));
      const chatCleared = runtime.state.chat.draft === '';
      const tree = root.firstElementChild;
      await mount.setMode('viewer');
      const noOp = tree === root.firstElementChild;
      await mount.setMode('editor');
      root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const result = { sameRuntime: getActiveStateRuntime() === runtime,
        sameDocument: mount.getDocument() === originalDocument,
        sameHistory: history === runtime.state.history, sameSearch: search === runtime.state.search,
        searchPreserved: search.query === 'Retained search', sidebar: runtime.state.viewerSidebarOpen,
        dirty: dirtyBefore && mount.isDirty(), editor: Boolean(root.querySelector('#editorTree')),
        ai, viewer, noOp, editingChatRetained, chatCleared };
      await mount.undo();
      const undo = mount.getDocument().meta.title !== 'Edited sample';
      mount.destroy();
      return { ...result, undo };
    })).toEqual({ sameRuntime: true, sameDocument: true, sameHistory: true, sameSearch: true,
      searchPreserved: true, sidebar: true, dirty: true, editor: true, ai: true, viewer: true,
      noOp: true, editingChatRetained: true, chatCleared: true, undo: true });
  });
}

for (const initialMode of ['viewer', 'editor']) {
  test(`mode calls during loading remain ordered from ${initialMode}`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    expect(await page.evaluate(async (initialMode) => {
      const embedPath = '/src/embed.ts';
      const { mountHvy, deserializeDocumentBytes } = await import(/* @vite-ignore */ embedPath);
      const root = document.createElement('div');
      document.body.append(root);
      const mount = mountHvy({ root, mode: initialMode, document: deserializeDocumentBytes(
        new TextEncoder().encode('---\nhvy_version: 0.1\n---\n\n#! Sample\n\n Sample body.'), '.hvy') });
      await Promise.all([mount.setMode('editor'), mount.setMode('ai'), mount.setMode('viewer')]);
      const viewer = Boolean(root.querySelector('#readerDocument'));
      let rejectedInvalid = false;
      try { await mount.setMode('unknown'); } catch { rejectedInvalid = true; }
      await mount.setMode('editor');
      const editor = Boolean(root.querySelector('#editorTree'));
      mount.destroy();
      let rejectedDestroyed = false;
      try { await mount.setMode('ai'); } catch { rejectedDestroyed = true; }
      return { viewer, editor, rejectedInvalid, rejectedDestroyed, empty: root.childElementCount === 0 };
    }, initialMode)).toEqual({ viewer: true, editor: true, rejectedInvalid: true, rejectedDestroyed: true, empty: true });
  });

  test(`destroy during initial ${initialMode} loading cancels view transitions`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    expect(await page.evaluate(async (initialMode) => {
      const embedPath = '/src/embed.ts';
      const { mountHvy, deserializeDocumentBytes } = await import(/* @vite-ignore */ embedPath);
      const root = document.createElement('div');
      document.body.append(root);
      const mount = mountHvy({ root, mode: initialMode, document: deserializeDocumentBytes(
        new TextEncoder().encode('---\nhvy_version: 0.1\n---\n\n#! Sample\n\n Sample body.'), '.hvy') });
      const pending = mount.setMode('ai').then(() => false, () => true);
      mount.destroy();
      return { rejected: await pending, empty: root.childElementCount === 0 };
    }, initialMode)).toEqual({ rejected: true, empty: true });
  });
}

test('promoted viewer commits active text and retains focus while typing after repeated view changes', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async () => {
    const embedPath = '/src/embed.ts';
    const { mountHvyViewer, deserializeDocumentBytes } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="modeRoot" style="height:600px"></div>';
    const mount = mountHvyViewer({ root: document.querySelector('#modeRoot'), document: deserializeDocumentBytes(
      new TextEncoder().encode('---\nhvy_version: 0.1\n---\n\n#! Sample\n\n Sample body.'), '.hvy') });
    Object.assign(window, { viewTestMount: mount });
    await mount.setMode('editor');
    await mount.setMode('viewer');
    await mount.setMode('ai');
    await mount.setMode('editor');
  });
  await page.locator('.editor-block-passive', { hasText: 'Sample body.' }).click();
  const editor = page.locator('.rich-editor[data-field="block-rich"]');
  await editor.fill('Sample revision');
  await editor.press('End');
  await editor.pressSequentially(' retained');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('Sample revision retained');
  await page.evaluate(() => (window as any).viewTestMount.setMode('viewer'));
  await expect(page.locator('#readerDocument')).toContainText('Sample revision retained');
  await page.evaluate(() => (window as any).viewTestMount.setMode('editor'));
  await expect(page.locator('.editor-block-passive', { hasText: 'Sample revision retained' })).toBeVisible();
});

test('viewer promotion preserves plugin instance, host overrides, and reader scroll', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  expect(await page.evaluate(async () => {
    const embedPath = '/src/embed.ts';
    const { mountHvyViewer, deserializeDocumentBytes } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="modeRoot" style="height:350px"></div>';
    const root = document.querySelector('#modeRoot') as HTMLElement;
    let creations = 0;
    let disposals = 0;
    let loads = 0;
    const mount = mountHvyViewer({ root, document: deserializeDocumentBytes(new TextEncoder().encode(
      '---\nhvy_version: 0.1\n---\n\n#! Sample\n\n<!--hvy:plugin {"id":"sample-plugin","plugin":"sample.state"}-->\n\n' +
      Array.from({ length: 40 }, (_, index) => `<!--hvy:text {"id":"sample-${index}"}-->\n Sample content.\n\n`).join('')), '.hvy'),
      plugins: [{ id: 'sample.state', uuid: 'sample-state-plugin', version: '1.0.0', hvyApiVersion: '0.1',
        displayName: 'Sample state', create() {
          creations++;
          const element = document.createElement('div');
          element.textContent = 'Sample plugin';
          return { element, unmount() { disposals++; } };
        }, hooks: { documentLoad: { run() { loads++; } } },
      }],
    });
    // Let the initial document load hooks finish before exercising the transition.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const setThemeOverrides = mount.setThemeOverrides;
    setThemeOverrides({ '--hvy-accent-1': '#123456' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    root.querySelector('#readerDocument')!.scrollTop = 120;
    const scrollBefore = root.querySelector('#readerDocument')!.scrollTop;
    const creationsBefore = creations;
    await mount.setMode('editor');
    setThemeOverrides({ '--hvy-accent-1': '#123456' });
    const cachedSetterPreservedView = Boolean(root.querySelector('#editorTree'));
    await mount.setMode('viewer');
    const result = { cachedSetterPreservedView, loads, samePlugin: creations === creationsBefore && creationsBefore > 0,
      disposals, scroll: scrollBefore > 0 && root.querySelector('#readerDocument')!.scrollTop === scrollBefore,
      theme: root.style.getPropertyValue('--hvy-accent-1').trim() };
    mount.destroy();
    return { ...result, disposedOnDestroy: disposals === creations };
  })).toEqual({ cachedSetterPreservedView: true, loads: 1, samePlugin: true, disposals: 0, scroll: true, theme: '#123456', disposedOnDestroy: true });
});
