import { expect, test } from '@playwright/test';

for (const mode of ['viewer', 'ai']) {
  for (const manySections of [true, false]) {
    test(`${mode} carries the visible block into editor across ${manySections ? 'sections' : 'virtualized blocks'}`, async ({ page }) => {
      test.setTimeout(5_000);
      await page.goto('/');
      await page.evaluate(async ({ mode, manySections }) => {
        const embedPath = '/src/embed.ts';
        const { mountHvy, deserializeDocumentBytes } = await import(/* @vite-ignore */ embedPath);
        document.body.innerHTML = '<div id="locationRoot" style="height:400px"></div>';
        const source = '---\nhvy_version: 0.1\n---\n\n' + (manySections ? '' : '#! Sample\n\n') +
          Array.from({ length: 65 }, (_, index) =>
            `${manySections ? `<!--hvy: {"id":"section-${index}"}-->\n#! Sample ${index}\n\n` : ''}` +
            `<!--hvy:text {"id":"sample-${index}"}-->\n Sample block ${index}.\n\n`).join('');
        const mount = mountHvy({ root: document.querySelector('#locationRoot'), mode,
          document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy') });
        Object.assign(window, { locationMount: mount });
        if (mode === 'ai') {
          await mount.setMode('editor');
          document.querySelector('#editorTree')!.scrollTop = 150;
          await mount.setMode('ai');
        }
      }, { mode, manySections });
      await expect(page.locator('#locationRoot .reader-document')).toBeVisible();
      await page.evaluate(async () => {
        const statePath = '/src/state.ts';
        const virtualPath = '/src/section-virtualizer.ts';
        const { getActiveStateRuntime } = await import(/* @vite-ignore */ statePath);
        const { restoreVirtualizedSection, restoreVirtualizedBlock } = await import(/* @vite-ignore */ virtualPath);
        const root = document.querySelector('#locationRoot') as HTMLElement;
        root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const section = getActiveStateRuntime().state.document.sections.find((section: any) =>
          section.blocks.some((block: any) => block.schema.id === 'sample-45'));
        const block = section.blocks.find((block: any) => block.schema.id === 'sample-45');
        restoreVirtualizedSection(root, section.key);
        restoreVirtualizedBlock(root, section.key, block.id);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const target = root.querySelector(`[data-section-key="${section.key}"][data-block-id="${block.id}"]`) as HTMLElement;
        const scroller = root.querySelector('.reader-document') as HTMLElement;
        scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20;
        Object.assign(window, { locationTarget: { sectionKey: section.key, blockId: block.id } });
      });
      await expect.poll(() => page.evaluate(() => {
        const root = document.querySelector('#locationRoot')!;
        const { sectionKey, blockId } = (window as any).locationTarget;
        const target = root.querySelector(`[data-section-key="${sectionKey}"][data-block-id="${blockId}"]`)!;
        return Math.round(target.getBoundingClientRect().top - root.querySelector('.reader-document')!.getBoundingClientRect().top);
      })).toBe(20);
      await page.evaluate(() => (window as any).locationMount.setMode('editor'));
      const targetIsVisible = () => page.evaluate(() => {
        const root = document.querySelector('#locationRoot')!;
        const { sectionKey, blockId } = (window as any).locationTarget;
        const target = root.querySelector(`.editor-block-passive[data-section-key="${sectionKey}"][data-block-id="${blockId}"]`);
        if (!target) return false;
        const viewport = root.querySelector('#editorTree')!.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      });
      await expect.poll(targetIsVisible).toBe(true);
      // A deferred render scroll restore must not send the editor back to its old offset.
      await page.waitForTimeout(100);
      expect(await targetIsVisible()).toBe(true);
    });
  }
}
