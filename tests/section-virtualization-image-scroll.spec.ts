import { expect, test } from '@playwright/test';

test('before, an image section placeholder is above the viewport, after: restoring it preserves following content', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');

  const expectedResult = await page.evaluate(async () => {
    document.body.innerHTML = `<div id="virtualRoot" class="hvy-document">
      <div class="editor-shell">
        <div class="editor-tree" style="height: 300px; overflow: auto;">
          <div class="hvy-surface"><div class="editor-tree-body"></div></div>
        </div>
      </div>
    </div>`;
    const body = document.querySelector<HTMLElement>('.editor-tree-body')!;
    for (let index = 0; index < 10; index += 1) {
      body.insertAdjacentHTML('beforeend', `<div class="editor-section-card" data-hvy-virtual-item="editor" data-editor-section="before-${index}" style="height: 200px;"></div>`);
    }
    body.insertAdjacentHTML('beforeend', '<div class="hvy-section-virtual-placeholder" data-hvy-virtual-placeholder="true" data-hvy-virtual-kind="editor" data-section-key="image-target" style="min-height: 600px; margin: 0;"></div>');
    body.insertAdjacentHTML('beforeend', '<div id="visibleAnchor" class="editor-section-card" data-hvy-virtual-item="editor" data-editor-section="anchor" style="height: 300px;">Visible anchor</div>');
    for (let index = 0; index < 14; index += 1) {
      body.insertAdjacentHTML('beforeend', `<div class="editor-section-card" data-hvy-virtual-item="editor" data-editor-section="after-${index}" style="height: 200px;"></div>`);
    }

    const root = document.querySelector<HTMLElement>('#virtualRoot')!;
    const scroller = document.querySelector<HTMLElement>('.editor-tree')!;
    const placeholder = document.querySelector<HTMLElement>('[data-section-key="image-target"]')!;
    const anchor = document.querySelector<HTMLElement>('#visibleAnchor')!;
    scroller.scrollTop = placeholder.offsetTop + 700;
    const beforeRestoreTop = anchor.getBoundingClientRect().top;

    const { restoreVirtualizedSection, virtualizeRenderedSections } = await import('/src/section-virtualizer.ts');
    let resolveImageLayout = () => {};
    virtualizeRenderedSections({
      root,
      materializeSection: (candidate) => {
        if (candidate.dataset.sectionKey !== 'image-target') return null;
        const section = document.createElement('div');
        section.className = 'editor-section-card';
        section.dataset.hvyVirtualItem = 'editor';
        section.dataset.editorSection = 'image-target';
        section.innerHTML = '<div style="height: 80px;"></div><img data-hvy-lazy-image="true" data-image-filename="delayed.png" alt="Delayed">';
        resolveImageLayout = () => {
          const image = section.querySelector('img');
          const preparedImage = document.createElement('div');
          preparedImage.style.height = '520px';
          image?.replaceWith(preparedImage);
        };
        return section;
      },
    });

    restoreVirtualizedSection(root, 'image-target');
    const afterRestoreTop = anchor.getBoundingClientRect().top;
    const restoredSection = document.querySelector<HTMLElement>('[data-editor-section="image-target"]')!;
    const pendingHeight = restoredSection.getBoundingClientRect().height;
    resolveImageLayout();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    return {
      beforeRestoreTop,
      afterRestoreTop,
      afterReadyTop: anchor.getBoundingClientRect().top,
      pendingHeight,
      finalHeight: restoredSection.getBoundingClientRect().height,
    };
  });

  expect(Math.abs(expectedResult.afterRestoreTop - expectedResult.beforeRestoreTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(expectedResult.afterReadyTop - expectedResult.beforeRestoreTop)).toBeLessThanOrEqual(2);
  expect(expectedResult.pendingHeight).toBeGreaterThanOrEqual(600);
  expect(expectedResult.finalHeight).toBeGreaterThanOrEqual(600);
});
