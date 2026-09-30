import { expect, test } from '@playwright/test';

test('public AI mount opens only the requested component editor', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  const expectedResult = await page.evaluate(async () => {
    const { deserializeDocumentBytes, mountHvy } = await import('/src/embed.ts');
    document.body.innerHTML = '<div id="ai-target-editor-root" style="height:600px"></div>';
    const root = document.querySelector<HTMLElement>('#ai-target-editor-root')!;
    const hvyDocument = deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section

 <!--hvy:text {"id":"fake-first"}-->
  Fake first text.

 <!--hvy:text {"id":"fake-second"}-->
  Fake second text.

<!--hvy: {"id":"fake-empty-section"}-->
#! Fake empty section
`), '.hvy');
    const sectionKey = hvyDocument.sections[0]!.key;
    const emptySectionKey = hvyDocument.sections[1]!.key;
    const firstBlockId = hvyDocument.sections[0]!.blocks[0]!.id;
    const secondBlockId = hvyDocument.sections[0]!.blocks[1]!.id;
    const mount = mountHvy({ root, mode: 'ai', document: hvyDocument });

    await mount.openTargetEditor({ sectionKey });
    const sectionStayedInAi = Boolean(
      root.querySelector('#aiReaderDocument')
      && root.querySelector(`.editor-block[data-active-block-id="${CSS.escape(firstBlockId)}"]`)
      && root.querySelector(`.reader-section[data-section-key="${CSS.escape(sectionKey)}"] .compact-add-component-ghost`)
    );
    await mount.openTargetEditor({ sectionKey, blockId: secondBlockId });
    const componentStayedInAi = {
      firstPassive: Boolean(root.querySelector(`.reader-block[data-block-id="${CSS.escape(firstBlockId)}"]`)),
      secondActive: Boolean(root.querySelector(`.editor-block[data-active-block-id="${CSS.escape(secondBlockId)}"]`)),
    };
    await mount.openTargetEditor({ sectionKey: emptySectionKey });
    const result = {
      aiSurface: Boolean(root.querySelector('#aiReaderDocument')),
      documentEditorAbsent: !root.querySelector('#editorTree'),
      emptySectionAuthoring: Boolean(
        root.querySelector(`.reader-section[data-section-key="${CSS.escape(emptySectionKey)}"] .compact-add-component-ghost`)
      ),
      ...componentStayedInAi,
      sectionStayedInAi,
    };
    mount.destroy();
    return result;
  });

  expect(expectedResult).toEqual({
    aiSurface: true,
    documentEditorAbsent: true,
    emptySectionAuthoring: true,
    firstPassive: true,
    secondActive: true,
    sectionStayedInAi: true,
  });
});

test('target render hooks remount after AI renders and clean up when removed', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  const expectedResult = await page.evaluate(async () => {
    const { deserializeDocumentBytes, mountHvy } = await import('/src/embed-full.ts');
    document.body.innerHTML = '<div id="target-hook-root" style="height:600px"></div>';
    const root = document.querySelector<HTMLElement>('#target-hook-root')!;
    const hvyDocument = deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section

 <!--hvy:text {"id":"fake-block"}-->
  Fake text.
`), '.hvy');
    const sectionKey = hvyDocument.sections[0]!.key;
    const blockId = hvyDocument.sections[0]!.blocks[0]!.id;
    let renders = 0;
    let cleanups = 0;
    let clicks = 0;
    const mount = mountHvy({
      root,
      mode: 'ai',
      document: hvyDocument,
      targetRenderHooks: [{
        id: 'fake-action',
        target: { sectionKey, blockId },
        modes: ['ai'],
        postRender({ element, mode, surface }) {
          renders += 1;
          const button = document.createElement('button');
          button.dataset.fakeTargetAction = 'true';
          button.textContent = `${mode}:${surface}`;
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            clicks += 1;
          });
          element.append(button);
          return () => {
            cleanups += 1;
            button.remove();
          };
        },
      }],
    });
    root.querySelector<HTMLButtonElement>('[data-fake-target-action="true"]')!.click();
    const firstButton = root.querySelector('[data-fake-target-action="true"]');
    await mount.openTargetEditor({ sectionKey, blockId });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const secondButton = root.querySelector('[data-fake-target-action="true"]');
    const activeEditor = Boolean(root.querySelector(`.editor-block[data-active-block-id="${CSS.escape(blockId)}"]`));
    mount.setTargetRenderHooks([]);
    const removed = !root.querySelector('[data-fake-target-action="true"]');
    mount.destroy();
    return {
      activeEditor,
      cleanups,
      clicks,
      firstWasReplaced: firstButton !== secondButton,
      removed,
      renders,
    };
  });

  expect(expectedResult).toEqual({
    activeEditor: true,
    cleanups: 2,
    clicks: 1,
    firstWasReplaced: true,
    removed: true,
    renders: 2,
  });
});

test('public viewer exports targets and promotes before opening their editors', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  const expectedResult = await page.evaluate(async () => {
    const { deserializeDocumentBytes, mountHvyViewer } = await import('/src/embed.ts');
    document.body.innerHTML = '<div id="target-editor-root" style="height:600px"></div>';
    const root = document.querySelector<HTMLElement>('#target-editor-root')!;
    const hvyDocument = deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section

 <!--hvy:text {"id":"fake-block"}-->
  Fake text.
`), '.hvy');
    const sectionKey = hvyDocument.sections[0]!.key;
    const blockId = hvyDocument.sections[0]!.blocks[0]!.id;
    let renders = 0;
    let cleanups = 0;
    const mount = mountHvyViewer({
      root,
      document: hvyDocument,
      targetRenderHooks: [{
        id: 'fake-promotion-marker',
        target: { sectionKey, blockId },
        postRender({ element }) {
          renders += 1;
          const marker = document.createElement('span');
          marker.dataset.fakePromotionMarker = 'true';
          element.append(marker);
          return () => {
            cleanups += 1;
            marker.remove();
          };
        },
      }],
    });
    const sectionHvy = mount.exportTargetHvy({ sectionKey });
    const blockHvy = mount.exportTargetHvy({ sectionKey, blockId });
    const viewerMarker = root.querySelector('[data-fake-promotion-marker="true"]');
    await mount.openTargetEditor({ sectionKey, blockId });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const editorMarker = root.querySelector('[data-fake-promotion-marker="true"]');
    const hookSurvivedPromotion = Boolean(
      viewerMarker && editorMarker && viewerMarker !== editorMarker && renders >= 2 && cleanups >= 1
    );
    await mount.openTargetEditor({ sectionKey });
    const result = {
      blockOnly: blockHvy.includes('Fake text.') && !blockHvy.includes('#! Fake section'),
      editorOpen: Boolean(root.querySelector(`.editor-block[data-active-block-id="${CSS.escape(blockId)}"]`)),
      hookSurvivedPromotion,
      sectionEditorOpen: document.activeElement?.matches('.section-title-input') === true,
      sectionOnly: sectionHvy.includes('#! Fake section') && !sectionHvy.includes('hvy_version:'),
    };
    mount.destroy();
    return result;
  });

  expect(expectedResult).toEqual({
    blockOnly: true,
    editorOpen: true,
    hookSurvivedPromotion: true,
    sectionEditorOpen: true,
    sectionOnly: true,
  });
});
