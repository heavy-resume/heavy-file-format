import { expect, test } from '@playwright/test';

for (const mode of ['viewer', 'editor', 'ai']) {
  test(`sidebar help is positioned before showing in embedded ${mode}`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    expect(await page.evaluate(async (mode) => {
      const { mountHvy, deserializeDocumentBytes } = await import('/src/embed.ts');
      const root = document.createElement('div');
      root.style.cssText = 'height:500px;width:1100px';
      document.body.append(root);
      const mount = mountHvy({ root, mode, document: deserializeDocumentBytes(new TextEncoder().encode(
        '---\nhvy_version: 0.1\n---\n\n#! Sample body\n\n Sample content.\n\n<!--hvy: {"id":"sample-sidebar","location":"sidebar"}-->\n#! Sample sidebar\n\n Sample side content.'
      ), '.hvy') });
      await mount.setMode(mode);
      const inspect = () => {
        const balloon = root.querySelector<HTMLElement>('.editor-sidebar-help-balloon, .viewer-sidebar-help-balloon')!;
        const tab = root.querySelector<HTMLElement>('.editor-sidebar-tab, .viewer-sidebar-tab')!;
        return {
          visible: getComputedStyle(balloon).visibility === 'visible',
          gap: Math.round(balloon.getBoundingClientRect().left - tab.getBoundingClientRect().right),
        };
      };
      const before = inspect();
      // This replaces the DOM synchronously, while editor event binding remains deferred.
      mount.setThemeOverrides({ '--hvy-accent-1': '#123456' });
      const afterRender = inspect();
      root.remove();
      mount.setThemeOverrides({ '--hvy-accent-1': '#654321' });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      document.body.append(root);
      const beforeMeasurement = inspect();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const afterAttachment = inspect();
      root.style.width = '350px';
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const afterResize = inspect();
      root.style.display = 'none';
      mount.setThemeOverrides({ '--hvy-accent-1': '#123456' });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      root.style.display = '';
      const beforeRevealMeasurement = inspect();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const afterReveal = inspect();
      mount.destroy();
      root.remove();
      return { before, afterRender, hiddenUntilMeasured: !beforeMeasurement.visible,
        afterAttachment, afterResize, hiddenUntilRevealMeasured: !beforeRevealMeasurement.visible, afterReveal };
    }, mode)).toEqual({
      before: { visible: true, gap: 10 },
      afterRender: { visible: true, gap: 10 },
      hiddenUntilMeasured: true,
      afterAttachment: { visible: true, gap: 10 },
      afterResize: { visible: true, gap: 10 },
      hiddenUntilRevealMeasured: true,
      afterReveal: { visible: true, gap: 10 },
    });
  });
}
