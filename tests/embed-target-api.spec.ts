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

test('target text comparison previews a character diff and accepted replacement uses history', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  const expectedResult = await page.evaluate(async () => {
    const { deserializeDocumentBytes, mountHvy } = await import('/src/embed.ts');
    document.body.innerHTML = `
      <div id="target-text-mount" style="height:500px"></div>
      <div id="target-text-before" style="width:400px"></div>
      <div id="target-text-after" style="width:400px"></div>
    `;
    const root = document.querySelector<HTMLElement>('#target-text-mount')!;
    const beforeRoot = document.querySelector<HTMLElement>('#target-text-before')!;
    const afterRoot = document.querySelector<HTMLElement>('#target-text-after')!;
    const hvyDocument = deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
component_defs:
  - name: Job History Item
    baseType: container
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section

 <!--hvy:block {"id":"fake-job","component":"Job History Item","containerTitle":"Original role"}-->

  <!--hvy:text {"id":"fake-copy"}-->
   We build **small** tools.

  <!--hvy:text {"id":"fake-link"}-->
   See [details](https://example.com).

  <!--hvy:grid {"id":"fake-grid","gridColumns":2,"gridStackWidth":"48rem"}-->

   <!--hvy:grid:0 {}-->

    <!--hvy:text {}-->
     Relevant skills

   <!--hvy:grid:1 {}-->

    <!--hvy:text {}-->
     Tools and technologies

  <!--hvy:component-list {"id":"fake-references","componentListComponent":"xref-card","componentListItemLabel":"reference"}-->

   <!--hvy:component-list:0 {}-->

    <!--hvy:xref-card {"xrefTitle":"Existing reference","xrefTarget":"fake-copy"}-->
`), '.hvy');
    const sectionKey = hvyDocument.sections[0]!.key;
    const blockId = hvyDocument.sections[0]!.blocks[0]!.id;
    const changes: Array<{ dirty: boolean; source?: string }> = [];
    const mount = mountHvy({
      root,
      mode: 'ai',
      document: hvyDocument,
      onDocumentChange(event) {
        changes.push({ dirty: event.dirty, source: event.source });
      },
    });

    const comparison = await mount.renderTargetTextComparison({
      target: { sectionKey, blockId },
      proposedHvy: '<!--hvy:block {"component":"Job History Item","containerTitle":"Updated role"}-->\n\n <!--hvy:text {"id":"fake-copy"}-->\n  We build **smarter** tools!\n\n <!--hvy:text {"id":"fake-link"}-->\n  See [details](https://example.com).\n\n <!--hvy:grid {"id":"fake-grid","gridColumns":2,"gridStackWidth":"48rem"}-->\n\n  <!--hvy:grid:0 {}-->\n\n   <!--hvy:text {}-->\n    Relevant skills\n\n  <!--hvy:grid:1 {}-->\n\n   <!--hvy:text {}-->\n    Tools and technologies\n\n <!--hvy:component-list {"id":"fake-references","componentListComponent":"xref-card","componentListItemLabel":"reference"}-->\n\n  <!--hvy:component-list:0 {}-->\n\n   <!--hvy:xref-card {"xrefTitle":"Existing reference","xrefTarget":"fake-copy"}-->',
      beforeRoot,
      afterRoot,
    });
    const comparisonSurface = beforeRoot.querySelector<HTMLElement>('.hvy-target-text-comparison-surface')!;
    const comparisonTarget = comparisonSurface.firstElementChild as HTMLElement;
    const addedMarker = afterRoot.querySelector<HTMLElement>('ins');
    const removedMarker = beforeRoot.querySelector<HTMLElement>('del');
    const previewLinks = Array.from(beforeRoot.querySelectorAll<HTMLAnchorElement>('a'));
    const locationBeforeClicks = window.location.href;
    previewLinks.forEach((link) => link.click());
    const preview = {
      added: Array.from(afterRoot.querySelectorAll('ins'), (element) => element.textContent).join(''),
      addedColor: addedMarker ? getComputedStyle(addedMarker).color : '',
      after: afterRoot.querySelector('.reader-block-text')?.textContent?.trim(),
      afterComposite: afterRoot.querySelector('.reader-block-container')?.textContent?.includes('Updated role'),
      before: beforeRoot.querySelector('.reader-block-text')?.textContent?.trim(),
      beforeComposite: beforeRoot.querySelector('.reader-block-container')?.textContent?.includes('Original role'),
      containerColumns: getComputedStyle(comparisonTarget.querySelector<HTMLElement>('.reader-grid-layout')!).gridTemplateColumns.split(' ').length,
      editingControls: beforeRoot.querySelectorAll('[data-action], .component-list-add-ghost').length
        + afterRoot.querySelectorAll('[data-action], .component-list-add-ghost').length,
      linkCount: previewLinks.length,
      linksDisabled: previewLinks.every((link) => (
        !link.hasAttribute('href') && link.getAttribute('aria-disabled') === 'true' && link.tabIndex === -1
      )),
      linksStayedPut: window.location.href === locationBeforeClicks,
      removed: Array.from(beforeRoot.querySelectorAll('del'), (element) => element.textContent).join(''),
      removedColor: removedMarker ? getComputedStyle(removedMarker).color : '',
      surfaceContainerName: getComputedStyle(comparisonSurface).containerName,
      xrefDisabled: beforeRoot.querySelector('.reader-xref-card')?.getAttribute('aria-disabled'),
    };

    const replacement = await mount.replaceTargetHvy(
      { sectionKey, blockId },
      '<!--hvy:block {"component":"Job History Item","containerTitle":"Updated role"}-->\n\n <!--hvy:text {"id":"fake-copy"}-->\n  We build **smarter** tools!\n\n <!--hvy:text {"id":"fake-link"}-->\n  See [details](https://example.com).\n\n <!--hvy:grid {"id":"fake-grid","gridColumns":2,"gridStackWidth":"48rem"}-->\n\n  <!--hvy:grid:0 {}-->\n\n   <!--hvy:text {}-->\n    Relevant skills\n\n  <!--hvy:grid:1 {}-->\n\n   <!--hvy:text {}-->\n    Tools and technologies\n\n <!--hvy:component-list {"id":"fake-references","componentListComponent":"xref-card","componentListItemLabel":"reference"}-->\n\n  <!--hvy:component-list:0 {}-->\n\n   <!--hvy:xref-card {"xrefTitle":"Existing reference","xrefTarget":"fake-copy"}-->'
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const afterApply = {
      dirty: mount.isDirty(),
      id: mount.getDocument().sections[0]!.blocks[0]!.schema.id,
      source: changes.at(-1)?.source,
      text: mount.getDocument().sections[0]!.blocks[0]!.schema.containerBlocks[0]!.text,
      previous: replacement.previousHvy.includes('small'),
      replacement: replacement.replacementHvy.includes('smarter'),
    };
    await mount.undo();
    const afterUndo = mount.getDocument().sections[0]!.blocks[0]!.schema.containerBlocks[0]!.text;
    comparison.destroy();
    const previewDestroyed = beforeRoot.childElementCount === 0 && afterRoot.childElementCount === 0;
    mount.destroy();
    return { afterApply, afterUndo, preview, previewDestroyed };
  });

  expect(expectedResult).toMatchObject({
    afterApply: {
      dirty: true,
      id: 'fake-job',
      source: 'script',
      text: 'We build **smarter** tools!',
      previous: true,
      replacement: true,
    },
    afterUndo: 'We build **small** tools.',
    preview: {
      added: 'rter!',
      after: 'We build smarter tools!',
      afterComposite: true,
      before: 'We build small tools.',
      beforeComposite: true,
      containerColumns: 1,
      editingControls: 0,
      linkCount: 2,
      linksDisabled: true,
      linksStayedPut: true,
      removed: 'll.',
      surfaceContainerName: 'hvy-surface',
      xrefDisabled: 'true',
    },
    previewDestroyed: true,
  });
  expect(expectedResult.preview.addedColor).not.toBe(expectedResult.preview.removedColor);
});

test('target comparison expands nested expandable content by default without mutating the document', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  const expectedResult = await page.evaluate(async () => {
    const { deserializeDocumentBytes, mountHvy } = await import('/src/embed.ts');
    document.body.innerHTML = `
      <div id="expandable-comparison-mount" style="height:500px"></div>
      <div id="expandable-comparison-before"></div>
      <div id="expandable-comparison-after"></div>
    `;
    const root = document.querySelector<HTMLElement>('#expandable-comparison-mount')!;
    const beforeRoot = document.querySelector<HTMLElement>('#expandable-comparison-before')!;
    const afterRoot = document.querySelector<HTMLElement>('#expandable-comparison-after')!;
    const hvyDocument = deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake section

 <!--hvy:expandable {"id":"fake-expandable","expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {"id":"fake-summary"}-->
    Fake summary

  <!--hvy:expandable:content {}-->

   <!--hvy:text {"id":"fake-detail"}-->
    Hidden original detail.
`), '.hvy');
    const sectionKey = hvyDocument.sections[0]!.key;
    const block = hvyDocument.sections[0]!.blocks[0]!;
    const mount = mountHvy({ root, mode: 'editor', document: hvyDocument });
    const proposedHvy = `<!--hvy:expandable {"expandableExpanded":false}-->

 <!--hvy:expandable:stub {}-->

  <!--hvy:text {"id":"fake-summary"}-->
   Fake summary

 <!--hvy:expandable:content {}-->

  <!--hvy:text {"id":"fake-detail"}-->
   Hidden revised detail.`;

    const expanded = await mount.renderTargetTextComparison({
      target: { sectionKey, blockId: block.id },
      proposedHvy,
      beforeRoot,
      afterRoot,
    });
    const expandedResult = {
      added: Boolean(afterRoot.querySelector('ins')),
      afterContent: afterRoot.textContent?.includes('Hidden revised detail.'),
      beforeContent: beforeRoot.textContent?.includes('Hidden original detail.'),
      beforeExpanded: Boolean(beforeRoot.querySelector('.expandable-reader.is-expanded')),
      documentStayedCollapsed: block.schema.expandableExpanded === false,
      removed: Boolean(beforeRoot.querySelector('del')),
    };
    beforeRoot.querySelector<HTMLElement>('[data-reader-action="toggle-expandable"]')!.click();
    const clickedCollapsedResult = {
      afterStayedExpanded: Boolean(afterRoot.querySelector('.expandable-reader.is-expanded')),
      beforeCollapsed: Boolean(beforeRoot.querySelector('.expandable-reader.is-collapsed')),
      beforeContentAbsent: !beforeRoot.textContent?.includes('Hidden original detail.'),
      documentStayedCollapsed: block.schema.expandableExpanded === false,
    };
    beforeRoot.querySelector<HTMLElement>('[data-reader-action="toggle-expandable"]')!.click();
    const clickedExpandedResult = {
      beforeContent: beforeRoot.textContent?.includes('Hidden original detail.'),
      beforeExpanded: Boolean(beforeRoot.querySelector('.expandable-reader.is-expanded')),
      removed: Boolean(beforeRoot.querySelector('del')),
    };
    expanded.destroy();

    const configured = await mount.renderTargetTextComparison({
      target: { sectionKey, blockId: block.id },
      proposedHvy,
      beforeRoot,
      afterRoot,
      expandableMode: 'configured',
    });
    const configuredResult = {
      beforeCollapsed: Boolean(beforeRoot.querySelector('.expandable-reader.is-collapsed')),
      hiddenContentAbsent: !beforeRoot.textContent?.includes('Hidden original detail.'),
      summaryVisible: beforeRoot.textContent?.includes('Fake summary'),
    };
    beforeRoot.querySelector<HTMLElement>('[data-reader-action="toggle-expandable"]')!.click();
    const configuredClickedResult = {
      beforeContent: beforeRoot.textContent?.includes('Hidden original detail.'),
      beforeExpanded: Boolean(beforeRoot.querySelector('.expandable-reader.is-expanded')),
      documentStayedCollapsed: block.schema.expandableExpanded === false,
    };
    configured.destroy();
    mount.destroy();
    return { clickedCollapsedResult, clickedExpandedResult, configuredClickedResult, configuredResult, expandedResult };
  });

  expect(expectedResult).toEqual({
    clickedCollapsedResult: {
      afterStayedExpanded: true,
      beforeCollapsed: true,
      beforeContentAbsent: true,
      documentStayedCollapsed: true,
    },
    clickedExpandedResult: {
      beforeContent: true,
      beforeExpanded: true,
      removed: true,
    },
    configuredClickedResult: {
      beforeContent: true,
      beforeExpanded: true,
      documentStayedCollapsed: true,
    },
    configuredResult: {
      beforeCollapsed: true,
      hiddenContentAbsent: true,
      summaryVisible: true,
    },
    expandedResult: {
      added: true,
      afterContent: true,
      beforeContent: true,
      beforeExpanded: true,
      documentStayedCollapsed: true,
      removed: true,
    },
  });
});
