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
  await expect(page.locator('.hvy-surface > .image-drop-choice-root')).toBeVisible();
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
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    });
    element.dispatchEvent(drop);
    return drop.defaultPrevented;
  });

  expect(accepted).toBe(true);
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
  await expect(choiceDialog.getByRole('button', { name: 'Images', exact: true }).locator('.hvy-ui-icon-vertical-arrows')).toHaveCount(1);
  await expect(choiceDialog.getByRole('button', { name: 'Carousel', exact: true }).locator('.hvy-ui-icon-horizontal-arrows')).toHaveCount(1);
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
      linecap: icon ? getComputedStyle(icon).strokeLinecap : '',
      linejoin: icon ? getComputedStyle(icon).strokeLinejoin : '',
    };
  }))).toEqual([
    expect.objectContaining({ square: true, iconNearEdges: true, linecap: 'butt', linejoin: 'miter' }),
    expect.objectContaining({ square: true, iconNearEdges: true, linecap: 'butt', linejoin: 'miter' }),
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
