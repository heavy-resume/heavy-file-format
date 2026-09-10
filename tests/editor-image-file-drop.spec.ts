import { expect, test } from '@playwright/test';

test('image file drops preserve order, reject the side, and create a section below the document', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();

  const before = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const section = state.document.sections.find((candidate) => candidate.location === 'main');
    return {
      sectionKey: section?.key ?? '',
      blockCount: section?.blocks.length ?? 0,
      sectionCount: state.document.sections.length,
    };
  });
  const sectionCard = page.locator(`[data-editor-section="${before.sectionKey}"]`).first();
  await sectionCard.scrollIntoViewIfNeeded();

  const firstBlock = sectionCard.locator(':scope > .editor-blocks > [data-hvy-virtual-item="editor-block"]').first();
  const accepted = await firstBlock.evaluate((block) => {
    const bounds = block.getBoundingClientRect();
    const transfer = new DataTransfer();
    ['one.png', 'two.png', 'three.png'].forEach((name, index) => {
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71, index])], name, { type: 'image/png' }));
    });
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + 2,
    };
    const dragover = new DragEvent('dragover', options);
    block.dispatchEvent(dragover);
    const previewed = block.classList.contains('image-document-drop-active');
    const drop = new DragEvent('drop', options);
    block.dispatchEvent(drop);
    return { dragover: dragover.defaultPrevented, drop: drop.defaultPrevented, previewed };
  });

  expect(accepted).toEqual({ dragover: true, drop: true, previewed: true });
  await expect(page.locator('.editor-shell > .image-drop-choice-root')).toBeVisible();
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect.poll(() => page.evaluate(async ({ sectionKey }) => {
    const { state } = await import('/src/state.ts');
    return state.document.sections.find((section) => section.key === sectionKey)?.blocks.slice(0, 3).map((block) => block.schema.imageFile);
  }, before)).toEqual(['one.png', 'two.png', 'three.png']);

  const sideDropPrevented = await sectionCard.evaluate((section) => {
    const bounds = section.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'side.png', { type: 'image/png' }));
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.right + 20,
      clientY: bounds.top + bounds.height / 2,
    });
    section.dispatchEvent(drop);
    return drop.defaultPrevented;
  });

  expect(sideDropPrevented).toBe(true);
  await expect.poll(() => page.evaluate(async ({ sectionKey }) => {
    const { state } = await import('/src/state.ts');
    return state.document.sections.find((section) => section.key === sectionKey)?.blocks.length;
  }, before)).toBe(before.blockCount + 3);

  const belowDropPrevented = await page.locator('.editor-tree-body > [data-action="add-top-level-section"]').last().evaluate((ghost) => {
    const body = ghost.closest('.editor-tree-body');
    const lastSection = body
      ? Array.from(body.children).filter((child) => child.hasAttribute('data-editor-section')).at(-1)
      : null;
    if (!(lastSection instanceof HTMLElement)) return false;
    const bounds = lastSection.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'below.png', { type: 'image/png' }));
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.bottom + 4,
    });
    ghost.dispatchEvent(drop);
    return drop.defaultPrevented;
  });

  expect(belowDropPrevented).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections.at(-1)?.blocks.map((block) => block.schema.imageFile);
  })).toEqual(['below.png']);
  await expect.poll(() => page.evaluate(async () => (await import('/src/state.ts')).state.document.sections.length)).toBe(before.sectionCount + 1);
});

test('inserting dropped images preserves the component above the insertion point', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const [{ state, getRenderApp }, { createEmptyBlock, createEmptySectionWithMeta }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/document-factory.ts'),
    ]);
    const section = createEmptySectionWithMeta(1, '', false, state.document.meta);
    section.blocks = Array.from({ length: 12 }, (_item, index) => {
      const block = createEmptyBlock('text', false, state.document.meta);
      block.text = `Scroll anchor component ${index + 1}: ${'Stable content. '.repeat(8)}`;
      return block;
    });
    state.document.sections = [section];
    getRenderApp()();
    return {
      sectionKey: section.key,
      precedingBlockId: section.blocks[7]!.id,
      followingBlockId: section.blocks[8]!.id,
    };
  });

  const editorTree = page.locator('#editorTree');
  const preceding = page.locator(`[data-editor-section="${target.sectionKey}"] [data-hvy-virtual-item="editor-block"][data-block-id="${target.precedingBlockId}"]`);
  const following = page.locator(`[data-editor-section="${target.sectionKey}"] [data-hvy-virtual-item="editor-block"][data-block-id="${target.followingBlockId}"]`);
  await preceding.scrollIntoViewIfNeeded();
  await editorTree.evaluate((element) => { element.scrollTop += 80; });
  const beforeTop = await preceding.evaluate((element) => element.getBoundingClientRect().top);

  const dropImagesBeforeFollowing = () => following.evaluate((block) => {
    const bounds = block.getBoundingClientRect();
    const transfer = new DataTransfer();
    ['anchor-one.png', 'anchor-two.png', 'anchor-three.png'].forEach((name, index) => {
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71, index])], name, { type: 'image/png' }));
    });
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + 1,
    };
    const drop = new DragEvent('drop', options);
    block.dispatchEvent(drop);
    return drop.defaultPrevented;
  });

  expect(await dropImagesBeforeFollowing()).toBe(true);
  const choiceModal = page.locator('.editor-shell > .image-drop-choice-root .image-drop-choice-modal');
  await expect(choiceModal).toBeVisible();
  expect(await choiceModal.evaluate((modal) => {
    const shell = modal.closest<HTMLElement>('.editor-shell');
    if (!shell) return false;
    const modalBounds = modal.getBoundingClientRect();
    const shellBounds = shell.getBoundingClientRect();
    return modalBounds.top >= shellBounds.top
      && modalBounds.bottom <= shellBounds.bottom
      && modalBounds.left >= shellBounds.left
      && modalBounds.right <= shellBounds.right;
  })).toBe(true);
  expect(Math.abs(await preceding.evaluate((element) => element.getBoundingClientRect().top) - beforeTop)).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect.poll(() => page.evaluate(async ({ sectionKey }) => {
    const { state } = await import('/src/state.ts');
    return state.document.sections.find((section) => section.key === sectionKey)?.blocks
      .filter((block) => block.schema.kind === 'image').length;
  }, target)).toBe(3);
  await expect.poll(async () => Math.abs(await preceding.evaluate((element) => element.getBoundingClientRect().top) - beforeTop))
    .toBeLessThanOrEqual(2);

  const beforeCancelTop = await preceding.evaluate((element) => element.getBoundingClientRect().top);
  expect(await dropImagesBeforeFollowing()).toBe(true);
  await expect(page.locator('.editor-shell > .image-drop-choice-root')).toBeVisible();
  expect(Math.abs(await preceding.evaluate((element) => element.getBoundingClientRect().top) - beforeCancelTop)).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(async () => Math.abs(await preceding.evaluate((element) => element.getBoundingClientRect().top) - beforeCancelTop))
    .toBeLessThanOrEqual(2);
  expect(await page.evaluate(async ({ sectionKey }) => {
    const { state } = await import('/src/state.ts');
    return state.document.sections.find((section) => section.key === sectionKey)?.blocks
      .filter((block) => block.schema.kind === 'image').length;
  }, target)).toBe(3);

  const beforeEscapeTop = await preceding.evaluate((element) => element.getBoundingClientRect().top);
  expect(await dropImagesBeforeFollowing()).toBe(true);
  await expect(page.locator('.editor-shell > .image-drop-choice-root')).toBeVisible();
  expect(Math.abs(await preceding.evaluate((element) => element.getBoundingClientRect().top) - beforeEscapeTop)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Escape');
  await expect.poll(async () => Math.abs(await preceding.evaluate((element) => element.getBoundingClientRect().top) - beforeEscapeTop))
    .toBeLessThanOrEqual(2);
  await expect(page.locator('.editor-shell > .image-drop-choice-root')).toHaveCount(0);
});

test('image files dropped between top-level sections create a section in that gap', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const [{ state, getRenderApp }, { createEmptySectionWithMeta }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/document-factory.ts'),
    ]);
    const first = createEmptySectionWithMeta(1, 'text', false, state.document.meta);
    const second = createEmptySectionWithMeta(1, 'text', false, state.document.meta);
    first.title = 'First Section';
    second.title = 'Second Section';
    first.blocks[0]!.text = 'First section content';
    second.blocks[0]!.text = 'Second section content';
    state.document.sections = [first, second];
    getRenderApp()();
    return { firstKey: first.key, secondKey: second.key };
  });

  const accepted = await page.locator('.editor-tree-body:not(.editor-sidebar-tree-body)').evaluate((body, keys) => {
    const first = body.querySelector<HTMLElement>(`:scope > [data-editor-section="${keys.firstKey}"]`);
    const second = body.querySelector<HTMLElement>(`:scope > [data-editor-section="${keys.secondKey}"]`);
    if (!first || !second) return { dragover: false, drop: false, previewed: false };
    const firstBounds = first.getBoundingClientRect();
    const secondBounds = second.getBoundingClientRect();
    const clientX = Math.max(firstBounds.left, secondBounds.left) + Math.min(firstBounds.width, secondBounds.width) / 2;
    const clientY = firstBounds.bottom + (secondBounds.top - firstBounds.bottom) / 2;
    const dropTarget = document.elementFromPoint(clientX, clientY);
    if (!(dropTarget instanceof HTMLElement)) return { dragover: false, drop: false, previewed: false };
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'between.png', { type: 'image/png' }));
    const options = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX, clientY };
    const dragover = new DragEvent('dragover', options);
    dropTarget.dispatchEvent(dragover);
    const previewed = dropTarget.classList.contains('image-section-drop-gap')
      && dropTarget.classList.contains('image-document-drop-active');
    const drop = new DragEvent('drop', options);
    dropTarget.dispatchEvent(drop);
    return { dragover: dragover.defaultPrevented, drop: drop.defaultPrevented, previewed };
  }, target);

  expect(accepted).toEqual({ dragover: true, drop: true, previewed: true });
  const attachedSectionTargets = await page.evaluate(({ firstKey, secondKey }) => {
    const first = document.querySelector<HTMLElement>(`[data-editor-section="${firstKey}"]`);
    const second = document.querySelector<HTMLElement>(`[data-editor-section="${secondKey}"]`);
    if (!first || !second) return { first: true, second: true };
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'edge.png', { type: 'image/png' }));
    const previewAt = (section: HTMLElement, clientY: number) => {
      const bounds = section.getBoundingClientRect();
      section.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: bounds.left + bounds.width / 2,
        clientY,
      }));
      return section.classList.contains('image-document-drop-active');
    };
    return {
      first: previewAt(first, first.getBoundingClientRect().bottom - 2),
      second: previewAt(second, second.getBoundingClientRect().top + 2),
    };
  }, target);
  expect(attachedSectionTargets).toEqual({ first: false, second: false });
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections.map((section) => ({
      key: section.key,
      images: section.blocks.map((block) => block.schema.imageFile).filter(Boolean),
    }));
  })).toEqual([
    { key: target.firstKey, images: [] },
    { key: expect.any(String), images: ['between.png'] },
    { key: target.secondKey, images: [] },
  ]);
});

test('image files and component placement share the boundary between adjacent subsections', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const [{ state, getRenderApp }, { createEmptySectionWithMeta, createEmptyBlock }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/document-factory.ts'),
    ]);
    const parent = createEmptySectionWithMeta(1, '', false, state.document.meta);
    const source = createEmptyBlock('text');
    source.text = 'Placement source';
    const first = createEmptySectionWithMeta(2, 'text', false, state.document.meta);
    const second = createEmptySectionWithMeta(2, 'text', false, state.document.meta);
    first.title = 'First Subsection';
    second.title = 'Second Subsection';
    first.renderAfterBlockId = source.id;
    second.renderAfterBlockId = source.id;
    parent.blocks = [source];
    parent.children = [first, second];
    state.document.sections = [parent];
    getRenderApp()();
    return { parentKey: parent.key, sourceId: source.id, firstKey: first.key, secondKey: second.key };
  });

  const subsectionGap = page.locator(`[data-editor-section="${target.parentKey}"] > .editor-blocks > .section-sequence-add-ghost`);
  await expect(subsectionGap).toHaveCount(1);
  const gapPreview = await subsectionGap.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'between-subsections.png', { type: 'image/png' }));
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    };
    element.dispatchEvent(new DragEvent('dragover', options));
    const previousSubsection = element.previousElementSibling;
    const expectedResult = {
      gap: element.classList.contains('image-document-drop-active'),
      upperSubsection: previousSubsection?.classList.contains('image-document-drop-active') === true,
    };
    element.dispatchEvent(new DragEvent('drop', options));
    return expectedResult;
  });
  expect(gapPreview).toEqual({ gap: true, upperSubsection: false });
  await expect.poll(() => page.evaluate(async ({ parentKey }) => {
    const [{ state }, { findSectionByKey, buildSectionRenderSequence }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/section-ops.ts'),
    ]);
    const section = findSectionByKey(state.document.sections, parentKey);
    return section ? buildSectionRenderSequence(section).map((item) => item.kind === 'block' ? item.block.schema.imageFile || item.block.text : item.child.title) : [];
  }, target)).toEqual(['Placement source', 'First Subsection', 'between-subsections.png', 'Second Subsection']);

  await page.locator(`[data-block-id="${target.sourceId}"]`).filter({ hasText: 'Placement source' }).first().click();
  await page.locator('.editor-block[data-active-editor-block="true"]').getByRole('button', { name: 'Copy' }).click();
  const sharedBoundary = page.locator(`[data-action="place-component"][data-section-before-kind="child"][data-section-before-id="${target.secondKey}"]`);
  await expect(sharedBoundary).toHaveCount(1);
  await sharedBoundary.click();
  await expect.poll(() => page.evaluate(async ({ parentKey }) => {
    const [{ state }, { findSectionByKey, buildSectionRenderSequence }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/section-ops.ts'),
    ]);
    const section = findSectionByKey(state.document.sections, parentKey);
    return section ? buildSectionRenderSequence(section).map((item) => item.kind === 'block' ? item.block.schema.imageFile || item.block.text : item.child.title) : [];
  }, target)).toEqual(['Placement source', 'First Subsection', 'between-subsections.png', 'Placement source', 'Second Subsection']);

  await page.locator(`.editor-block[data-block-id="${target.sourceId}"]`).getByRole('button', { name: 'Move', exact: true }).click();
  await page.locator(`[data-action="place-component"][data-section-before-kind="child"][data-section-before-id="${target.secondKey}"]`).click();
  await expect.poll(() => page.evaluate(async ({ parentKey, sourceId }) => {
    const [{ state }, { findSectionByKey, buildSectionRenderSequence }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/section-ops.ts'),
    ]);
    const section = findSectionByKey(state.document.sections, parentKey);
    return section ? buildSectionRenderSequence(section).map((item) => item.kind === 'block'
      ? item.block.id === sourceId ? 'moved-source' : item.block.schema.imageFile || item.block.text
      : item.child.title) : [];
  }, target)).toEqual(['First Subsection', 'between-subsections.png', 'Placement source', 'moved-source', 'Second Subsection']);
});

test('the subsection gap plus inserts a component at that shared boundary', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const [{ state, getRenderApp }, { createEmptySectionWithMeta }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/document-factory.ts'),
    ]);
    const parent = createEmptySectionWithMeta(1, '', false, state.document.meta);
    const first = createEmptySectionWithMeta(2, 'text', false, state.document.meta);
    const second = createEmptySectionWithMeta(2, 'text', false, state.document.meta);
    first.title = 'First Subsection';
    second.title = 'Second Subsection';
    first.renderAfterBlockId = '';
    second.renderAfterBlockId = '';
    parent.blocks = [];
    parent.children = [first, second];
    state.document.sections = [parent];
    getRenderApp()();
    return { parentKey: parent.key };
  });

  const gap = page.locator(`[data-editor-section="${target.parentKey}"] > .editor-blocks > .section-sequence-add-ghost`);
  await gap.getByRole('button', { name: 'Insert component between subsections' }).click();
  await gap.locator('.component-picker-row-direct[data-component="text"]').click();

  await expect.poll(() => page.evaluate(async ({ parentKey }) => {
    const [{ state }, { findSectionByKey, buildSectionRenderSequence }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/section-ops.ts'),
    ]);
    const section = findSectionByKey(state.document.sections, parentKey);
    return section ? buildSectionRenderSequence(section).map((item) => item.kind === 'block' ? item.block.schema.kind : item.child.title) : [];
  }, target)).toEqual(['First Subsection', 'text', 'Second Subsection']);
});

test('a subsection title drops at the same boundary above its first component', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const [{ state, getRenderApp }, { createEmptySectionWithMeta }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/document-factory.ts'),
    ]);
    const parent = createEmptySectionWithMeta(1, '', false, state.document.meta);
    const child = createEmptySectionWithMeta(2, 'text', false, state.document.meta);
    child.title = 'Drop On This Title';
    child.blocks[0]!.text = 'First component';
    child.renderAfterBlockId = '';
    parent.blocks = [];
    parent.children = [child];
    state.document.sections = [parent];
    getRenderApp()();
    return { childKey: child.key };
  });
  const subsection = page.locator(`[data-editor-section="${target.childKey}"]`);
  const accepted = await subsection.locator(':scope > .editor-section-head').evaluate((head) => {
    const subsectionCard = head.closest<HTMLElement>('[data-editor-section]');
    const blocks = subsectionCard?.querySelector<HTMLElement>(':scope > .editor-blocks');
    if (!blocks) return { previewed: false, dropped: false };
    const firstComponent = blocks.querySelector<HTMLElement>(':scope > [data-hvy-virtual-item="editor-block"]');
    if (!firstComponent) return { previewed: false, dropped: false };
    const bounds = head.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'from-title.png', { type: 'image/png' }));
    const options = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 };
    head.dispatchEvent(new DragEvent('dragover', options));
    const titlePreviewed = firstComponent.classList.contains('image-document-drop-active') && firstComponent.classList.contains('image-document-drop-before');
    const firstBounds = firstComponent.getBoundingClientRect();
    const deadZoneOptions = { ...options, clientY: firstBounds.top - 2 };
    blocks.dispatchEvent(new DragEvent('dragover', deadZoneOptions));
    const deadZonePreviewed = firstComponent.classList.contains('image-document-drop-active') && firstComponent.classList.contains('image-document-drop-before');
    const drop = new DragEvent('drop', deadZoneOptions);
    blocks.dispatchEvent(drop);
    return { previewed: titlePreviewed && deadZonePreviewed, dropped: drop.defaultPrevented };
  });
  expect(accepted).toEqual({ previewed: true, dropped: true });
  await expect.poll(() => page.evaluate(async ({ childKey }) => {
    const [{ state }, { findSectionByKey }] = await Promise.all([import('/src/state.ts'), import('/src/section-ops.ts')]);
    return findSectionByKey(state.document.sections, childKey)?.blocks.map((block) => block.schema.imageFile || block.text);
  }, target)).toEqual(['from-title.png', 'First component']);
});

test('the section end plus replaces a duplicate insert-below row for the last component', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const [{ state, getRenderApp }, { createEmptySectionWithMeta }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/document-factory.ts'),
    ]);
    const section = createEmptySectionWithMeta(1, 'text', false, state.document.meta);
    section.blocks[0]!.text = 'Only component';
    state.document.sections = [section];
    getRenderApp()();
    return { sectionKey: section.key };
  });

  await page.locator(`[data-editor-section="${target.sectionKey}"] .editor-block-passive`, { hasText: 'Only component' }).click();
  const blocks = page.locator(`[data-editor-section="${target.sectionKey}"] > .editor-blocks`);
  await expect(blocks.locator(':scope > .active-component-insert-ghost-after')).toHaveCount(0);
  await expect(blocks.locator(':scope > .compact-add-component-ghost:not(.active-component-insert-ghost)')).toHaveCount(1);
});

test('image files dropped on a section append target stay in that section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const section = state.document.sections.find((candidate) => candidate.location === 'main');
    return { sectionKey: section?.key ?? '', sectionCount: state.document.sections.length, blockCount: section?.blocks.length ?? 0 };
  });
  const appendTarget = page.locator(`[data-editor-section="${target.sectionKey}"] > .editor-blocks > .compact-add-component-ghost`).last();

  const accepted = await appendTarget.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'section-bottom.png', { type: 'image/png' }));
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    };
    element.dispatchEvent(new DragEvent('dragover', options));
    const previous = element.previousElementSibling;
    const previewedOnPreviousLine = previous?.classList.contains('image-document-drop-active') === true
      && !element.classList.contains('image-document-drop-active');
    const drop = new DragEvent('drop', options);
    element.dispatchEvent(drop);
    return { dropped: drop.defaultPrevented, previewedOnPreviousLine };
  });

  expect(accepted).toEqual({ dropped: true, previewedOnPreviousLine: true });
  await expect.poll(() => page.evaluate(async ({ sectionKey }) => {
    const { state } = await import('/src/state.ts');
    const section = state.document.sections.find((candidate) => candidate.key === sectionKey);
    return {
      sectionCount: state.document.sections.length,
      blockCount: section?.blocks.length,
      lastImage: section?.blocks.at(-1)?.schema.imageFile,
    };
  }, target)).toEqual({
    sectionCount: target.sectionCount,
    blockCount: target.blockCount + 1,
    lastImage: 'section-bottom.png',
  });
});

test('multiple HVY images can be inserted as one ordered carousel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const section = state.document.sections.find((candidate) => candidate.location === 'main');
    return { sectionKey: section?.key ?? '', blockCount: section?.blocks.length ?? 0 };
  });
  const appendTarget = page.locator(`[data-editor-section="${target.sectionKey}"] > .editor-blocks > .compact-add-component-ghost`).last();
  await appendTarget.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const transfer = new DataTransfer();
    ['slide-one.png', 'slide-two.png', 'slide-three.png'].forEach((name) => {
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' }));
    });
    element.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }));
  });

  const choiceDialog = page.getByRole('dialog', { name: 'How should these images be added?' });
  await expect(choiceDialog).toBeVisible();
  expect((await choiceDialog.boundingBox())?.width).toBeLessThan(400);
  await expect(choiceDialog.locator('.image-drop-choice-count')).toHaveCount(0);
  await expect(choiceDialog.getByText('Keep them as separate components or combine them into one carousel.')).toHaveCount(0);
  await expect(choiceDialog.getByRole('button', { name: 'Images', exact: true }).locator('.hvy-ui-icon-vertical-triangle-arrows')).toHaveCount(1);
  await expect(choiceDialog.getByRole('button', { name: 'Carousel', exact: true }).locator('.hvy-ui-icon-horizontal-triangle-arrows')).toHaveCount(1);
  await page.mouse.move(0, 0);
  await choiceDialog.focus();
  expect(await choiceDialog.evaluate((dialog) => {
    const dialogBounds = dialog.getBoundingClientRect();
    const cancelBounds = dialog.querySelector<HTMLElement>('.image-drop-choice-cancel')?.getBoundingClientRect();
    return cancelBounds ? Math.abs(
      cancelBounds.left + cancelBounds.width / 2 - (dialogBounds.left + dialogBounds.width / 2),
    ) < 1 : false;
  })).toBe(true);
  await expect(choiceDialog.locator('.image-drop-choice-actions')).toHaveJSProperty('childElementCount', 2);
  expect(await choiceDialog.locator('.image-drop-choice-card').evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    const icon = button.querySelector('svg');
    return {
      square: Math.abs(bounds.width - bounds.height) < 1,
      background: getComputedStyle(button).backgroundColor,
      iconColor: icon ? getComputedStyle(icon).color : '',
      iconNearEdges: icon ? icon.getBoundingClientRect().width / bounds.width >= 0.9 : false,
      solidTriangles: icon
        ? getComputedStyle(icon).fill === getComputedStyle(icon).color && getComputedStyle(icon).stroke === 'none'
        : false,
    };
  }))).toEqual([
    expect.objectContaining({ square: true, iconNearEdges: true, solidTriangles: true }),
    expect.objectContaining({ square: true, iconNearEdges: true, solidTriangles: true }),
  ]);
  const choiceColors = await choiceDialog.locator('.image-drop-choice-card').evaluateAll((buttons) => buttons.map((button) => ({
    background: getComputedStyle(button).backgroundColor,
    border: getComputedStyle(button).border,
    iconColor: getComputedStyle(button.querySelector('svg')!).color,
  })));
  expect(choiceColors[0]).toEqual(choiceColors[1]);
  await choiceDialog.getByRole('button', { name: 'Carousel', exact: true }).click();
  await expect.poll(() => page.evaluate(async ({ sectionKey }) => {
    const { state } = await import('/src/state.ts');
    const section = state.document.sections.find((candidate) => candidate.key === sectionKey);
    const block = section?.blocks.at(-1);
    return {
      blockCount: section?.blocks.length,
      kind: block?.schema.kind,
      slides: block?.schema.carouselImages?.map((image) => image.imageFile),
    };
  }, target)).toEqual({
    blockCount: target.blockCount + 1,
    kind: 'carousel',
    slides: ['slide-one.png', 'slide-two.png', 'slide-three.png'],
  });
});

test('multiple PHVY images insert separately without asking for a carousel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const { state, getRenderApp } = await import('/src/state.ts');
    state.document.extension = '.phvy';
    const section = state.document.sections.find((candidate) => candidate.location === 'main');
    getRenderApp()();
    return { sectionKey: section?.key ?? '', blockCount: section?.blocks.length ?? 0 };
  });
  const appendTarget = page.locator(`[data-editor-section="${target.sectionKey}"] > .editor-blocks > .compact-add-component-ghost`).last();
  await appendTarget.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const transfer = new DataTransfer();
    ['page-one.png', 'page-two.png'].forEach((name) => {
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' }));
    });
    element.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + 8,
    }));
  });

  await expect(page.locator('.image-drop-choice-root')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async ({ sectionKey }) => {
    const { state } = await import('/src/state.ts');
    return state.document.sections.find((candidate) => candidate.key === sectionKey)?.blocks.slice(-2).map((block) => block.schema.imageFile);
  }, target)).toEqual(['page-one.png', 'page-two.png']);
  await expect.poll(() => page.evaluate(async ({ sectionKey }) => {
    const { state } = await import('/src/state.ts');
    return state.document.sections.find((candidate) => candidate.key === sectionKey)?.blocks.length;
  }, target)).toBe(target.blockCount + 2);
});

test('image files dropped inside a passive container insert at its vertical drop point', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const target = await page.evaluate(async () => {
    const [{ state, getRenderApp }, { createEmptyBlock }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/document-factory.ts'),
    ]);
    const section = state.document.sections.find((candidate) => candidate.location === 'main');
    if (!section) throw new Error('Expected a main document section.');
    const container = createEmptyBlock('container');
    container.schema.containerBlocks = [createEmptyBlock('text'), createEmptyBlock('text')];
    container.schema.containerBlocks[0]!.text = 'First child';
    container.schema.containerBlocks[1]!.text = 'Second child';
    section.blocks = [container];
    getRenderApp()();
    return {
      sectionKey: section.key,
      containerId: container.id,
      firstChildId: container.schema.containerBlocks[0]!.id,
    };
  });
  const containerBody = page.locator(
    `.editor-block-passive[data-block-id="${target.containerId}"] [data-image-drop-block-container="container"]`,
  );

  const accepted = await containerBody.evaluate((body) => {
    const bounds = body.getBoundingClientRect();
    const transfer = new DataTransfer();
    ['nested-one.png', 'nested-two.png'].forEach((name) => {
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' }));
    });
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.bottom - 1,
    };
    const dragover = new DragEvent('dragover', options);
    body.dispatchEvent(dragover);
    const previewed = body.classList.contains('image-document-drop-after');
    const drop = new DragEvent('drop', options);
    body.dispatchEvent(drop);
    return { dragover: dragover.defaultPrevented, drop: drop.defaultPrevented, previewed };
  });

  expect(accepted).toEqual({ dragover: true, drop: true, previewed: true });
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect.poll(() => page.evaluate(async ({ sectionKey, containerId }) => {
    const [{ state }, { findBlockContainerById }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/section-ops.ts'),
    ]);
    const location = findBlockContainerById(state.document.sections, sectionKey, containerId);
    const container = location?.container[location.index];
    return container?.schema.containerBlocks.map((block) => block.schema.imageFile || block.id);
  }, target)).toEqual([target.firstChildId, expect.any(String), 'nested-one.png', 'nested-two.png']);
});
