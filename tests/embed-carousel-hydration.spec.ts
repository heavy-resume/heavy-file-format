import { expect, test } from '@playwright/test';

for (const mode of ['ai', 'viewer'] as const) {
  test(`embedded ${mode} hydrates a carousel inside an expandable after refresh`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    await page.evaluate(async (mode) => {
      const { mountHvy } = await import('/src/embed-full.ts');
      const { deserializeDocument } = await import('/src/serialization.ts');
      const { setImageAttachment } = await import('/src/attachments.ts');
      const { getActiveStateRuntime } = await import('/src/state.ts');
      const doc = deserializeDocument(`---
hvy_version: 0.1
---

#! Projects

 <!--hvy:expandable {"id":"project","expandableExpanded":true}-->
  <!--hvy:expandable:content {}-->

   <!--hvy:carousel {"id":"photos","carouselImages":[{"imageFile":"sample.svg","imageAlt":"Sample"}]}-->
`, '.hvy');
      setImageAttachment(doc, 'sample.svg', 'image/svg+xml', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="blue"/></svg>'));
      document.body.innerHTML = '<div id="carousel-test"></div>';
      const root = document.querySelector<HTMLElement>('#carousel-test')!;
      const mount = mountHvy({ root, document: doc, mode, persistSessionState: false });
      root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      Object.assign(window, { carouselTest: { mount, runtime: getActiveStateRuntime(), sectionKey: doc.sections[0].key, blockId: doc.sections[0].blocks[0].id } });
    }, mode);
    const image = page.locator('#carousel-test .hvy-carousel-reader img').first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(20);
    expect(await page.evaluate(async () => {
      const { runWithStateRuntime } = await import('/src/state.ts');
      const { runtime, sectionKey, blockId } = (window as any).carouselTest;
      return runWithStateRuntime(runtime, () => runtime.callbacks.refreshReaderBlock(document.querySelector('#carousel-test'), sectionKey, blockId));
    })).toBe(true);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(20);
  });
}
