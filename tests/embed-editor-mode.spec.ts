import { expect, test } from '@playwright/test';

test('embedded mode changes preserve runtime, history, chat, search and scroll', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const embedPath = '/src/embed-full.ts';
    const statePath = '/src/state.ts';
    const historyPath = '/src/history.ts';
    const { mountHvy } = await import(/* @vite-ignore */ embedPath);
    const serializationPath = '/src/serialization.ts';
    const { deserializeDocument } = await import(/* @vite-ignore */ serializationPath);
    const { getActiveStateRuntime, runWithStateRuntime } = await import(/* @vite-ignore */ statePath);
    const { recordHistory } = await import(/* @vite-ignore */ historyPath);
    document.body.innerHTML = '<div id="root" style="height:400px"></div>';
    const root = document.querySelector('#root') as HTMLElement;
    const mount = mountHvy({ root, mode: 'editor', document: deserializeDocument(
      '---\nhvy_version: 0.1\n---\n\n<!--hvy: {"id":"sample"}-->\n#! Sample\n\n' + ' Sample content.\n\n'.repeat(40), '.hvy'),
    });
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const runtime = getActiveStateRuntime();
    const originalDocument = mount.getDocument();
    runWithStateRuntime(runtime, () => {
      recordHistory();
      runtime.state.document.meta.title = 'Edited sample';
      runtime.state.chat.draft = 'Unsent sample';
      runtime.state.editorSidebarOpen = true;
      runtime.state.search.query = 'Sample';
      runtime.callbacks.renderApp();
    });
    const history = runtime.state.history;
    const chat = runtime.state.chat;
    const search = runtime.state.search;
    const dirtyBefore = mount.isDirty();
    root.querySelector('#editorTree')!.scrollTop = 120;
    const scrollBefore = root.querySelector('#editorTree')!.scrollTop;
    mount.setEditorMode('advanced');
    const advanced = runtime.state.showAdvancedEditor;
    const scrollAfter = root.querySelector('#editorTree')!.scrollTop;
    const tree = root.querySelector('#editorTree');
    mount.setEditorMode('advanced');
    const sameModePreservesDom = tree === root.querySelector('#editorTree');
    mount.setEditorMode('basic');
    const preserved = {
      document: mount.getDocument() === originalDocument,
      history: runtime.state.history === history,
      chat: runtime.state.chat === chat && chat.draft === 'Unsent sample',
      search: runtime.state.search === search && search.query === 'Sample',
      sidebar: runtime.state.editorSidebarOpen,
      dirty: dirtyBefore && mount.isDirty(),
      advanced,
      basic: runtime.state.editorMode === 'basic' && !runtime.state.showAdvancedEditor,
      sameModePreservesDom,
      scroll: scrollBefore > 0 && scrollAfter === scrollBefore,
    };
    await mount.undo();
    const undoWorked = mount.getDocument().meta.title !== 'Edited sample';
    mount.destroy();
    return { ...preserved, undoWorked };
  });
  expect(result).toEqual({ document: true, history: true, chat: true, search: true, sidebar: true,
    dirty: true, advanced: true, basic: true, sameModePreservesDom: true, scroll: true, undoWorked: true });
});

test('public embed queues mode changes and isolates mounted editors', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async () => {
    const embedPath = '/src/embed.ts';
    const { mountHvy, deserializeDocumentBytes } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="first"></div><div id="second"></div>';
    const source = new TextEncoder().encode('---\nhvy_version: 0.1\n---\n\n#! Sample\n\n Sample text.');
    const first = mountHvy({ root: document.querySelector('#first'), mode: 'editor',
      document: deserializeDocumentBytes(source, '.hvy') });
    first.setEditorMode('advanced');
    first.setEditorMode('basic');
    first.setEditorMode('mobile-adjustment');
    const second = mountHvy({ root: document.querySelector('#second'), mode: 'editor',
      document: deserializeDocumentBytes(source, '.hvy') });
    Object.assign(window, { modeTestMounts: [first, second] });
  });
  await expect(page.locator('#first #editorTree')).toBeVisible();
  await expect(page.locator('#second #editorTree')).toBeVisible();
  expect(await page.evaluate(async () => {
    const statePath = '/src/state.ts';
    const { getActiveStateRuntime } = await import(/* @vite-ignore */ statePath);
    const firstRoot = document.querySelector('#first')!;
    const secondRoot = document.querySelector('#second')!;
    firstRoot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const firstRuntime = getActiveStateRuntime();
    const queuedMode = firstRuntime.state.editorMode;
    secondRoot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const secondRuntime = getActiveStateRuntime();
    const secondTree = secondRoot.querySelector('#editorTree');
    const [first, second] = (window as any).modeTestMounts;
    first.setEditorMode('mobile-adjustment');
    const mobileMode = firstRuntime.state.editorMode;
    first.setEditorMode('advanced');
    const result = { queuedMode, mobileMode, firstMode: firstRuntime.state.editorMode,
      secondMode: secondRuntime.state.editorMode, secondDomPreserved: secondTree === secondRoot.querySelector('#editorTree') };
    first.destroy();
    second.destroy();
    return result;
  })).toEqual({ queuedMode: 'mobile-adjustment', mobileMode: 'mobile-adjustment', firstMode: 'advanced',
    secondMode: 'basic', secondDomPreserved: true });
});

for (const modulePath of ['/src/embed.ts', '/src/embed-full.ts']) {
  test(`viewer rejects editor mode changes: ${modulePath}`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    expect(await page.evaluate(async (modulePath) => {
      const { mountHvyViewer, deserializeDocumentBytes } = await import(/* @vite-ignore */ modulePath);
      const root = document.createElement('div');
      document.body.append(root);
      const mount = mountHvyViewer({ root, document: deserializeDocumentBytes(
        new TextEncoder().encode('---\nhvy_version: 0.1\n---\n\n#! Sample\n\n Sample text.'), '.hvy') });
      const tree = root.firstElementChild;
      try {
        mount.setEditorMode('advanced');
        return { error: null };
      } catch (error) {
        return { error: (error as Error).message, domPreserved: tree === root.firstElementChild };
      } finally {
        mount.destroy();
      }
    }, modulePath)).toEqual({ error: 'setEditorMode requires an editor mount.', domPreserved: true });
  });
}
